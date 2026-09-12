import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const compile = (path, module = ts.ModuleKind.ESNext) => ts.transpileModule(source(path), {
  compilerOptions: { module, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const activity = await import(`data:text/javascript;base64,${Buffer.from(compile("../lib/activity/device-activity.ts")).toString("base64")}`);
const { normalizeDeviceActivity: normalize, filterDeviceActivity: filter, activityDay, formatActivityDuration } = activity;
const deviceId = "device-1";
const at = (clock) => `2026-09-12T${clock}Z`;
const requested = at("14:03:41");
const completed = at("14:06:03");
const event = (id, action, metadata = {}, created_at = requested, extra = {}) => ({
  id, action, metadata, created_at, status: "success", target_id: deviceId, ...extra,
});
const command = (extra = {}) => ({
  id: "cmd-1", device_id: deviceId, command_type: "update_agent", status: "succeeded",
  created_at: requested, completed_at: completed, requested_by: "operator-1", ...extra,
});
const request = event("request", "device.command.requested", { commandId: "cmd-1", commandType: "update_agent" }, requested, { actor_email: "operator@example.test" });
const finish = event("finish", "device.command.succeeded", { commandId: "cmd-1" }, completed);
const update = command({ update_transaction_id: "tx-1", result: { from_version: "0.1.5", target_version: "0.1.7" } });

// Render the real client component using React SSR; only the Next router is replaced.
const require = createRequire(import.meta.url);
const componentModule = { exports: {} };
new Function("require", "module", "exports", compile("../components/dashboard/devices/device-activity.tsx", ts.ModuleKind.CommonJS))(
  (name) => name === "@/lib/activity/device-activity" ? activity : name === "next/navigation" ? { useRouter: () => ({ refresh() {} }) } : require(name),
  componentModule, componentModule.exports,
);
const Timeline = componentModule.exports.default;
const render = (props = {}) => renderToStaticMarkup(React.createElement(Timeline, {
  deviceId, events: [request, finish], commands: [update], now: Date.parse(completed), ...props,
}));

test("requested + succeeded + device_commands become one accurate update", () => {
  const entries = normalize([finish, request], [update], deviceId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Agent updated to 0.1.7");
  assert.equal(entries[0].fromVersion, "0.1.5");
  assert.equal(entries[0].targetVersion, "0.1.7");
  assert.equal(entries[0].summary, "Succeeded in 2m 22s");
  assert.equal(entries[0].status, "succeeded");
  assert.equal(entries[0].requestedBy, "operator@example.test");
  assert.equal(entries[0].transactionId, "tx-1");
  assert.equal(entries[0].events.length, 2);
});

test("an audit success envelope never turns requested/running/failed into success", () => {
  for (const [phase, status] of [["requested", "requested"], ["running", "running"], ["failed", "failed"], ["expired", "failed"], ["dispatched", "queued"], ["acknowledged", "queued"]]) {
    const [entry] = normalize([event("one", `device.command.${phase}`, { commandType: "reboot" })], [], deviceId);
    assert.equal(entry.status, status);
    assert.equal(entry.title, "Restart Computer");
  }
});

test("all quick actions have human labels and action-specific icons", () => {
  const actions = {
    update_agent: ["Update Agent", "update"], restart_agent: ["Restart Agent", "restart"],
    reboot: ["Restart Computer", "restart"], shutdown: ["Shutdown Computer", "shutdown"],
    lock: ["Lock Computer", "lock"], flush_dns: ["Flush DNS", "network"],
    gpupdate: ["GPUpdate", "system"], force_inventory: ["Force Inventory", "inventory"],
    terminal: ["Terminal session", "terminal"],
  };
  for (const [type, [title, icon]] of Object.entries(actions)) {
    const [entry] = normalize([], [command({ command_type: type, status: "queued", completed_at: null })], deviceId);
    assert.equal(entry.title, title);
    assert.equal(entry.icon, icon);
  }
});

test("completed device actions have outcome titles and bounded expandable process output", () => {
  const titles = { force_inventory: "Force inventory completed", flush_dns: "DNS cache flushed", gpupdate: "Group Policy updated", restart_agent: "Agent restarted", lock: "Computer locked", reboot: "Computer restarted", shutdown: "Computer shut down" };
  for (const [type, title] of Object.entries(titles)) {
    const row = command({ command_type: type, result: { exit_code: 0, stdout: "accepted", stderr: "" } });
    const events = [event("req", "device.command.requested", { commandId: row.id, commandType: type }), finish];
    const entries = normalize(events, [row], deviceId);
    assert.equal(entries.length, 1); assert.equal(entries[0].title, title); assert.equal(entries[0].exitCode, 0);
    const html = render({ events, commands: [row] });
    assert.match(html, /Standard output/); assert.match(html, /accepted/); assert.match(html, /Exit code/);
  }
});

test("update failures retain exact error, versions and command result details", () => {
  const failure = event("failed", "agent.update.failed", {
    command_id: "cmd-1", transaction_id: "tx-1", update_error: "INSTALL_OR_HEALTH_FAILED",
    from_version: "0.1.5", update_target_version: "0.1.7",
  }, completed);
  const [entry] = normalize([failure, request], [command({ status: "failed", error_message: "Service health check timed out." })], deviceId);
  assert.equal(entry.title, "Agent update failed");
  assert.equal(entry.summary, "INSTALL_OR_HEALTH_FAILED");
  assert.equal(entry.errorMessage, "Service health check timed out.");
  assert.equal(entry.fromVersion, "0.1.5");
  assert.equal(entry.targetVersion, "0.1.7");
  assert.equal(entry.status, "failed");
});

test("transaction-only reports join through a bridge regardless of arrival order", () => {
  const tx = event("tx", "agent.update.succeeded", { transaction_id: "tx-1", target_version: "0.1.7" }, completed);
  const bridge = event("bridge", "agent.update.installing", { result: { command_id: "cmd-1", transaction_id: "tx-1" } }, at("14:05:00"));
  for (const events of [[tx, request, bridge], [request, bridge, tx], [bridge, tx, request]]) {
    const entries = normalize(events, [], deviceId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, "Agent updated to 0.1.7");
    assert.equal(entries[0].duration, "2m 22s");
  }
  assert.equal(normalize([tx, request], [update], deviceId).length, 1);
});

test("nested metadata aliases are supported without rendering arbitrary result data", () => {
  const [entry] = normalize([event("one", "agent.update.failed", {
    transaction: { transactionId: "tx", fromVersion: "0.1.5", targetVersion: "0.1.7" },
    result: { commandId: "cmd", errorCode: "VERIFICATION_FAILED", errorMessage: "Invalid signer" },
  }, completed)], [], deviceId);
  assert.equal(entry.transactionId, "tx");
  assert.equal(entry.commandId, "cmd");
  assert.equal(entry.fromVersion, "0.1.5");
  assert.equal(entry.errorMessage, "Invalid signer");
  const html = render({ commands: [command({ result: { target_version: "0.1.7", agent_token: "DO-NOT-RENDER", download_url: "PRIVATE-URL" } })] });
  assert.doesNotMatch(html, /DO-NOT-RENDER|PRIVATE-URL/);
});

test("unrelated commands, missing correlation and other devices never merge", () => {
  const entries = normalize([
    request, event("other", "device.command.requested", { commandId: "cmd-2", commandType: "update_agent" }),
    event("uncorrelated-1", "device.command.requested"), event("uncorrelated-2", "device.command.succeeded"),
    event("foreign", "device.command.failed", { commandId: "cmd-1" }, completed, { target_id: "device-2" }),
  ], [command({ device_id: "device-2" })], deviceId);
  assert.equal(entries.length, 4);
  assert.equal(entries.find((entry) => entry.commandId === "cmd-1").status, "requested");
});

test("late requests and stale running snapshots do not overwrite a terminal outcome", () => {
  const entries = normalize([
    finish, event("late", "device.command.requested", { commandId: "cmd-1" }, at("14:07:00")), request,
  ], [command({ status: "running", completed_at: null, started_at: at("14:04:00") })], deviceId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "succeeded");
  assert.equal(entries[0].requestedAt, requested);
  assert.equal(entries[0].completedAt, completed);
  assert.equal(entries[0].duration, "2m 22s");
});

test("current command lifecycle and update progress work without any audit event", () => {
  for (const phase of ["queued", "dispatched", "acknowledged", "running", "succeeded", "failed", "expired"]) {
    const [entry] = normalize([], [command({ status: phase })], deviceId);
    assert.equal(entry.status, ["dispatched", "acknowledged"].includes(phase) ? "queued" : phase === "expired" ? "failed" : phase);
  }
  const [progress] = normalize([], [command({ status: "running", completed_at: null, result: { update_status: "verifying", target_version: "0.1.7" } })], deviceId);
  assert.equal(progress.summary, "Verifying");
  assert.equal(progress.status, "running");
  assert.equal(progress.duration, undefined);
  assert.equal(progress.completedAt, undefined);
});

test("rolled back, expired and unknown statuses are not presented as succeeded", () => {
  for (const [phase, status] of [["rolled_back", "failed"], ["expired", "failed"], ["warning", "warning"], ["new_status", "info"]]) {
    const [entry] = normalize([], [command({ status: phase })], deviceId);
    assert.equal(entry.status, status);
  }
});

test("missing versions and request times are never invented", () => {
  const [entry] = normalize([event("only", "agent.update.succeeded", {}, completed)], [], deviceId);
  assert.equal(entry.title, "Update Agent");
  assert.equal(entry.targetVersion, undefined);
  assert.equal(entry.fromVersion, undefined);
  assert.equal(entry.duration, undefined);
  assert.match(entry.summary, /target version not recorded/);
});

test("duplicates collapse and ordering is deterministic, newest first", () => {
  const events = [request, finish, finish, event("older", "device.enrolled", {}, at("12:00:00"))];
  const result = normalize(events, [update, update], deviceId);
  assert.equal(result.length, 2);
  assert.equal(result[0].commandId, "cmd-1");
  assert.equal(result[0].events.length, 2);
  assert.deepEqual(result, normalize([...events].reverse(), [update], deviceId));
});

test("filters combine with case-insensitive search across useful and technical fields", () => {
  const entries = normalize([
    request, finish,
    event("remote", "remote.rdp.requested"),
    event("terminal", "remote.terminal.requested"),
    event("system", "device.inventory.collected"),
  ], [update, command({ id: "failed", command_type: "reboot", status: "failed", error_code: "ACCESS_DENIED" })], deviceId);
  assert.equal(filter(entries, "all", "").length, 5);
  assert.equal(filter(entries, "commands", "").length, 2);
  assert.equal(filter(entries, "updates", "").length, 1);
  assert.equal(filter(entries, "remote", "").length, 2);
  assert.equal(filter(entries, "system", "").length, 1);
  assert.equal(filter(entries, "failed", "access_denied").length, 1);
  for (const query of ["0.1.7", "0.1.5", "TX-1", " OPERATOR@EXAMPLE.TEST ", "update_agent"]) {
    assert.equal(filter(entries, "updates", query).length, 1);
  }
  assert.equal(filter(entries, "updates", "access_denied").length, 0);
});

test("day groups use local calendar days, including month/year and DST boundaries", () => {
  const cases = [new Date(2026, 0, 1, 0, 5), new Date(2026, 2, 30, 0, 5), new Date(2026, 9, 26, 0, 5)];
  for (const now of cases) {
    assert.equal(activityDay(now.toISOString(), now), "Today");
    assert.equal(activityDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 1).toISOString(), now), "Yesterday");
    assert.equal(activityDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 23, 59).toISOString(), now), "Older");
  }
  assert.equal(activityDay("invalid", cases[0]), "Older");
});

test("duration formats exact thresholds and rejects invalid or inverted timestamps", () => {
  for (const [ms, output] of [[0, "0s"], [999, "0s"], [59000, "59s"], [60000, "1m 0s"], [142000, "2m 22s"], [3600000, "1h 0m 0s"]]) {
    assert.equal(formatActivityDuration(ms), output);
  }
  for (const created_at of ["invalid", at("14:08:00")]) {
    const [entry] = normalize([], [command({ created_at })], deviceId);
    assert.equal(entry.duration, undefined);
  }
  assert.doesNotThrow(() => normalize([event("bad", "device.event", null, "invalid")], [], deviceId));
});

test("recorded duration is used only when timing is incomplete and the operation has finished", () => {
  for (const metadata of [{ duration_ms: 142000 }, { durationMs: 142000 }, { duration_seconds: 142 }, { durationSeconds: 142 }]) {
    const [entry] = normalize([event("duration", "agent.update.succeeded", metadata, completed)], [], deviceId);
    assert.equal(entry.duration, "2m 22s");
  }
  for (const duration_ms of [-1, "142000", Number.NaN, Number.POSITIVE_INFINITY]) {
    const [entry] = normalize([event("invalid", "agent.update.succeeded", { duration_ms }, completed)], [], deviceId);
    assert.equal(entry.duration, undefined);
  }
  const [running] = normalize([event("progress", "agent.update.installing", { duration_ms: 142000 }, completed)], [], deviceId);
  assert.equal(running.duration, undefined);
  const [timed] = normalize([request, finish], [command({ result: { duration_ms: 999 } })], deviceId);
  assert.equal(timed.duration, "2m 22s");
});

test("pending requests render a waiting state, never a completion timestamp", () => {
  const html = render({ events: [request], commands: [] });
  assert.match(html, /Waiting for the Agent/);
  assert.doesNotMatch(html, /Completed|Succeeded|Agent updated to/);
});

test("timeline renders native accessible expansion, human summary, filters and update versions", () => {
  const html = render();
  assert.equal((html.match(/<details /g) ?? []).length, 1);
  assert.equal((html.match(/<summary /g) ?? []).length, 1);
  assert.match(html, /Agent updated to 0\.1\.7/);
  assert.match(html, /Succeeded in 2m 22s/);
  assert.match(html, /0\.1\.5/);
  assert.match(html, /aria-label="Search activity"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-label="Today"/);
  assert.match(html, /<time dateTime=/);
  for (const label of ["All", "Commands", "Updates", "Remote", "System", "Failed"]) assert.ok(html.includes(`>${label}</button>`));
  const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
  assert.doesNotMatch(summary, /device\.command\.|tx-1|cmd-1/);
  assert.match(html.slice(html.indexOf("</summary>")), /Transaction ID/);
});

test("errors are visible and cannot masquerade as an empty successful load", () => {
  const empty = render({ events: [], commands: [] });
  assert.match(empty, /No device activity yet/);
  const failed = render({ events: [], commands: [], error: "Audit events could not be loaded." });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Activity is unavailable/);
  assert.match(failed, /Use Refresh to retry/);
  assert.doesNotMatch(failed, /No device activity yet/);
});

test("React escapes audit content and only exposes raw action names inside details", () => {
  const html = render({ commands: [command({ status: "failed", error_message: "<script>alert('x')</script>" })], events: [request] });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Agent update failed/);
});

const enrich = activity.enrichActivityUpdateCommands;
const linkedCommand = command({ update_transaction_id: "tx-1" });
const transaction = (extra = {}) => ({ id: "tx-1", device_id: deviceId, target_version: "0.1.7", ...extra });

test("linked update transaction supplies the missing target without changing the lifecycle", () => {
  const commands = enrich([linkedCommand], [transaction()]);
  const [entry] = normalize([request, finish], commands, deviceId);
  const [before] = normalize([request, finish], [linkedCommand], deviceId);
  assert.deepEqual(entry, { ...before, targetVersion: "0.1.7", title: "Agent updated to 0.1.7", summary: "Succeeded in 2m 22s" });
  const html = render({ commands });
  assert.match(html, /Updated to 0\.1\.7/);
  assert.doesNotMatch(html, /target version not recorded|Previous Agent version/);
  assert.equal((html.match(/<details /g) ?? []).length, 1);
  assert.equal(linkedCommand.update_transaction, undefined);
});

test("update version priority is audit/result metadata, linked transaction, then command payload", () => {
  const payload = { target_version: "0.1.6", previous_version: "0.1.4" };
  const base = { ...linkedCommand, payload };
  const recorded = transaction({ previous_version: "0.1.5" });
  const audit = event("versions", "device.command.requested", {
    commandId: "cmd-1", target_version: "0.1.8", previous_version: "0.1.3",
  });
  const cases = [
    { events: [audit, finish], cmd: { ...base, result: { target_version: "0.1.9" } }, tx: [recorded], target: "0.1.8", previous: "0.1.3" },
    { events: [request, finish], cmd: { ...base, result: { target_version: "0.1.9", previous_version: "0.1.2" } }, tx: [recorded], target: "0.1.9", previous: "0.1.2" },
    { events: [request, finish], cmd: base, tx: [recorded], target: "0.1.7", previous: "0.1.5" },
    { events: [request, finish], cmd: base, tx: [], target: "0.1.6", previous: "0.1.4" },
    { events: [request, finish], cmd: base, tx: [transaction({ target_version: " ", previous_version: null })], target: "0.1.6", previous: "0.1.4" },
  ];
  for (const { events, cmd, tx, target, previous } of cases) {
    const [entry] = normalize(events, enrich([cmd], tx), deviceId);
    assert.equal(entry.targetVersion, target);
    assert.equal(entry.fromVersion, previous);
  }
});

test("previous versions from audit metadata or linked journal show the transition", () => {
  for (const journal of [
    { previous_version: "0.1.5" },
    { journal: { previous_version: "0.1.5" } },
    { metadata: { update_journal: { previous_version: "0.1.5" } } },
  ]) {
    const commands = enrich([linkedCommand], [transaction(journal)]);
    const [entry] = normalize([request, finish], commands, deviceId);
    assert.equal(entry.fromVersion, "0.1.5");
    const html = render({ commands });
    assert.match(html, /0\.1\.5 <span[^>]*>\u2192<\/span> 0\.1\.7/);
    assert.doesNotMatch(html, /Updated to 0\.1\.7/);
  }
  const [entry] = normalize([event("journal", "device.command.succeeded", {
    commandId: "cmd-1", update_journal: { previous_version: "0.1.5" },
  }, completed)], enrich([linkedCommand], [transaction()]), deviceId);
  assert.equal(entry.fromVersion, "0.1.5");
  assert.equal(entry.targetVersion, "0.1.7");
});

test("unrelated, cross-device and missing transactions never supply invented versions", () => {
  for (const tx of [[], [transaction({ id: "tx-other" })], [transaction({ device_id: "device-2" })], [transaction({ target_version: null })]]) {
    const [entry] = normalize([request, finish], enrich([linkedCommand], tx), deviceId);
    assert.equal(entry.targetVersion, undefined);
    assert.equal(entry.fromVersion, undefined);
    assert.match(entry.summary, /target version not recorded/);
  }
  const [foreign] = normalize([], [{ ...linkedCommand, update_transaction: transaction({ device_id: "device-2" }) }], deviceId);
  assert.equal(foreign.targetVersion, undefined);
  const restart = { ...linkedCommand, command_type: "restart_agent" };
  assert.deepEqual(enrich([restart], [transaction()]), [restart]);
});

test("enrichment exposes only version fields and does not turn failures or running updates into successes", () => {
  for (const status of ["failed", "running"]) {
    const commands = enrich([command({ update_transaction_id: "tx-1", status, error_code: "INSTALL_OR_HEALTH_FAILED" })], [
      transaction({ status: "succeeded", journal: { previous_version: "0.1.5", agent_token: "PRIVATE" }, download_url: "SECRET" }),
    ]);
    assert.deepEqual(commands[0].update_transaction, {
      id: "tx-1", device_id: deviceId, target_version: "0.1.7", previous_version: "0.1.5",
    });
    const [entry] = normalize([request], commands, deviceId);
    assert.equal(entry.status, status);
    assert.equal(entry.targetVersion, "0.1.7");
    assert.equal(entry.errorCode, "INSTALL_OR_HEALTH_FAILED");
    assert.doesNotMatch(render({ events: [request], commands }), /Updated to|PRIVATE|SECRET/);
  }
});

const pageCode = compile("../app/dashboard/organizations/[id]/clients/[clientId]/page.tsx", ts.ModuleKind.CommonJS);
async function loadActivityPage({ transactionError = null, transactionFailure = null, adminFailure = null,
  auditError = null, commandError = null, correlatedOnly = false, authenticated = true,
  owner = true, memberRole = null, membershipError = null, devices = [{ id: deviceId }],
  payload = { target_version: "0.1.6" }, auditMetadata = {}, transactions,
} = {}) {
  const txId = "60000000-0000-4000-8000-000000000001";
  const cmdId = "50000000-0000-4000-8000-000000000001";
  const queries = [];
  const commands = [command({ id: cmdId, update_transaction_id: txId, payload })];
  const db = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: "owner" } : null } }) },
    from(table) {
      const query = { table, filters: [], client: "user" };
      queries.push(query);
      const results = {
        organizations: { id: "org", owner_id: owner ? "owner" : "another-owner" }, clients: { id: "client" }, sites: [],
        organization_members: memberRole ? { role: memberRole } : null,
        devices,
        audit_logs: [event("request", "device.command.requested", { commandId: cmdId, commandType: "update_agent", ...auditMetadata }), event("finish", "device.command.succeeded", { commandId: cmdId }, completed)],
        device_commands: correlatedOnly && queries.filter((q) => q.table === table).length === 1 ? [] : commands,
        agent_update_transactions: transactions ?? [transaction({ id: txId })],
      };
      const builder = {
        select(columns) { query.columns = columns; return this; },
        eq(...args) { query.filters.push(["eq", ...args]); return this; },
        in(...args) { query.filters.push(["in", ...args]); return this; },
        or(...args) { query.filters.push(["or", ...args]); return this; },
        order() { return this; }, limit() { return this; }, single() { return this; }, maybeSingle() { return this; },
        abortSignal(signal) { query.signal = signal; return this; },
        then(resolve, reject) {
          if (table === "agent_update_transactions" && transactionFailure) return Promise.reject(transactionFailure).then(resolve, reject);
          const error = table === "agent_update_transactions" ? transactionError :
            table === "audit_logs" ? auditError : table === "device_commands" ? commandError :
            table === "organization_members" ? membershipError : null;
          return Promise.resolve({ data: error ? null : results[table], error }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const Dashboard = () => null;
  const pageModule = { exports: {} };
  new Function("require", "module", "exports", pageCode)((name) => {
    if (name === "@/lib/activity/device-activity") return activity;
    if (name === "@/lib/supabase/server") return { createClient: async () => db };
    if (name === "@/lib/supabase/admin") return { createAdminClient() {
      if (adminFailure) throw adminFailure;
      return { from(table) {
        assert.equal(table, "agent_update_transactions");
        const builder = db.from(table);
        queries.at(-1).client = "admin";
        return builder;
      } };
    } };
    if (name === "next/server") return { connection: async () => {} };
    if (name === "next/navigation") return { notFound() { throw new Error("Unexpected notFound"); } };
    if (name === "./device-dashboard") return Dashboard;
    if (name === "next/link") return () => null;
    return require(name);
  }, pageModule, pageModule.exports);
  const tree = await pageModule.exports.default({ params: Promise.resolve({ id: "org", clientId: "client" }) });
  const findDashboard = (node) => {
    if (!node || typeof node !== "object") return undefined;
    if (node.type === Dashboard) return node.props;
    return React.Children.toArray(node.props?.children).map(findDashboard).find(Boolean);
  };
  return { props: findDashboard(tree), queries, txId };
}

test("page loads device-scoped linked transactions, including commands outside the recent window", async () => {
  for (const correlatedOnly of [false, true]) {
    const { props, queries, txId } = await loadActivityPage({ correlatedOnly });
    const query = queries.find((q) => q.table === "agent_update_transactions");
    assert.equal(query.client, "admin");
    assert.equal(query.columns, "id, device_id, target_version, devices!inner(clients!inner(organization_id))");
    assert.deepEqual(query.filters, [["eq", "devices.clients.organization_id", "org"], ["in", "device_id", [deviceId]], ["in", "id", [txId]]]);
    assert.ok(query.signal instanceof AbortSignal);
    assert.match(pageCode, /AbortSignal\.timeout\(3_000\)/);
    for (const query of queries.filter((q) => q.table !== "agent_update_transactions")) assert.equal(query.client, "user");
    for (const query of queries.filter((q) => q.table === "device_commands")) assert.ok(query.columns.split(", ").includes("payload"));
    assert.equal(props.activityError, undefined);
    const entries = normalize(props.activity, props.activityCommands, deviceId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].targetVersion, "0.1.7");
    assert.equal(entries[0].status, "succeeded");
  }
});

test("optional transaction errors stay server-side and preserve the grouped timeline and payload fallback", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  for (const error of [
    { code: "42501", message: "permission denied for table agent_update_transactions", details: null, hint: null },
    { code: "42703", message: "column does not exist" },
    { code: "PGRST205", message: "table not found in schema cache" },
    { code: "", message: "TimeoutError: request timed out" },
  ]) {
    const { props } = await loadActivityPage({ transactionError: error });
    assert.equal(props.activityError, undefined);
    assert.deepEqual(JSON.parse(log.mock.calls.at(-1).arguments[1]), error);
    assert.equal(props.activity.length, 2);
    assert.equal(props.activityCommands.length, 1);
    const entries = normalize(props.activity, props.activityCommands, deviceId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "succeeded");
    assert.equal(entries[0].targetVersion, "0.1.6");
    const html = render({ events: props.activity, commands: props.activityCommands, error: props.activityError });
    assert.doesNotMatch(html, /role="alert"|Use Refresh to retry|transaction details could not be loaded/);
    assert.match(html, /Refresh activity/);
  }
});

test("network, timeout and server configuration failures cannot abort Activity rendering", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  for (const options of [
    { transactionFailure: new TypeError("fetch failed") },
    { transactionFailure: new DOMException("request timed out", "TimeoutError") },
    { adminFailure: new Error("Missing Supabase admin environment variables.") },
  ]) {
    const { props } = await loadActivityPage({ ...options, payload: {} });
    assert.equal(props.activityError, undefined);
    assert.equal(props.activity.length, 2);
    const [entry] = normalize(props.activity, props.activityCommands, deviceId);
    assert.equal(entry.targetVersion, undefined);
    assert.equal(entry.fromVersion, undefined);
    assert.equal(entry.status, "succeeded");
  }
  assert.equal(log.mock.calls.length, 3);
});

test("a subsequent refresh retries enrichment and restores only recorded versions", async (t) => {
  t.mock.method(console, "error", () => {});
  const { props: failed } = await loadActivityPage({ transactionError: { code: "42501", message: "permission denied" }, payload: {} });
  assert.equal(normalize(failed.activity, failed.activityCommands, deviceId)[0].targetVersion, undefined);
  const { props } = await loadActivityPage({ payload: {}, auditMetadata: { update_journal: { previous_version: "0.1.5" } } });
  assert.equal(props.activityError, undefined);
  const [entry] = normalize(props.activity, props.activityCommands, deviceId);
  assert.equal(entry.fromVersion, "0.1.5");
  assert.equal(entry.targetVersion, "0.1.7");
  const html = render({ events: props.activity, commands: props.activityCommands });
  assert.match(html, /0\.1\.5 <span[^>]*>\u2192<\/span> 0\.1\.7/);
  assert.equal((html.match(/<details /g) ?? []).length, 1);
});

test("missing transactions remain optional and never invent versions", async () => {
  const { props } = await loadActivityPage({ transactions: [], payload: {} });
  assert.equal(props.activityError, undefined);
  const [entry] = normalize(props.activity, props.activityCommands, deviceId);
  assert.equal(entry.targetVersion, undefined);
  assert.equal(entry.fromVersion, undefined);
});

test("server enrichment requires authenticated organization access and RLS-visible devices", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const options of [
    { authenticated: false }, { owner: false }, { devices: [] },
    { owner: false, memberRole: "admin", membershipError: { code: "42501", message: "permission denied" } },
  ]) {
    const { queries } = await loadActivityPage(options);
    assert.ok(!queries.some((query) => query.client === "admin"));
  }
  for (const memberRole of ["admin", "member"]) {
    const { queries, props } = await loadActivityPage({ owner: false, memberRole });
    assert.equal(queries.filter((query) => query.client === "admin").length, 1);
    assert.equal(normalize(props.activity, props.activityCommands, deviceId)[0].targetVersion, "0.1.7");
  }
});

test("primary audit and command failures still show their existing warnings", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const field of ["auditError", "commandError"]) {
    const { props } = await loadActivityPage({ [field]: { code: "42501", message: "permission denied" } });
    assert.match(props.activityError, field === "auditError" ? /Audit events could not be loaded/ : /Command details could not be loaded/);
    assert.match(render({ events: props.activity, commands: props.activityCommands, error: props.activityError }), /role="alert"/);
  }
});
