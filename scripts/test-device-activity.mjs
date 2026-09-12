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
    reboot: ["Restart Computer", "restart"], shutdown: ["Shutdown", "shutdown"],
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
