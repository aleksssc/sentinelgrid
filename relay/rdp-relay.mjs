import { createServer as createHTTPServer } from "node:http";
import { createServer as createHTTPSServer } from "node:https";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const MAX_FRAME = 2 * 1024 * 1024;

function port(value) {
  const parsed = Number(value ?? 8443);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("Invalid relay port");
  return parsed;
}

export function rdpRelayConfiguration(env = process.env) {
  const backend = new URL(env.SENTINELGRID_RDP_BACKEND_URL ?? "");
  if (backend.protocol !== "https:" || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== "/") {
    throw new Error("SENTINELGRID_RDP_BACKEND_URL must be an HTTPS origin");
  }
  const secret = env.SENTINELGRID_RDP_RELAY_SECRET ?? "";
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("A 32-byte hex relay secret is required");
  const cert = env.SENTINELGRID_RELAY_TLS_CERT;
  const key = env.SENTINELGRID_RELAY_TLS_KEY;
  if (!!cert !== !!key) throw new Error("Both relay TLS certificate and key are required");
  const proxy = env.SENTINELGRID_RDP_TRUST_PROXY;
  if (proxy !== undefined && proxy !== "true" && proxy !== "false") throw new Error("Invalid RDP TLS proxy setting");
  const trustProxy = proxy === "true";
  const host = env.SENTINELGRID_RELAY_BIND ?? "127.0.0.1";
  if (!cert && host !== "127.0.0.1" && host !== "::1" && !trustProxy) {
    throw new Error("Cleartext relay must bind loopback or explicitly trust a private TLS proxy");
  }
  return {
    backend,
    secret,
    cert,
    host,
    key,
    port: port(env.SENTINELGRID_RELAY_PORT ?? env.PORT),
    trustProxy,
  };
}

export function createRDPRelay({ authorize, tls, trustProxy = false, maxSessions = 64, pollMs = 5000, pairMs = 60000 }) {
  const sessions = new Map();
  let pending = 0;
  const health = (request, response) => {
    response.writeHead(request.url === "/healthz" ? 200 : 404, { "Cache-Control": "no-store" });
    response.end(request.url === "/healthz" ? "ok" : "not found");
  };
  const server = tls ? createHTTPSServer(tls, health) : createHTTPServer(health);
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });

  function finish(session, failed) {
    if (session.ended) return;
    session.ended = true;
    clearTimeout(session.pairTimer);
    clearTimeout(session.expiryTimer);
    clearTimeout(session.idleTimer);
    clearInterval(session.pollTimer);
    sessions.delete(session.id);
    for (const ws of [session.client, session.agent]) {
      if (!ws) continue;
      ws.close(failed ? 1011 : 1000, "Session ended");
      setTimeout(() => ws.terminate(), 1000).unref();
    }
    void authorize({ operation: "finish", sessionId: session.id, failed }).catch(() => {
      console.error("[RDP relay] Session close receipt failed", session.id);
    });
  }

  function armIdle(session) {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => finish(session, false), Math.max(0, session.lastActivity + session.idleSeconds * 1000 - Date.now()));
  }

  async function attach(ws, identity) {
    let session = sessions.get(identity.sessionId);
    if (!session) {
      session = { id: identity.sessionId, active: false, ended: false, polling: false, idleSeconds: identity.idleSeconds, lastActivity: Date.now() };
      sessions.set(session.id, session);
      session.pairTimer = setTimeout(() => finish(session, true), pairMs);
      session.expiryTimer = setTimeout(() => finish(session, false), Date.parse(identity.expiresAt) - Date.now());
      armIdle(session);
      session.pollTimer = setInterval(async () => {
        if (session.polling || session.ended) return;
        session.polling = true;
        try {
          const state = await authorize({ operation: "state", sessionId: session.id });
          if (!Number.isInteger(state.idleSeconds) || state.idleSeconds < 60 || state.idleSeconds > 7200) throw new Error("INVALID_POLICY");
          session.idleSeconds = state.idleSeconds;
          if (!session.ended) armIdle(session);
        }
        catch { finish(session, true); }
        finally { session.polling = false; }
      }, pollMs);
    }
    if (session[identity.role]) { ws.terminate(); return; }
    session[identity.role] = ws;
    ws.on("error", () => finish(session, true));
    ws.on("close", () => finish(session, false));
    ws.on("message", (data, binary) => {
      const other = identity.role === "client" ? session.agent : session.client;
      if (!session.active || !binary || !other || other.readyState !== WebSocket.OPEN || other.bufferedAmount > 1024 * 1024) {
        finish(session, true); return;
      }
      ws.pause();
      if (data.length > 0) { session.lastActivity = Date.now(); armIdle(session); }
      other.send(data, { binary: true }, (error) => {
        if (error) finish(session, true);
        else if (!session.ended) ws.resume();
      });
    });
    if (session.client && session.agent) {
      try {
        await authorize({ operation: "active", sessionId: session.id });
        if (session.ended) return;
        clearTimeout(session.pairTimer);
        session.active = true;
        for (const socket of [session.client, session.agent]) socket.send('{"type":"ready"}');
      } catch { finish(session, true); }
    }
  }

  server.on("upgrade", async (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    // In proxy mode the private ingress must replace this header; a client-supplied value is not proof of TLS.
    const proxiedSecure = request.headers["x-forwarded-proto"] === "https";
    if ((!tls && trustProxy && !proxiedSecure) || request.url !== "/rdp" || request.headers.origin || pending >= 32) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    const ticket = /^Bearer +(.+)$/.exec(request.headers.authorization ?? "")?.[1];
    if (!ticket) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    pending++;
    socket.setTimeout(10000, () => socket.destroy());
    try {
      const identity = await authorize({ operation: "redeem", ticket });
      if (!identity || !/^[a-f0-9-]{36}$/i.test(identity.sessionId) || !["client", "agent"].includes(identity.role) ||
          !Number.isInteger(identity.idleSeconds) || identity.idleSeconds < 60 || identity.idleSeconds > 7200 ||
          !Number.isFinite(Date.parse(identity.expiresAt)) || Date.parse(identity.expiresAt) <= Date.now() ||
          Date.parse(identity.expiresAt) > Date.now() + 120 * 60000 || socket.destroyed) throw new Error("DENIED");
      if (!sessions.has(identity.sessionId) && sessions.size >= maxSessions) throw new Error("CAPACITY");
      socket.setTimeout(0);
      wss.handleUpgrade(request, socket, head, (ws) => { void attach(ws, identity); });
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    } finally { pending--; }
  });

  return {
    server,
    async close() {
      for (const session of sessions.values()) finish(session, false);
      wss.close();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function main() {
  const config = rdpRelayConfiguration();
  const relay = createRDPRelay({
    tls: config.cert ? { cert: readFileSync(config.cert), key: readFileSync(config.key), minVersion: "TLSv1.2" } : undefined,
    trustProxy: config.trustProxy,
    authorize: async (body) => {
      const response = await fetch(new URL("/api/remote/rdp/relay", config.backend), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${config.secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("RDP authorization failed");
      return response.json();
    },
  });
  await new Promise((resolve, reject) => {
    relay.server.once("error", reject);
    relay.server.listen(config.port, config.host, resolve);
  });
  console.log("RDP relay listening; one instance per configured relay URL", config.host, config.port);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
    void relay.close().catch(() => { console.error("RDP relay shutdown failed"); process.exitCode = 1; });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("RDP relay startup failed: check TLS, backend origin, relay secret and bind configuration"); process.exitCode = 1; });
}
