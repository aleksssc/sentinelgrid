import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
function load(path, mocks = {}) {
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compile(readFileSync(new URL(path, import.meta.url), "utf8")))(
    (name) => mocks[name] ?? require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const definitions = load("../lib/remote/action-definitions.ts");
const feedback = load("../lib/remote/action-feedback.ts", { "./action-definitions": definitions });
const Notice = load("../components/dashboard/devices/device-action-notice.tsx").default;

function pollingHarness(fetch, controller = new AbortController()) {
  const source = readFileSync(new URL("../app/dashboard/organizations/[id]/clients/[clientId]/device-dashboard.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("  async function watchQuickAction(");
  const end = source.indexOf("\n  /* =========================\n     DELETE DEVICE", start);
  assert.ok(start > 0 && end > start);
  const notices = [], refreshes = [];
  const context = {
    ...feedback, ACTIVE_COMMAND_STATUSES: definitions.ACTIVE_COMMAND_STATUSES,
    setActionMessage: (notice) => notices.push(notice), router: { refresh: () => refreshes.push(true) },
    window: { setTimeout: (callback) => callback() }, fetch,
  };
  const watch = new Function(...Object.keys(context), `${compile(source.slice(start, end))}; return watchQuickAction;`)(...Object.values(context));
  return { notices, refreshes, run: (action = "update_agent") => watch("device", "command", action, controller.signal) };
}

for (const action of definitions.DEVICE_ACTIONS) {
  test(`${action.type}: all lifecycle stages, completion and real errors`, () => {
    for (const status of ["sending", ...definitions.ACTIVE_COMMAND_STATUSES]) {
      const notice = feedback.progressNotice(action.type, status);
      assert.ok(["info", "progress"].includes(notice.tone));
      assert.match(notice.title, new RegExp(action.label));
      assert.notEqual(notice.tone, "success");
    }
    const success = feedback.completionNotice(action.type, { status: "succeeded" });
    assert.equal(success.title, action.completed);
    assert.equal(success.tone, "success");
    const failure = feedback.completionNotice(action.type, { status: "failed", error_code: "REAL_ERROR", error_message: "Windows rejected the action" });
    assert.equal(failure.tone, "error");
    assert.equal(failure.message, "Windows rejected the action");
    assert.equal(failure.code, "REAL_ERROR");
    assert.equal(feedback.completionNotice(action.type, { status: "expired" }).tone, "error");
  });
}

test("already current is informational, not an update success or failed submission", () => {
  for (const notice of [feedback.submissionNotice("update_agent", "NO_NEWER_AGENT_VERSION", 409),
    feedback.completionNotice("update_agent", { status: "failed", error_code: "NO_NEWER_AGENT_VERSION" })]) {
    assert.equal(notice.tone, "info");
    assert.equal(notice.title, "Agent is up to date");
    assert.match(notice.message, /channel and policy/);
    assert.doesNotMatch(notice.message, /0\.1\.|installed successfully/);
  }
  assert.equal(feedback.completionNotice("flush_dns", { status: "failed", error_code: "NO_NEWER_AGENT_VERSION" }).tone, "error");
});

test("legacy no-eligible outcome never claims the Agent is current", () => {
  const notice = feedback.completionNotice("update_agent", { status: "failed", error_code: "UPDATE_FAILED", error_message: "no newer permitted, unfailed Agent release" });
  assert.equal(notice.tone, "info");
  assert.equal(notice.title, "No eligible Agent update");
  assert.match(notice.message, /previously failed release is blocked/);
  assert.doesNotMatch(notice.message, /already has|up to date/);
  assert.equal(feedback.completionNotice("update_agent", { status: "failed", error_code: "UPDATE_FAILED", error_message: "no newer permitted, unfailed Agent release\nlock cleanup failed" }).tone, "error");
});

test("policy, protected failed release and update failure remain distinct from no-update", () => {
  for (const code of ["UPDATE_POLICY_DISABLED", "UPDATE_RELEASE_BLOCKED", "UPDATE_FAILED", "INSTALL_OR_HEALTH_FAILED", "AGENT_UNSUPPORTED"]) {
    const notice = feedback.completionNotice("update_agent", { status: "failed", error_code: code });
    assert.equal(notice.tone, "error");
    assert.equal(notice.code, code);
    assert.doesNotMatch(notice.title, /up to date/);
  }
  const policy = feedback.completionNotice("update_agent", { status: "failed", error_code: "UPDATE_FAILED", error_message: "trusted update policy disables installation" });
  assert.match(policy.message, /update policy or updater readiness/);
  const success = feedback.completionNotice("update_agent", { status: "succeeded", result: { target_version: "0.1.7" } });
  assert.equal(success.title, "Agent updated to 0.1.7");
  assert.equal(feedback.completionNotice("update_agent", { status: "succeeded" }).title, "Agent updated");
});

test("actionable errors and uncertain delivery are not replaced with up-to-date", () => {
  for (const code of ["UNAUTHORIZED", "FORBIDDEN", "DEVICE_NOT_FOUND", "DEVICE_OFFLINE", "COMMAND_BUSY", "RATE_LIMITED", "REMOTE_ACCESS_DISABLED", "INVALID_PAYLOAD", "COMMAND_LOOKUP_FAILED", "COMMAND_CREATE_FAILED"]) {
    const notice = feedback.submissionNotice("update_agent", code);
    assert.equal(notice.code, code);
    assert.ok(["error", "warning"].includes(notice.tone));
    assert.doesNotMatch(notice.title, /up to date/);
  }
  assert.match(feedback.submissionNotice("shutdown", "COMMAND_DISPATCH_FAILED").message, /was saved/);
  assert.match(feedback.submissionNotice("shutdown", "NETWORK_ERROR").message, /avoid sending it twice/);
  assert.equal(feedback.submissionNotice("lock", "UNKNOWN", 401).code, "UNAUTHORIZED");
  assert.equal(feedback.submissionNotice("lock", "UNKNOWN", 503).tone, "warning");
});

test("submission preserves the existing command endpoint and request payload", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options });
    return Response.json({ commandId: "saved-command", status: "dispatched" }, { status: 202 });
  });
  for (const { type } of definitions.DEVICE_ACTIONS) {
    const result = await feedback.submitDeviceAction("device", type, {});
    assert.deepEqual(result, { commandId: "saved-command", status: "dispatched" });
    const request = requests.at(-1);
    assert.equal(request.url, "/api/devices/device/commands");
    assert.equal(request.method, "POST");
    assert.deepEqual(JSON.parse(request.body), { command_type: type, payload: {} });
  }
  await feedback.submitDeviceAction("device", "reboot", { delay_seconds: 30 });
  assert.deepEqual(JSON.parse(requests.at(-1).body).payload, { delay_seconds: 30 });
});

test("HTTP and malformed submission responses cannot produce a queued/success notice", async (t) => {
  let response;
  t.mock.method(globalThis, "fetch", async () => response);
  for (const [body, status, code] of [
    [{ error: "NO_NEWER_AGENT_VERSION" }, 409, "NO_NEWER_AGENT_VERSION"],
    [{ error: "COMMAND_BUSY" }, 409, "COMMAND_BUSY"],
    [{}, 202, "INVALID_RESPONSE"], [null, 202, "INVALID_RESPONSE"],
    [{ commandId: 42 }, 202, "INVALID_RESPONSE"], [{ commandId: " " }, 202, "INVALID_RESPONSE"],
  ]) {
    response = Response.json(body, { status });
    await assert.rejects(feedback.submitDeviceAction("device", "update_agent", {}), (error) =>
      error instanceof feedback.ActionSubmissionError && error.code === code && error.status === status);
  }
  response = new Response("<html>Bad gateway</html>", { status: 502 });
  await assert.rejects(feedback.submitDeviceAction("device", "update_agent", {}), (error) => error.code === "INVALID_RESPONSE" && error.status === 502);
});

test("notifications have distinct dark colors, accessible status, dismissal and reduced motion", () => {
  for (const [tone, color] of [["success", "emerald"], ["info", "sky"], ["progress", "amber"], ["warning", "amber"], ["error", "red"]]) {
    const html = renderToStaticMarkup(React.createElement(Notice, { notice: { tone, title: "Action", message: "Details", code: "CODE" }, onDismiss() {} }));
    assert.match(html, new RegExp(`border-${color}-500/20`));
    assert.match(html, new RegExp(`text-${color}-400`));
    assert.match(html, new RegExp(`role="${tone === "error" ? "alert" : "status"}"`));
    assert.match(html, /Dismiss action notification/);
    assert.match(html, /motion-reduce:animate-none/);
    assert.equal(html.includes("animate-spin"), tone === "progress");
    assert.match(html, /CODE/);
  }
  const html = renderToStaticMarkup(React.createElement(Notice, { notice: { tone: "error", title: "Failure", message: "<script>alert(1)</script>" }, onDismiss() {} }));
  assert.doesNotMatch(html, /<script>/);
});

test("actual dashboard polling retries transient failure and only succeeds on confirmed result", async () => {
  const responses = [new Response("unavailable", { status: 503 }), Response.json({ status: "running" }), Response.json({ status: "succeeded", result: { target_version: "0.1.7" } })];
  const harness = pollingHarness(async () => responses.shift());
  await harness.run();
  assert.deepEqual(harness.notices.map((notice) => notice.tone), ["warning", "progress", "success"]);
  assert.equal(harness.notices.at(-1).title, "Agent updated to 0.1.7");
  assert.equal(harness.refreshes.length, 1);
});

test("actual dashboard polling handles already-current, malformed status and loss of visibility", async () => {
  const current = pollingHarness(async () => Response.json({ status: "failed", error_code: "NO_NEWER_AGENT_VERSION" }));
  await current.run();
  assert.equal(current.notices.at(-1).title, "Agent is up to date");
  for (const body of [null, {}, { status: "unknown" }]) {
    const malformed = pollingHarness(async () => Response.json(body));
    await malformed.run();
    assert.equal(malformed.notices.at(-1).tone, "warning");
    assert.equal(malformed.refreshes.length, 0);
  }
  let calls = 0;
  const forbidden = pollingHarness(async () => { calls++; return new Response(null, { status: 403 }); });
  await forbidden.run();
  assert.equal(calls, 1);
  assert.match(forbidden.notices[0].message, /has not been cancelled/);
  assert.doesNotMatch(forbidden.notices[0].message, /not submitted/);
});

test("polling bounds retries and ignores results after device navigation", async () => {
  let calls = 0;
  const unavailable = pollingHarness(async () => { calls++; throw new Error("network"); });
  await unavailable.run("reboot");
  assert.equal(calls, 3);
  assert.ok(unavailable.notices.every((notice) => notice.tone === "warning"));
  const controller = new AbortController();
  const navigated = pollingHarness(async () => { controller.abort(); return Response.json({ status: "succeeded" }); }, controller);
  await navigated.run();
  assert.equal(navigated.notices.length, 0);
});
