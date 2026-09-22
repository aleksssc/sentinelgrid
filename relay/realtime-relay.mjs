import { createServer as createHTTPServer } from "node:http";
import { createServer as createHTTPSServer } from "node:https";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { loadRealtimeEnvironment, realtimeConfiguration } from "./realtime-config.mjs";

export function createRealtimeRelay({ agent, browser, allowedOrigin, tls, trustProxy = false, allowDevelopmentOrigin = false, maxConnections = 2000, heartbeatMs = 30000 }) {
  const origin = new URL(allowedOrigin);
  const localDevelopment = allowDevelopmentOrigin && origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((!localDevelopment && origin.protocol !== "https:") || origin.origin !== allowedOrigin) {
    throw new Error("An exact HTTPS browser origin is required (loopback HTTP is development-only)");
  }
  if (!Number.isInteger(maxConnections) || maxConnections < 1) throw new Error("Invalid connection limit");
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 1) throw new Error("Invalid heartbeat interval");
  let closing = false;
  const health = (request, response) => {
    const healthy = request.method === "GET" && request.url === "/healthz";
    response.writeHead(healthy ? closing ? 503 : 200 : 404, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
    response.end(healthy ? closing ? "draining" : "ok" : "not found");
  };
  const server = tls ? createHTTPSServer(tls, health) : createHTTPServer(health);
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false });
  const alive = new WeakSet();
  server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    const isAgent = request.url === "/api/realtime/agent";
    const isBrowser = request.url === "/api/realtime/browser";
    // Only enable this behind a private proxy that replaces, never appends, this header.
    const insecureProxy = trustProxy && !tls && request.headers["x-forwarded-proto"] !== "https";
    if (closing || insecureProxy || (!isAgent && !isBrowser) || (isAgent && request.headers.origin) ||
        (isBrowser && request.headers.origin !== allowedOrigin) || wss.clients.size >= maxConnections) {
      socket.end(`HTTP/1.1 ${closing ? "503 Service Unavailable" : "403 Forbidden"}\r\nConnection: close\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      alive.add(ws);
      ws.on("pong", () => alive.add(ws));
      try { (isAgent ? agent : browser)(ws); }
      catch {
        console.error("[Realtime relay] Socket initialization failed");
        ws.terminate();
      }
    });
  });
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws) || ws.bufferedAmount > 4 * 1024 * 1024) { ws.terminate(); continue; }
      alive.delete(ws);
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
  }, heartbeatMs);
  timer.unref();
  let closePromise;
  return {
    server,
    close({ graceMs = 0 } = {}) {
      if (closePromise) return closePromise;
      if (!Number.isInteger(graceMs) || graceMs < 0 || graceMs > 300000) throw new Error("Invalid shutdown grace");
      closing = true;
      closePromise = (async () => {
        if (graceMs && wss.clients.size) await new Promise(resolve => setTimeout(resolve, graceMs));
        clearInterval(timer);
        for (const ws of wss.clients) ws.terminate();
        await Promise.all([
          new Promise((resolve, reject) => wss.close(error => error ? reject(error) : resolve())),
          new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
        ]);
      })();
      return closePromise;
    },
  };
}

async function main() {
  loadRealtimeEnvironment();
  const config = realtimeConfiguration();
  const [{ attachAgentSocket, startCommandRecovery }, { attachBrowserSocket }, { createLocalPresence }] = await Promise.all([
    import("../dist/realtime/lib/realtime/agent-socket.js"),
    import("../dist/realtime/lib/realtime/browser-socket.js"),
    import("../dist/realtime/lib/realtime/local-presence.js"),
  ]);
  const localPresence = createLocalPresence();
  const relay = createRealtimeRelay({
    agent: (ws) => attachAgentSocket(ws, localPresence),
    browser: (ws) => attachBrowserSocket(ws, localPresence),
    allowedOrigin: config.allowedOrigin,
    allowDevelopmentOrigin: config.allowDevelopmentOrigin,
    trustProxy: config.trustProxy,
    maxConnections: config.maxConnections,
    tls: config.cert ? { cert: readFileSync(config.cert), key: readFileSync(config.key), minVersion: "TLSv1.2" } : undefined,
  });
  await new Promise((resolve, reject) => {
    relay.server.once("error", reject);
    relay.server.listen(config.port, config.host, resolve);
  });
  console.log("Realtime relay listening", config.host, config.port);
  const stopCommandRecovery = startCommandRecovery();
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log("Realtime relay draining");
    stopCommandRecovery();
    void relay.close({ graceMs: config.shutdownGraceMs }).catch(() => {
      console.error("[Realtime relay] Shutdown failed"); process.exitCode = 1;
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Realtime relay startup failed: check the environment file, compiled handlers, credentials, TLS, browser origin and bind configuration");
    process.exitCode = 1;
  });
}
