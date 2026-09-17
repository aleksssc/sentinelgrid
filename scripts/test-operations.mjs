import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");
function load(path, mocks = {}, cache = new Map()) {
  if (cache.has(path)) return cache.get(path);
  const mod = { exports: {} };
  const compiled = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const resolve = (name) => {
    if (name in mocks) return typeof mocks[name]?.default === "function" ? { __esModule: true, ...mocks[name] } : mocks[name];
    if (name === "server-only") return {};
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? new URL(name.slice(2), root) : new URL(name, new URL(path, root));
      const target = [".ts", ".tsx"].map((extension) => new URL(`${base.href}${extension}`)).find(existsSync);
      if (!target) throw new Error(`Cannot resolve ${name} from ${path}`);
      return load(target.href, mocks, cache);
    }
    return require(name);
  };
  new Function("require", "module", "exports", compiled)(resolve, mod, mod.exports);
  cache.set(path, mod.exports);
  return mod.exports;
}
const filters = load("lib/operations/filters.ts");
const now = Date.parse("2026-09-12T16:00:00Z");
const org = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const defaults = (kind, params = {}) => filters.parseOperationsFilters(params, kind);
const command = (extra = {}) => ({
  id: "44444444-4444-4444-8444-444444444444", device_id: deviceId, command_type: "flush_dns", status: "failed",
  created_at: "2026-09-12T15:00:00Z", completed_at: "2026-09-12T15:01:00Z", error_code: "COMMAND_TIMEOUT",
  error_message: "No response", result: {}, ...extra,
});
const device = (extra = {}) => ({
  id: deviceId, hostname: "workstation", display_name: "Test workstation", status: "online",
  last_seen: "2026-09-12T15:00:00Z", agent_version: "0.1.7", clients: { id: clientId, name: "Test client", organization_id: org },
  sites: { name: "Test site" }, ...extra,
});
function harness(responses) {
  const calls = [];
  const client = createClient("https://operations.test.invalid", "synthetic-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://operations.test.invalid");
      assert.equal(init.method, "GET");
      assert.ok(init.signal, "every request has a timeout signal");
      calls.push(url);
      const table = url.pathname.split("/").at(-1);
      assert.ok(table in responses, `Unexpected query to ${table}`);
      const result = responses[table];
      return new Response(JSON.stringify(result.error ?? result), {
        status: result.error ? 403 : 200, headers: { "Content-Type": "application/json" },
      });
    } },
  });
  const mocks = { "@/lib/supabase/server": { createClient: async () => client } };
  return {
    calls,
    incidents: load("app/dashboard/incidents/data.ts", mocks).loadIncidents,
    alerts: load("app/dashboard/alerts/data.ts", mocks).loadAlerts,
  };
}
function render(kind, result, params = {}) {
  const View = load("components/dashboard/operations/operations-view.tsx", {
    "next/link": { default: ({ children, prefetch, ...props }) => {
      assert.equal(prefetch, false);
      return React.createElement("a", props, children);
    } },
    "./operations-refresh": { default: () => React.createElement("button", {}, "Refresh") },
    "next/navigation": { useRouter: () => ({ replace() {} }), usePathname: () => `/dashboard/${kind}` },
  }).default;
  return renderToStaticMarkup(React.createElement(View, { kind, organizationName: "Test org", filters: defaults(kind, params), result, now }));
}

test("URL filters are bounded, source-specific and ignore untrusted organization IDs", () => {
  assert.deepEqual(defaults("incidents", { source: "other", status: "online", days: "999", page: "-2", organization: "foreign" }), {
    source: "commands", query: "", status: "all", days: 7, page: 1,
  });
  assert.equal(defaults("alerts", { source: "devices", status: "unchecked" }).status, "all");
  assert.equal(defaults("alerts", { source: "monitors", status: "warning" }).status, "all");
  assert.equal(defaults("incidents", { source: "audit", status: "expired" }).status, "all");
  assert.equal(defaults("alerts", { page: "9999" }).page, filters.MAX_PAGE);
  assert.equal(defaults("alerts", { page: "1e8" }).page, 1);
  assert.equal(defaults("alerts", { q: ["one", "two"] }).query, "");
  assert.equal(defaults("alerts", { q: "a".repeat(200) }).query.length, 100);
  const href = filters.operationsHref("incidents", defaults("incidents", { q: "DNS & GP", days: "30", page: "2" }), { page: 3 });
  const params = new URL(href, "https://test.invalid").searchParams;
  assert.equal(params.get("q"), "DNS & GP");
  assert.equal(params.get("page"), "3");
  assert.equal(params.get("days"), "30");
  assert.equal(params.get("organization"), null);
});

test("search values cannot escape a quoted PostgREST expression", () => {
  const attack = 'a\"),organization_id.neq.x,or=(id.not.is.null';
  const pattern = filters.searchPattern(attack);
  assert.equal(JSON.parse(pattern), `%${attack.replace(/[\\%_*]/g, "\\$&")}%`);
  assert.equal(JSON.parse(filters.searchPattern("a_b%")), "%a\\_b\\%%");
});

test("heartbeat cutoff matches 90 seconds exactly and never treats no heartbeat as online", () => {
  const at = (age) => new Date(now - age).toISOString();
  assert.equal(filters.deviceSignal("warning", at(90_000), now), "warning");
  assert.equal(filters.deviceSignal("warning", at(90_001), now), "offline");
  assert.equal(filters.deviceSignal("online", null, now), "offline");
  assert.equal(filters.deviceSignal("online", "invalid", now), "offline");
  assert.equal(filters.deviceSignal("offline", at(0), now), "offline");
  assert.match(filters.deviceAttentionFilter("offline", now), /last_seen.lt.2026-09-12T15:58:30.000Z/);
  assert.equal(filters.deviceAttentionFilter("warning", now), "and(status.eq.warning,last_seen.gte.2026-09-12T15:58:30.000Z)");
});

test("command list is server-paginated, tenant-scoped and enriches device names in one batch", async () => {
  const h = harness({ device_commands: Array.from({ length: 26 }, (_, i) => command({ id: `command-${i}` })), devices: [device()] });
  const result = await h.incidents(org, defaults("incidents", { page: "2", q: "DNS" }), now);
  assert.equal(result.rows.length, 25);
  assert.equal(result.hasNext, true);
  assert.equal(h.calls.length, 2);
  const query = h.calls[0].searchParams;
  assert.equal(query.get("organization_id"), `eq.${org}`);
  assert.equal(query.get("offset"), "25");
  assert.equal(query.get("limit"), "26");
  assert.equal(query.get("order"), "created_at.desc,id.desc");
  assert.deepEqual(query.getAll("created_at"), ["gte.2026-09-05T16:00:00.000Z", "lte.2026-09-12T16:00:00.000Z"]);
  assert.equal(query.getAll("or").length, 2, "search must not replace outcome eligibility");
  assert.match(query.getAll("or")[0], /NO_NEWER_AGENT_VERSION/);
  assert.equal(h.calls[1].searchParams.get("clients.organization_id"), `eq.${org}`);
  assert.equal(h.calls[1].searchParams.get("id"), `in.(${deviceId})`);
  assert.equal(result.rows[0].context, "Test client / Test site");
  assert.equal(result.rows[0].href, `/dashboard/organizations/${org}/clients/${clientId}`);
  assert.ok(result.rows[0].details.some((item) => item.value === "COMMAND_TIMEOUT"));
});

test("only the extra page row enables next; no speculative extra query is made", async () => {
  for (const count of [0, 24, 25, 26]) {
    const h = harness({ device_commands: Array.from({ length: count }, (_, i) => command({ id: `${i}` })), devices: [device()] });
    const result = await h.incidents(org, defaults("incidents"), now);
    assert.equal(result.hasNext, count > 25);
    assert.equal(result.rows.length, Math.min(count, 25));
    assert.equal(h.calls.length, count ? 2 : 1);
  }
  assert.equal(filters.pageRows(Array.from({ length: 26 }), filters.MAX_PAGE).hasNext, false);
});

test("legacy no-update outcome stays informational and no version is invented", async () => {
  const h = harness({ device_commands: [command({ command_type: "update_agent", error_code: "UPDATE_FAILED", error_message: "no newer permitted, unfailed Agent release" })], devices: [] });
  const result = await h.incidents(org, defaults("incidents"), now);
  assert.equal(result.rows[0].tone, "info");
  assert.equal(result.rows[0].title, "No eligible Agent update");
  assert.equal(result.rows[0].href, undefined);
  assert.ok(!result.rows[0].details.some((item) => item.label === "Recorded update version"));
  assert.equal(h.calls.some((url) => url.pathname.includes("agent_update_transactions")), false);
});

test("recorded versions are preserved and foreign device links are refused", async () => {
  const h = harness({ device_commands: [command({ command_type: "update_agent", result: { from_version: "0.1.5", target_version: "0.1.7" } })], devices: [device({ clients: { id: clientId, name: "Foreign", organization_id: "foreign" } })] });
  const result = await h.incidents(org, defaults("incidents"), now);
  assert.equal(result.rows[0].href, undefined);
  assert.ok(result.rows[0].details.some((item) => item.value === "0.1.5 -> 0.1.7"));
  assert.doesNotMatch(JSON.stringify(result), /Foreign/);
});

test("audit exceptions use organization RLS scope and exclude correlated lifecycle duplicates", async () => {
  const h = harness({ audit_logs: [{ id: "audit-1", action: "organization.settings.failed", target_id: null, target_type: "organization", target_name: "Test org", actor_email: "operator@example.test", created_at: "2026-09-12T15:00:00Z", error_code: "DENIED", error_message: "Not permitted" }] });
  const result = await h.incidents(org, defaults("incidents", { source: "audit", q: "operator" }), now);
  assert.equal(h.calls.length, 1);
  const query = h.calls[0].searchParams;
  assert.equal(query.get("organization_id"), `eq.${org}`);
  assert.equal(query.get("status"), "eq.failed");
  assert.equal(query.get("action"), "not.like.device.command.%");
  for (const key of ["commandId", "command_id", "transactionId", "transaction_id"]) assert.equal(query.get(`metadata->>${key}`), "is.null");
  assert.doesNotMatch(query.get("select"), /ip_address|user_agent|\*/);
  assert.equal(result.rows[0].details.find((item) => item.label === "Error code").value, "DENIED");
});

test("device alerts use an inner organization relationship and combine search with liveness", async () => {
  const h = harness({ devices: [device()] });
  const result = await h.alerts(org, "signed-in-user", defaults("alerts", { q: 'a\"),status.eq.online' }), now);
  assert.equal(h.calls.length, 1);
  const query = h.calls[0].searchParams;
  assert.match(query.get("select"), /clients!inner/);
  assert.equal(query.get("clients.organization_id"), `eq.${org}`);
  assert.equal(query.get("limit"), "26");
  assert.equal(query.getAll("or").length, 2);
  assert.equal(result.rows[0].status, "Offline");
  assert.equal(result.rows[0].timestamp, "2026-09-12T15:00:00Z");
  assert.match(result.rows[0].description, /not proof of an outage/);
});

test("monitors are strictly organization-scoped and preserve zero response", async () => {
  const h = harness({ monitors: [{ id: "monitor-1", name: "Endpoint", status: "offline", status_code: 503, response_time_ms: 0, last_checked_at: "2026-09-12T15:00:00Z" }] });
  const result = await h.alerts(org, "signed-in-user", defaults("alerts", { source: "monitors" }), now);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].searchParams.get("user_id"), null);
  assert.equal(h.calls[0].searchParams.get("organization_id"), `eq.${org}`);
  assert.equal(result.rows[0].href, "/dashboard/monitors/monitor-1");
  assert.ok(result.rows[0].details.some((item) => item.value === "0 ms"));
  assert.match(result.rows[0].context, /Organization monitor/);
});

test("unchecked and offline monitor filters are disjoint", async () => {
  for (const status of ["offline", "unchecked"]) {
    const h = harness({ monitors: [] });
    await h.alerts(org, "signed-in-user", defaults("alerts", { source: "monitors", status }), now);
    assert.equal(h.calls[0].searchParams.get("last_checked_at"), status === "unchecked" ? "is.null" : "not.is.null");
  }
});

test("query errors are explicit, context failures preserve evidence, and empty is not success-shaped", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  const h = harness({ device_commands: { error: { code: "42501", message: "permission denied" } } });
  const result = await h.incidents(org, defaults("incidents"), now);
  assert.match(result.error, /Command failures could not be loaded/);
  const html = render("incidents", result);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /No recorded failures in this view/);
  assert.match(html, /Audit exceptions/);
  const context = harness({ device_commands: [command()], devices: { error: { code: "42501", message: "permission denied" } } });
  const partial = await context.incidents(org, defaults("incidents"), now);
  assert.equal(partial.rows.length, 1);
  assert.match(partial.error, /Recorded failures are still shown/);
  assert.equal(partial.rows[0].href, undefined);
  const alerts = harness({ devices: { error: { code: "57014", message: "timeout" } } });
  assert.match((await alerts.alerts(org, "user", defaults("alerts"), now)).error, /Device signals could not be loaded/);
  assert.equal(errors.length, 3);
});

test("server-rendered pages include accessible details, working filters, navigation and truthful empty states", async () => {
  const h = harness({ device_commands: [command({ error_message: '<script>alert("xss")</script>' })], devices: [device()] });
  const result = await h.incidents(org, defaults("incidents"), now);
  const html = render("incidents", result);
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.match(html, /method="get"/);
  assert.match(html, /action="\/dashboard\/incidents"/);
  assert.match(html, /aria-label="Pagination"/);
  assert.match(html, /aria-current="page"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Open client devices/);
  assert.match(html, /not an organization-wide total/);
  assert.doesNotMatch(html, /Resolve incident|Acknowledge alert/);
  const empty = render("alerts", { rows: [], hasNext: false, error: null });
  assert.match(empty, /No attention signals in this view/);
  assert.match(empty, /not a guarantee/);
  assert.match(empty, /aria-disabled="true"/);
  const outOfRange = render("incidents", { rows: [], hasNext: false, error: null }, { page: "3" });
  assert.match(outOfRange, /No more records on this page/);
  assert.match(outOfRange, /page=2/);
});

test("both route entrypoints validate the server organization context before querying", async () => {
  for (const kind of ["incidents", "alerts"]) {
    for (const context of [{ user: null, organization: null }, { user: { id: "user" }, organization: null }]) {
      let calls = 0;
      const page = load(`app/dashboard/${kind}/page.tsx`, {
        "next/server": { connection: async () => {} },
        "next/navigation": { redirect: (path) => { throw new Error(`REDIRECT:${path}`); } },
        "@/lib/organization-context": { getOrganizationContext: async () => context },
        "./data": { loadIncidents: async () => { calls++; }, loadAlerts: async () => { calls++; } },
        "@/components/dashboard/operations/operations-view": { default: () => null },
      }).default;
      await assert.rejects(page({ searchParams: Promise.resolve({ organization: "untrusted" }) }), /REDIRECT:/);
      assert.equal(calls, 0);
    }
    let passed;
    const page = load(`app/dashboard/${kind}/page.tsx`, {
      "next/server": { connection: async () => {} },
      "next/navigation": { redirect: () => { throw new Error("Unexpected redirect"); } },
      "@/lib/organization-context": { getOrganizationContext: async () => ({ user: { id: "server-user" }, organization: { id: org, name: "Test" } }) },
      "./data": { [kind === "incidents" ? "loadIncidents" : "loadAlerts"]: async (...args) => { passed = args; return { rows: [], hasNext: false, error: null }; } },
      "@/components/dashboard/operations/operations-view": { default: () => null },
    }).default;
    await page({ searchParams: Promise.resolve({ organization: "untrusted", user_id: "foreign" }) });
    assert.equal(passed[0], org);
    if (kind === "alerts") assert.equal(passed[1], "server-user");
  }
});

test("manual refresh uses the existing router and reports pending without changing filters", () => {
  let pending = false, refreshed = 0, transitions = 0;
  const Refresh = load("components/dashboard/operations/operations-refresh.tsx", {
    react: { ...React, useTransition: () => [pending, (callback) => { transitions++; callback(); }] },
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshed++; } }) },
  }).default;
  const ready = Refresh();
  assert.equal(ready.props.disabled, false);
  ready.props.onClick();
  assert.equal(transitions, 1);
  assert.equal(refreshed, 1);
  pending = true;
  const busy = Refresh();
  assert.equal(busy.props.disabled, true);
  assert.match(renderToStaticMarkup(busy), /Refreshing/);
});
