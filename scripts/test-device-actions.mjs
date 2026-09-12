import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { WebSocket } from "ws";
import { createRealtimeRelay } from "../relay/realtime-relay.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith(".")) return load(new URL(`${name}.ts`, new URL(path, import.meta.url)).href, mocks);
    return require(name);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const definitions = load("../lib/remote/action-definitions.ts");
const lifecycle = load("../lib/realtime/typed-commands.ts");

function database(rows) {
  const history = [];
  let failure;
  return {
    rows, history,
    failNext(table) { failure = table; },
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from(table) {
      const filters = [];
      let operation, values, one = false, take = Infinity;
      const q = {
        select() { return q; },
        is(key, value) { filters.push((r) => value === null ? r[key] == null : r[key] === value); return q; },
        eq(key, value) { filters.push((r) => r[key] === value); return q; },
        neq(key, value) { filters.push((r) => r[key] !== value); return q; },
        in(key, values) { filters.push((r) => values.includes(r[key])); return q; },
        gt(key, value) { filters.push((r) => r[key] > value); return q; },
        lte(key, value) { filters.push((r) => r[key] <= value); return q; },
        order() { return q; }, limit(n) { take = n; return q; },
        maybeSingle() { one = true; return q; }, single() { one = true; return q; },
        update(value) { operation = "update"; values = value; return q; },
        insert(value) { operation = "insert"; values = value; return q; },
        upsert(value) { operation = "upsert"; values = value; return q; },
        then(resolve, reject) {
          if (failure === table) { failure = undefined; return Promise.resolve({ data: null, error: { code: "TEST_FAILURE" } }).then(resolve, reject); }
          rows[table] ??= [];
          let found = rows[table].filter((r) => filters.every((f) => f(r))).slice(0, take);
          if (operation === "update") { for (const r of found) { Object.assign(r, values); history.push({ table, ...structuredClone(r) }); } }
          if (operation === "insert" || operation === "upsert") {
            const existing = operation === "upsert" && rows[table].find((r) => r.id === values.id);
            if (!existing) { const record = { id: `generated-${history.length}`, status: "queued", created_at: new Date().toISOString(), ...values }; rows[table].push(record); found = [record]; history.push({ table, ...record }); }
          }
          return Promise.resolve({ data: one ? found[0] ?? null : structuredClone(found), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}
const command = (type = "flush_dns", extra = {}) => ({ id: `command-${type}`, device_id: "device", organization_id: "org", requested_by: "owner",
  command_type: type, status: "queued", result: {}, expires_at: new Date(Date.now() + 300000).toISOString(), ...extra });

test("real WebSocket dispatcher and persistence share all eight action lifecycles", { timeout: 10000 }, async (t) => {
  const oldURL = process.env.NEXT_PUBLIC_SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://isolated.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-key";
  const db = database({ devices: [{ id: "device", agent_id: "agent", hostname: "isolated", agent_token_hash: createHash("sha256").update("synthetic-agent-token").digest("hex") }], device_commands: [] });
  const subscriptions = new Map();
  const pubsub = {
    agentPresenceKey: (id) => `presence:${id}`, agentCommandChannel: (id) => `commands:${id}`, browserResultChannel: (id) => `result:${id}`,
    publishRealtimeMessage: async () => {},
    subscribeRealtimeChannel(channel, callback) {
      subscriptions.set(channel, callback);
      let resolve;
      const done = new Promise((r) => { resolve = r; });
      return { done, abort() { subscriptions.delete(channel); resolve(); } };
    },
  };
  const { attachAgentSocket } = load("../lib/realtime/agent-socket.ts", {
    "@supabase/supabase-js": { createClient: () => db }, "./typed-commands": lifecycle,
    "./redis": { getRedis: () => ({ set: async () => "OK" }) }, "./pubsub": pubsub,
  });
  const relay = createRealtimeRelay({ agent: attachAgentSocket, browser: () => {}, allowedOrigin: "https://isolated.example" });
  relay.server.listen(0, "127.0.0.1"); await once(relay.server, "listening");
  t.after(async () => {
    await relay.close();
    if (oldURL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldURL;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  });
  const ws = new WebSocket(`ws://127.0.0.1:${relay.server.address().port}/api/realtime/agent`);
  await once(ws, "open");
  const receive = () => once(ws, "message").then(([raw]) => JSON.parse(raw.toString()));
  let response = receive();
  ws.send(JSON.stringify({ type: "agent_auth", agent_token: "synthetic-agent-token", device_id: "device", agent_id: "agent" }));
  assert.equal((await response).type, "authenticated");
  await new Promise((resolve) => setTimeout(resolve, 25));
  for (const { type } of definitions.DEVICE_ACTIONS) {
    const row = command(type, { status: "dispatched", payload: {}, idempotency_key: `key-${type}`, created_at: new Date().toISOString() });
    db.rows.device_commands.push(row);
    response = receive();
    await subscriptions.get("commands:device")({ type: "typed_command", command_id: row.id, command_type: "untrusted-payload" });
    assert.equal((await response).command_type, type);
    for (const [kind, status] of [["typed_command_ack", "acknowledged"], ["typed_command_running", "running"], ["typed_command_result", "succeeded"]]) {
      response = receive(); ws.send(JSON.stringify({ type: kind, command_id: row.id, status, result: { exit_code: 0 } }));
      const receipt = await response;
      assert.equal(receipt.type, "typed_command_receipt"); assert.equal(receipt.status, status); assert.equal(row.status, status);
    }
  }
});

test("all eight actions use the same typed command lifecycle, scoped and idempotent", async () => {
  for (const { type } of definitions.DEVICE_ACTIONS) {
    const row = command(type), db = database({ device_commands: [row] });
    row.status = "dispatched";
    for (const [kind, status] of [["typed_command_ack", "acknowledged"], ["typed_command_running", "running"], ["typed_command_result", "succeeded"]]) {
      assert.equal(await lifecycle.acceptTypedResult(db, "device", { type: kind, command_id: row.id, status, result: { exit_code: 0 } }), status);
      assert.equal(row.status, status);
    }
    await lifecycle.acceptTypedResult(db, "device", { type: "typed_command_result", command_id: row.id, status: "failed", error_code: "DUPLICATE" });
    assert.equal(row.status, "succeeded");
    assert.equal(db.rows.audit_logs.length, 1);
    assert.equal(db.rows.audit_logs[0].metadata.commandType, type);
    assert.deepEqual(db.history.filter((v) => v.table === "device_commands").map((v) => v.status), ["acknowledged", "running", "succeeded"]);
  }
});

test("only orphaned update commands expire; correlated update transactions remain authoritative", async () => {
  const old = new Date(Date.now() - 3600000).toISOString();
  const orphan = command("update_agent", { expires_at: old, status: "running" });
  const correlated = command("update_agent", { id: "correlated", expires_at: old, status: "running", update_transaction_id: "transaction" });
  const db = database({ device_commands: [orphan, correlated] });
  await lifecycle.recoverTypedCommands(db);
  assert.equal(orphan.status, "failed"); assert.equal(orphan.error_code, "COMMAND_TIMEOUT");
  assert.equal(correlated.status, "running");
});

test("wrong-device results and generic results for correlated updates cannot change commands", async () => {
  const row = command(), update = command("update_agent", { status: "running", update_transaction_id: "transaction" });
  const db = database({ device_commands: [row, update] });
  await lifecycle.acceptTypedResult(db, "other-device", { type: "typed_command_result", command_id: row.id, status: "succeeded" });
  await lifecycle.acceptTypedResult(db, "device", { type: "typed_command_result", command_id: update.id, status: "succeeded" });
  assert.equal(row.status, "queued"); assert.equal(update.status, "running"); assert.equal(db.history.length, 0);
});

test("late acknowledgements never regress running and failed output is retained", async () => {
  const row = command("gpupdate", { status: "running" }), db = database({ device_commands: [row] });
  await lifecycle.acceptTypedResult(db, "device", { type: "typed_command_ack", command_id: row.id });
  assert.equal(row.status, "running");
  await lifecycle.acceptTypedResult(db, "device", { type: "typed_command_result", command_id: row.id, status: "failed", result: { exit_code: 5, stdout: "out", stderr: "err" }, error_code: "GPUPDATE_FAILED", error_message: "Windows rejected policy refresh" });
  assert.equal(row.error_code, "GPUPDATE_FAILED"); assert.equal(row.result.stderr, "err");
});

test("expired commands fail, accepted shutdown goes offline successfully, updates are untouched", async () => {
  const past = new Date(Date.now() - 600000).toISOString();
  const rows = [command("gpupdate", { status: "running", expires_at: past }), command("shutdown", { status: "running", expires_at: past,
    result: { power_accepted: true, exit_code: 0, scheduled_at: past } }), command("update_agent", { status: "running", expires_at: past })];
  const db = database({ device_commands: rows, devices: [{ id: "device", last_seen: past }] });
  await lifecycle.recoverTypedCommands(db);
  assert.equal(rows[0].error_code, "COMMAND_TIMEOUT");
  assert.equal(rows[1].status, "succeeded");
  assert.equal(rows[2].status, "running");
  assert.equal(db.rows.audit_logs.length, 2);
});

test("offline without Windows acceptance cannot prove shutdown; queued replay excludes terminal and expired", async () => {
  const row = command("shutdown", { status: "running", expires_at: new Date(0).toISOString() });
  const pending = command("lock", { status: "dispatched" });
  const db = database({ device_commands: [row, pending, command("gpupdate", { status: "succeeded" })] });
  await lifecycle.recoverTypedCommands(db);
  assert.equal(row.status, "failed");
  assert.deepEqual((await lifecycle.pendingTypedCommands(db, "device")).map((r) => r.command_id), [pending.id]);
  assert.equal((await lifecycle.pendingTypedCommands(db, "other")).length, 0);
});

test("database failure withholds running receipt and terminal result acknowledgement", async () => {
  const row = command(), db = database({ device_commands: [row] });
  db.failNext("device_commands");
  await assert.rejects(lifecycle.acceptTypedResult(db, "device", { type: "typed_command_running", command_id: row.id }), /COMMAND_LOOKUP_FAILED/);
  assert.equal(row.status, "queued");
});

test("expired running receipts never authorize execution and audit retries are idempotent", async () => {
  const expired = command("lock", { expires_at: new Date(0).toISOString() });
  const db = database({ device_commands: [expired] });
  const status = await lifecycle.acceptTypedResult(db, "device", { type: "typed_command_running", command_id: expired.id });
  assert.equal(status, "failed"); assert.equal(expired.error_code, "COMMAND_EXPIRED");
  const row = command("flush_dns", { status: "running" });
  db.rows.device_commands.push(row);
  db.failNext("audit_logs");
  const result = { type: "typed_command_result", command_id: row.id, status: "succeeded", result: { exit_code: 0 } };
  await assert.rejects(lifecycle.acceptTypedResult(db, "device", result), /COMMAND_AUDIT_SAVE_FAILED/);
  assert.equal(row.status, "succeeded");
  assert.equal(await lifecycle.acceptTypedResult(db, "device", result), "succeeded");
  await lifecycle.acceptTypedResult(db, "device", result);
  assert.equal(db.rows.audit_logs.filter((audit) => audit.id === row.id).length, 1);
});

function apiFixture() {
  const db = database({ devices: [{ id: "device", client_id: "client", agent_version: "0.1.7", last_seen: new Date().toISOString(), capabilities: { commands: true, force_inventory: true, restart_agent: true, agent_update: false } }],
    clients: [{ id: "client", organization_id: "org" }], organizations: [{ id: "org", owner_id: "owner" }], device_commands: [] });
  const published = [];
  let locked = false;
  const commands = load("../lib/remote/commands.ts", {
    "server-only": {}, "@/lib/supabase/server": { createClient: async () => db }, "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/audit/create-audit-log": { createAuditLog: async (entry) => { published.push({ audit: entry }); } },
    "@/lib/realtime/pubsub": { agentCommandChannel: (id) => `commands:${id}`, publishRealtimeMessage: async (channel, payload) => published.push({ channel, payload }) },
    "@/lib/realtime/redis": { getRedis: () => ({ set: async () => { if (locked) return null; locked = true; return "OK"; }, eval: async () => { locked = false; } }) },
    "@/lib/realtime/typed-commands": lifecycle, "@/lib/remote/rate-limit": { enforceRemoteRateLimit: async () => {} },
  });
  return { db, commands, published };
}

test("API authorizes ownership before idempotency, validates every payload and blocks concurrent commands", async () => {
  const { db, commands, published } = apiFixture();
  for (const { type } of definitions.DEVICE_ACTIONS) {
    assert.deepEqual(commands.validatePayload(type, {}), {});
    for (const bad of [null, [], "x", { script: "arbitrary" }]) assert.throws(() => commands.validatePayload(type, bad), /INVALID_PAYLOAD/);
  }
  const input = { deviceId: "device", commandType: "force_inventory", idempotencyKey: "same-request" };
  const first = await commands.createQuickAction(input);
  assert.equal(first.status, "dispatched");
  assert.equal(published[1].channel, "commands:device"); assert.equal(published[1].payload.type, "typed_command");
  assert.equal((await commands.createQuickAction(input)).commandId, first.commandId);
  await assert.rejects(commands.createQuickAction({ ...input, idempotencyKey: "second-request" }), /COMMAND_BUSY/);
  db.rows.organizations[0].owner_id = "other";
  await assert.rejects(commands.createQuickAction(input), /FORBIDDEN/);
  assert.equal(db.rows.device_commands.length, 1);
});

test("all actions remain requestable with missing or stale capabilities and use the existing audited pipeline", async () => {
  for (const capabilities of [undefined, {}, { commands: false, force_inventory: false, restart_agent: false, agent_update: false }]) {
    for (const { type } of definitions.DEVICE_ACTIONS) {
      const { db, commands, published } = apiFixture();
      db.rows.devices[0].capabilities = capabilities;
      const reasons = await commands.quickActionAvailability("device");
      assert.ok(Object.values(reasons).every((reason) => reason === null));
      const result = await commands.createQuickAction({ deviceId: "device", commandType: type });
      assert.equal(result.status, "dispatched");
      assert.equal(db.rows.device_commands[0].command_type, type);
      assert.equal(db.rows.device_commands[0].organization_id, "org");
      assert.equal(published[0].audit.metadata.commandId, result.commandId);
      assert.equal(published[0].audit.metadata.commandType, type);
      assert.equal(published[1].channel, "commands:device");
      assert.equal(published[1].payload.command_id, result.commandId);
      assert.equal(published[1].payload.type, "typed_command");
      assert.equal(published[1].payload.command_type, type);
      assert.deepEqual(published[1].payload.payload, {});
    }
  }
});

test("Update Agent requests a live check without duplicating release eligibility or installation gates", async (t) => {
  const old = process.env.SENTINELGRID_AGENT_UPDATES_ENABLED;
  delete process.env.SENTINELGRID_AGENT_UPDATES_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.SENTINELGRID_AGENT_UPDATES_ENABLED; else process.env.SENTINELGRID_AGENT_UPDATES_ENABLED = old; });
  const { db, commands, published } = apiFixture();
  db.rows.devices[0].agent_version = null;
  db.rows.agent_update_transactions = [{ id: "failure", device_id: "device", target_version: "0.1.8", status: "failed" }];
  const from = db.from.bind(db);
  db.from = (table) => {
    assert.ok(!["agent_releases", "organization_agent_update_settings"].includes(table), `unexpected release preflight: ${table}`);
    return from(table);
  };
  assert.equal((await commands.quickActionAvailability("device")).update_agent, null);
  const result = await commands.createQuickAction({ deviceId: "device", commandType: "update_agent" });
  assert.equal(result.status, "dispatched");
  assert.equal(published[1].payload.command_type, "update_agent");
  assert.equal(db.rows.device_commands[0].status, "dispatched");
});

test("offline, organization policy, authorization and device isolation still guard every action", async () => {
  for (const { type } of definitions.DEVICE_ACTIONS) {
    const { db, commands, published } = apiFixture();
    const input = { deviceId: "device", commandType: type };
    db.rows.devices[0].last_seen = new Date(0).toISOString();
    assert.ok(Object.values(await commands.quickActionAvailability("device")).every((r) => r === "Device is offline"));
    await assert.rejects(commands.createQuickAction(input), /DEVICE_OFFLINE/);
    db.rows.devices[0].last_seen = new Date().toISOString();
    db.rows.organization_remote_access_settings = [{ organization_id: "org", remote_access_enabled: false }];
    assert.ok(Object.values(await commands.quickActionAvailability("device")).every((r) => r === "Remote actions are disabled by organization policy"));
    await assert.rejects(commands.createQuickAction(input), /REMOTE_ACCESS_DISABLED/);
    db.rows.organization_remote_access_settings = [];
    db.rows.organizations[0].owner_id = "other";
    db.rows.organization_members = [{ organization_id: "org", user_id: "owner", role: "member" }, { organization_id: "other-org", user_id: "owner", role: "admin" }];
    await assert.rejects(commands.quickActionAvailability("device"), /FORBIDDEN/);
    await assert.rejects(commands.createQuickAction(input), /FORBIDDEN/);
    await assert.rejects(commands.createQuickAction({ ...input, deviceId: "other-device" }), /DEVICE_NOT_FOUND/);
    db.auth.getUser = async () => ({ data: { user: null } });
    await assert.rejects(commands.createQuickAction(input), /UNAUTHORIZED/);
    assert.equal(published.length, 0);
    assert.equal(db.rows.device_commands.length, 0);
  }
});

test("active updates block incompatible commands only on their own device", async () => {
  const { db, commands } = apiFixture();
  db.rows.agent_update_transactions = [{ id: "active", device_id: "other-device", status: "installing" }];
  assert.ok(Object.values(await commands.quickActionAvailability("device")).every((r) => r === null));
  db.rows.agent_update_transactions[0].device_id = "device";
  const incompatible = ["restart_agent", "update_agent", "reboot", "shutdown"];
  const reasons = await commands.quickActionAvailability("device");
  for (const { type } of definitions.DEVICE_ACTIONS) {
    assert.equal(reasons[type], incompatible.includes(type) ? "Another device command is already running" : null);
    if (incompatible.includes(type)) await assert.rejects(commands.createQuickAction({ deviceId: "device", commandType: type }), /COMMAND_BUSY/);
  }
  assert.equal(db.rows.device_commands.length, 0);
});

test("menu keeps exact grouping, enables all available actions and retains safety tooltips", async () => {
  const { commands } = apiFixture();
  const reasons = await commands.quickActionAvailability("device");
  const Menu = load("../components/dashboard/devices/device-actions-menu.tsx", {
    "@/lib/remote/action-definitions": definitions,
    react: { ...React, useState: (initial) => [initial === null ? reasons : initial, () => {}] },
  }).default;
  for (const [online, busy, reason] of [[true, false, null], [false, false, "Device is offline"], [true, true, "Another device command is already running"]]) {
    const html = renderToStaticMarkup(React.createElement(Menu, { device: { id: "device", hostname: "test", display_name: null }, online, busy, open: true, onOpenChange() {}, onAction() {} }));
    let previous = -1;
    for (const action of definitions.DEVICE_ACTIONS) { const index = html.indexOf(`>${action.label}</button>`); assert.ok(index > previous, action.label); previous = index; }
    assert.match(html, /Maintenance/);
    assert.equal((html.match(/ disabled=""/g) ?? []).length, reason ? 8 : 0);
    if (reason) assert.ok(html.includes(reason));
    assert.doesNotMatch(html, /Available|Unavailable|Agent update required|Why are some actions disabled/);
  }
});
