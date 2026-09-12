import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const policy = load("../lib/agent/update-policy.ts");
const { updateCommandFeedback } = load("../lib/remote/update-command-feedback.ts", { "server-only": {}, "@/lib/agent/update-policy": policy });
const definitions = load("../lib/remote/action-definitions.ts");
const { completionNotice } = load("../lib/remote/action-feedback.ts", { "./action-definitions": definitions });
const device = { id: "device", agent_version: "0.1.7" };
const command = {
  device_id: "device", command_type: "update_agent", status: "failed", error_code: "UPDATE_FAILED",
  error_message: "no newer permitted, unfailed Agent release",
  started_at: "2026-09-12T15:00:00Z", completed_at: "2026-09-12T15:00:05Z",
};
function database(data, error, thrown) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const query = {
        select(columns) { calls.push(columns); return query; },
        eq(key, value) { calls.push([key, value]); return query; },
        maybeSingle() { return query; },
        abortSignal(signal) { assert.ok(signal instanceof AbortSignal); assert.equal(signal.aborted, false); calls.push("bounded"); return query; },
        then(resolve, reject) { return (thrown ? Promise.reject(thrown) : Promise.resolve({ data, error })).then(resolve, reject); },
      };
      return query;
    },
  };
}

test("legacy Agent: a current-version check during this command produces informational up-to-date without changing the stored error", async (t) => {
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    assert.equal(milliseconds, 2000);
    return timeout.call(AbortSignal, milliseconds);
  });
  const db = database({ latest_version: "0.1.7", last_check_at: "2026-09-12T15:00:02Z" });
  const feedback = await updateCommandFeedback(db, device, command);
  assert.deepEqual(feedback, { feedback_code: "NO_NEWER_AGENT_VERSION" });
  assert.deepEqual(db.calls, ["device_agent_update_state", "latest_version, last_check_at", ["device_id", "device"], "bounded"]);
  const notice = completionNotice("update_agent", { ...command, ...feedback });
  assert.equal(notice.title, "Agent is up to date");
  assert.equal(notice.tone, "info");
  assert.equal(command.status, "failed");
  assert.equal(command.error_code, "UPDATE_FAILED");
});

test("stale, later, missing and newer-version state cannot claim up-to-date", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const state of [
    null,
    { latest_version: "0.1.7", last_check_at: "2026-09-12T14:59:59Z" },
    { latest_version: "0.1.7", last_check_at: "2026-09-12T15:00:06Z" },
    { latest_version: "0.1.8", last_check_at: "2026-09-12T15:00:02Z" },
    { latest_version: "0.1.7", last_check_at: "invalid" },
    { latest_version: "invalid", last_check_at: "2026-09-12T15:00:02Z" },
  ]) {
    const feedback = await updateCommandFeedback(database(state), device, command);
    assert.deepEqual(feedback, {});
    assert.equal(completionNotice("update_agent", { ...command, ...feedback }).title, "No eligible Agent update");
  }
});

test("unrelated commands, other devices, modern codes and missing command times do not query enrichment", async () => {
  for (const changes of [
    { device_id: "other-tenant-device" }, { command_type: "flush_dns" }, { status: "succeeded" },
    { error_code: "INSTALL_OR_HEALTH_FAILED" }, { error_code: "NO_NEWER_AGENT_VERSION" },
    { error_message: "no newer permitted, unfailed Agent release\ncleanup failed" },
    { started_at: null }, { completed_at: null }, { completed_at: "invalid" },
    { completed_at: "2026-09-12T14:00:00Z" },
  ]) {
    const db = database({ latest_version: "0.1.7", last_check_at: "2026-09-12T15:00:02Z" });
    assert.deepEqual(await updateCommandFeedback(db, device, { ...command, ...changes }), {});
    assert.equal(db.calls.length, 0);
  }
  const db = database(null);
  assert.deepEqual(await updateCommandFeedback(db, { ...device, agent_version: null }, command), {});
  assert.equal(db.calls.length, 0);
});

test("optional lookup permission failures, network errors and timeout preserve the legacy result and log only on the server", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  for (const db of [database(null, { code: "42501" }), database(null, null, new Error("network failure")),
    database(null, null, new DOMException("timeout", "TimeoutError"))]) {
    const feedback = await updateCommandFeedback(db, device, command);
    assert.deepEqual(feedback, {});
    assert.equal(completionNotice("update_agent", { ...command, ...feedback }).tone, "info");
  }
  assert.equal(logs.length, 3);
  assert.ok(logs[0].includes("42501"));
});
