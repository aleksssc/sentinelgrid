import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createRDPRelay } from "../relay/rdp-relay.mjs";

async function pairedRelay(t) {
  const tickets = new Map();
  const relay = createRDPRelay({ pairMs: 500, authorize: async (request) => {
    if (request.operation === "finish") return { ok: true };
    if (request.operation === "redeem") {
      const identity = tickets.get(request.ticket);
      tickets.delete(request.ticket);
      if (!identity) throw new Error("invalid ticket");
      return identity;
    }
    return { ok: true, idleSeconds: 60 };
  } });
  relay.server.listen(0, "127.0.0.1");
  await once(relay.server, "listening");
  t.after(() => relay.close());
  const url = `ws://127.0.0.1:${relay.server.address().port}/rdp`;
  const connect = (role, sessionId) => {
    const ticket = randomBytes(32).toString("base64url");
    tickets.set(ticket, { role, sessionId, idleSeconds: 60, expiresAt: new Date(Date.now() + 10_000).toISOString() });
    return new WebSocket(url, { headers: { Authorization: `Bearer ${ticket}` } });
  };
  const sessionId = randomUUID();
  const client = connect("client", sessionId);
  const clientReady = once(client, "message");
  await once(client, "open");
  const agent = connect("agent", sessionId);
  const agentReady = once(agent, "message");
  await once(agent, "open");
  await Promise.all([clientReady, agentReady]);
  return { client, agent };
}

test("normal peer termination is forwarded as Normal Closure, not 1011", async (t) => {
  const { client, agent } = await pairedRelay(t);
  const agentClosed = once(agent, "close");
  client.close();
  const [code, reason] = await agentClosed;
  assert.equal(code, 1000);
  assert.equal(reason.toString(), "Session ended");
});

test("relay protocol failure remains an Internal Server Error close", async (t) => {
  const { client, agent } = await pairedRelay(t);
  const agentClosed = once(agent, "close");
  client.send("invalid text payload");
  const [code, reason] = await agentClosed;
  assert.equal(code, 1011);
  assert.equal(reason.toString(), "Session ended");
});
