import { createServer as createHTTPServer } from "node:http";
import { createServer as createHTTPSServer } from "node:https";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

export function createRealtimeRelay({ agent, browser, allowedOrigin, tls, maxConnections = 2000, heartbeatMs = 30000 }) {
  const origin = new URL(allowedOrigin);
  if (origin.protocol !== "https:" || origin.origin !== allowedOrigin) throw new Error("An exact HTTPS browser origin is required");
  if (!Number.isInteger(maxConnections) || maxConnections < 1) throw new Error("Invalid connection limit");
  const health = (request, response) => {
    const healthy = request.method === "GET" && request.url === "/healthz";
    response.writeHead(healthy ? 200 : 404, { "Cache-Control": "no-store" });
    response.end(healthy ? "ok" : "not found");
  };
  const server = tls ? createHTTPSServer(tls, health) : createHTTPServer(health);
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false });
  const alive = new WeakSet();
  let closing = false;
  server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    const isAgent = request.url === "/api/realtime/agent";
    const isBrowser = request.url === "/api/realtime/browser";
    if (closing || (!isAgent && !isBrowser) || (isAgent && request.headers.origin) ||
        (isBrowser && request.headers.origin !== allowedOrigin) || wss.clients.size >= maxConnections) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
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
    close() {
      if (closePromise) return closePromise;
      closing = true;
      clearInterval(timer);
      for (const ws of wss.clients) ws.terminate();
      closePromise = Promise.all([
        new Promise((resolve, reject) => wss.close(error => error ? reject(error) : resolve())),
        new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
      ]).then(() => undefined);
      return closePromise;
    },
  };
}

async function main() {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "UPSTASH_REDIS_KV_REST_API_URL", "UPSTASH_REDIS_KV_REST_API_TOKEN"]) {
    if (!process.env[name]) throw new Error(`Missing ${name}`);
  }
  const cert = process.env.SENTINELGRID_REALTIME_TLS_CERT;
  const key = process.env.SENTINELGRID_REALTIME_TLS_KEY;
  if (!!cert !== !!key) throw new Error("Both realtime TLS files are required");
  const host = process.env.SENTINELGRID_REALTIME_BIND ?? "127.0.0.1";
  if (!cert && host !== "127.0.0.1" && host !== "::1") throw new Error("Cleartext realtime must bind loopback behind a TLS proxy");
  const port = Number(process.env.SENTINELGRID_REALTIME_PORT ?? "8444");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid realtime port");
  const [{ attachAgentSocket, startCommandRecovery }, { attachBrowserSocket }] = await Promise.all([
    import("../dist/realtime/lib/realtime/agent-socket.js"),
    import("../dist/realtime/lib/realtime/browser-socket.js"),
  ]);
  const relay = createRealtimeRelay({
    agent: attachAgentSocket, browser: attachBrowserSocket,
    allowedOrigin: process.env.SENTINELGRID_REALTIME_BROWSER_ORIGIN,
    maxConnections: Number(process.env.SENTINELGRID_REALTIME_MAX_CONNECTIONS ?? "2000"),
    tls: cert ? { cert: readFileSync(cert), key: readFileSync(key), minVersion: "TLSv1.2" } : undefined,
  });
  await new Promise((resolve, reject) => {
    relay.server.once("error", reject);
    relay.server.listen(port, host, resolve);
  });
  console.log("Realtime relay listening", host, port);
  const stopCommandRecovery = startCommandRecovery();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
    stopCommandRecovery();
    void relay.close().catch(() => { console.error("[Realtime relay] Shutdown failed"); process.exitCode = 1; });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Realtime relay startup failed: check the compiled handlers, credentials, TLS, browser origin and bind configuration");
    process.exitCode = 1;
  });
}
