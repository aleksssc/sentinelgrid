import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createRDPRelay, rdpRelayConfiguration } from "../relay/rdp-relay.mjs";

const token = () => randomBytes(32).toString("base64url");
const message = (ws) => once(ws, "message").then(([data, binary]) => ({ data, binary }));
const relayCredentials = {
  SENTINELGRID_RDP_BACKEND_URL: "https://app.example",
  SENTINELGRID_RDP_RELAY_SECRET: "a".repeat(64),
};

async function fixture(t, options = {}) {
  const tickets = new Map();
  const ended = [];
  let live = true;
  const relay = createRDPRelay({ pairMs: 300, pollMs: 30, ...options, authorize: async (body) => {
    if (body.operation === "finish") { ended.push(body); return { ok: true }; }
    if (!live) throw new Error("REVOKED");
    if (body.operation === "redeem") {
      const entry = tickets.get(body.ticket);
      tickets.delete(body.ticket);
      if (!entry) throw new Error("INVALID_TICKET");
      return entry;
    }
    return { ok: true, idleSeconds: 60 };
  } });
  relay.server.listen(0, "127.0.0.1");
  await once(relay.server, "listening");
  t.after(() => relay.close());
  const url = `ws://127.0.0.1:${relay.server.address().port}/rdp`;
  const proxyHeaders = options.trustProxy ? { "X-Forwarded-Proto": "https" } : {};
  function issue(role, sessionId = randomUUID()) {
    const ticket = token();
    tickets.set(ticket, { role, sessionId, idleSeconds: 60, expiresAt: new Date(Date.now() + (options.lifetimeMs ?? 10000)).toISOString() });
    return ticket;
  }
  function connect(ticket, headers = {}) {
    return new WebSocket(url, { headers: { Authorization: `Bearer ${ticket}`, ...proxyHeaders, ...headers } });
  }
  async function pair(sessionId = randomUUID()) {
    const client = connect(issue("client", sessionId));
    const clientReady = message(client);
    await once(client, "open");
    const agent = connect(issue("agent", sessionId));
    const agentReady = message(agent);
    await Promise.all([clientReady, agentReady]);
    return { client, agent, sessionId };
  }
  return { ...relay, pair, issue, connect, ended, revoke: () => { live = false; } };
}

test("RDP relay configuration preserves secure startup defaults and Railway port priority", () => {
  const defaults = rdpRelayConfiguration(relayCredentials);
  assert.equal(defaults.host, "127.0.0.1");
  assert.equal(defaults.port, 8443);
  assert.equal(defaults.trustProxy, false);
  assert.equal(rdpRelayConfiguration({ ...relayCredentials, PORT: "9000" }).port, 9000);
  assert.equal(rdpRelayConfiguration({ ...relayCredentials, PORT: "9000", SENTINELGRID_RELAY_PORT: "9001" }).port, 9001);
  assert.throws(() => rdpRelayConfiguration({ ...relayCredentials, SENTINELGRID_RELAY_BIND: "0.0.0.0" }), /Cleartext relay/);
  assert.throws(() => rdpRelayConfiguration({ ...relayCredentials, SENTINELGRID_RDP_TRUST_PROXY: "yes" }), /Invalid RDP TLS proxy setting/);
  assert.throws(() => rdpRelayConfiguration({ ...relayCredentials, SENTINELGRID_RELAY_TLS_CERT: "cert.pem" }), /Both relay TLS/);
  const proxied = rdpRelayConfiguration({ ...relayCredentials, SENTINELGRID_RELAY_BIND: "0.0.0.0", SENTINELGRID_RDP_TRUST_PROXY: "true" });
  assert.equal(proxied.trustProxy, true);
  assert.equal(proxied.host, "0.0.0.0");
  const directTLS = rdpRelayConfiguration({ ...relayCredentials, SENTINELGRID_RELAY_BIND: "0.0.0.0", SENTINELGRID_RELAY_TLS_CERT: "cert.pem", SENTINELGRID_RELAY_TLS_KEY: "key.pem" });
  assert.equal(directTLS.trustProxy, false);
  assert.equal(directTLS.cert, "cert.pem");
});

test("private TLS proxy accepts only an exact HTTPS forwarding header", { timeout: 5000 }, async (t) => {
  const f = await fixture(t, { trustProxy: true });
  for (const headers of [{ "X-Forwarded-Proto": "http" }, { "X-Forwarded-Proto": "https,http" }]) {
    const ws = f.connect(f.issue("client"), headers);
    await once(ws, "error");
  }
  const { client, agent } = await f.pair();
  const incoming = message(agent);
  client.send(Buffer.from("proxied secure transport"));
  assert.equal((await incoming).data.toString(), "proxied secure transport");
  const closed = once(agent, "close");
  client.close();
  await closed;
});

test("paired native sockets forward binary bytes both ways and close together", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const { client, agent } = await f.pair();
  for (const size of [1, 4096, 65536]) {
    const bytes = randomBytes(size);
    const incoming = message(agent);
    client.send(bytes);
    const received = await incoming;
    assert.equal(received.binary, true);
    assert.deepEqual(received.data, bytes);
    const reply = message(client);
    agent.send(bytes);
    assert.deepEqual((await reply).data, bytes);
  }
  const closed = once(agent, "close");
  client.close();
  await closed;
  assert.equal(f.ended.length, 1);
});

test("tickets cannot replay, origin-bearing browser sockets cannot attach", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const ticket = f.issue("client");
  const first = f.connect(ticket);
  await once(first, "open");
  for (const [credential, headers] of [[ticket, {}], [token(), {}], [f.issue("agent"), { Origin: "https://untrusted.example" }]]) {
    const ws = f.connect(credential, headers);
    await once(ws, "error");
  }
  first.terminate();
});

test("different device/session identities never pair", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const client = f.connect(f.issue("client"));
  const agent = f.connect(f.issue("agent"));
  await Promise.all([once(client, "close"), once(agent, "close")]);
  assert.equal(f.ended.length, 2);
  assert.ok(f.ended.every((entry) => entry.failed));
});

test("revocation and policy-service failure disconnect both ends", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const { client, agent } = await f.pair();
  const closed = Promise.all([once(client, "close"), once(agent, "close")]);
  f.revoke();
  await closed;
  assert.equal(f.ended[0].failed, true);
});

test("text and oversize data are rejected, not forwarded", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  for (const payload of ["arbitrary instruction", randomBytes(65537)]) {
    const { client, agent } = await f.pair();
    const closed = once(agent, "close");
    client.send(payload);
    await closed;
  }
});

test("duplicate role cannot replace an attached socket", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const { client, agent, sessionId } = await f.pair();
  const duplicate = f.connect(f.issue("client", sessionId));
  await once(duplicate, "close");
  const incoming = message(agent);
  client.send(Buffer.from("original"));
  assert.equal((await incoming).data.toString(), "original");
  client.close();
});

test("session expiry closes both peers and capacity still allows the matching second peer", { timeout: 5000 }, async (t) => {
  const f = await fixture(t, { maxSessions: 1, lifetimeMs: 150 });
  const { client, agent } = await f.pair();
  await Promise.all([once(client, "close"), once(agent, "close")]);
  assert.equal(f.ended.length, 1);
  assert.equal(f.ended[0].failed, false);
});
