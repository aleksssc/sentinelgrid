import assert from "node:assert/strict";
import { dashboardLoader } from "./dashboard-test-loader.mjs";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { WebSocket } from "ws";
import { createRealtimeRelay } from "../relay/realtime-relay.mjs";

const require = createRequire(import.meta.url);

function browserHandler(access) {
  const source = readFileSync(new URL("../lib/realtime/browser-socket.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const subscriptions = [];
  const admin = {
    auth: { getUser: async token => ({ data: { user: token === "valid" ? { id: access.userId } : null }, error: null }) },
    from(table) {
      const data = table === "devices" ? { id: "device", client_id: "client" } : table === "clients" ? { id: "client", organization_id: "organization" } : null;
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data, error: null }) };
      return query;
    },
  };
  const core = {
    resolveOrganizationAccessForUser: async (_admin, organizationId, userId) => organizationId === "organization" && userId === access.userId ? access : null,
    accessHasPermission: (value, permission) => (value.role === "owner" || value.role === "admin") && permission === "devices.terminal",
    accessHasFeature: (value, feature) => dashboardLoader()("lib/organization-access-core.ts").accessHasFeature(value, feature),
  };
  const dependencies = {
    "@supabase/supabase-js": { createClient: () => admin },
    "../organization-access-core": core,
    "./redis": { getRedis: () => ({ get: async () => "online" }) },
    "./pubsub": {
      agentCommandChannel: id => `agent:${id}`,
      agentPresenceKey: id => `presence:${id}`,
      browserResultChannel: id => `result:${id}`,
      publishRealtimeMessage: async () => { throw new Error("command must not be published during auth"); },
      subscribeRealtimeChannel: channel => {
        subscriptions.push(channel);
        let resolve;
        return { done: new Promise(value => { resolve = value; }), abort: () => resolve() };
      },
    },
  };
  const exports = {};
  new Function("require", "exports", code)(name => dependencies[name] ?? require(name), exports);
  return { attachBrowserSocket: exports.attachBrowserSocket, subscriptions };
}

function organizationAccess({ userId, role, plan, status }) {
  return { organizationId: "organization", ownerId: "owner", userId, role, subscription: { organizationId: "organization", plan, status, customLimits: {} } };
}

test("Terminal realtime authentication requires the organization entitlement and terminal role", { timeout: 10000 }, async t => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://isolated.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-service-key";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  });

  const cases = [
    ["free owner", organizationAccess({ userId: "owner", role: "owner", plan: "free", status: "active" }), true],
    ["pro owner", organizationAccess({ userId: "owner", role: "owner", plan: "pro", status: "active" }), true],
    ["invited free admin in pro organization", organizationAccess({ userId: "admin", role: "admin", plan: "pro", status: "active" }), true],
    ["pro member", organizationAccess({ userId: "member", role: "member", plan: "pro", status: "active" }), false],
    ["restricted pro owner", organizationAccess({ userId: "owner", role: "owner", plan: "pro", status: "restricted" }), true],
    ["canceled pro admin", organizationAccess({ userId: "admin", role: "admin", plan: "pro", status: "canceled" }), true],
    ["past due pro owner", organizationAccess({ userId: "owner", role: "owner", plan: "pro", status: "past_due" }), true],
    ["grace period pro owner", organizationAccess({ userId: "owner", role: "owner", plan: "pro", status: "grace_period" }), true],
  ];

  for (const [name, access, allowed] of cases) {
    const handler = browserHandler(access);
    const relay = createRealtimeRelay({ allowedOrigin: "https://app.example", agent: () => {}, browser: handler.attachBrowserSocket });
    relay.server.listen(0, "127.0.0.1");
    await once(relay.server, "listening");
    const ws = new WebSocket(`ws://127.0.0.1:${relay.server.address().port}/api/realtime/browser`, { headers: { Origin: "https://app.example" } });
    await once(ws, "open");
    if (allowed) {
      const message = once(ws, "message");
      ws.send(JSON.stringify({ type: "browser_auth", access_token: "valid", device_id: "device" }));
      assert.equal(JSON.parse((await message)[0].toString()).type, "browser_authenticated", name);
      assert.equal(handler.subscriptions.length, 1, name);
      const closed = once(ws, "close"); ws.close(); await closed;
    } else {
      const closed = once(ws, "close");
      ws.send(JSON.stringify({ type: "browser_auth", access_token: "valid", device_id: "device" }));
      assert.equal((await closed)[0], 4403, name);
      assert.equal(handler.subscriptions.length, 0, name);
    }
    await relay.close();
  }
});
