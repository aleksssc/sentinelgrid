import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Redis } from "@upstash/redis";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), mod, mod.exports);
  return mod.exports;
}
const metrics = load("../lib/performance/metrics.ts");
const deviceId = "40000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-09-12T18:00:00Z");
const sample = (timestamp = now, extra = {}) => ({ timestamp, cpu_usage: 0, ram_usage: 42, disk_usage: 55, ...extra });
function history(range = "1h", samples = [sample()]) {
  const config = metrics.PERFORMANCE_RANGES[range];
  return { range, from: now - config.duration, to: now, interval: config.interval, samples };
}
const dependencies = { "@/lib/performance/metrics": metrics };

test("only real valid heartbeat percentages become samples, including zero", () => {
  assert.deepEqual(metrics.performanceSample({ cpu_usage: 0, ram_usage: 100 }, now), sample(now, { ram_usage: 100, disk_usage: null }));
  for (const body of [{}, { inventory: { ram_usage: 10 } }, { cpu_usage: "42" }, { cpu_usage: -1 }, { cpu_usage: 101 }, { cpu_usage: NaN }, { cpu_usage: Infinity }]) {
    assert.equal(metrics.performanceSample(body, now), null);
  }
  assert.equal(metrics.isPerformanceSample({ ...sample(), disk_usage: undefined }), false);
  assert.equal(metrics.isPerformanceSample({ ...sample(), timestamp: NaN }), false);
});

test("all four ranges enforce exact windows, ordering, sample bounds and response shape", () => {
  let capacity = 0;
  for (const [range, config] of Object.entries(metrics.PERFORMANCE_RANGES)) {
    const count = config.duration / config.interval + 1;
    capacity += count;
    const data = history(range, Array.from({ length: count }, (_, index) => sample(now - config.duration + index * config.interval)));
    assert.equal(metrics.isPerformanceHistory(data, range), true);
    assert.equal(metrics.isPerformanceHistory({ ...data, samples: [...data.samples, sample(now)] }, range), false);
    assert.equal(metrics.isPerformanceHistory({ ...data, samples: [sample(now + 1)] }, range), false);
    assert.equal(metrics.isPerformanceHistory({ ...data, samples: [sample(data.from - 1)] }, range), false);
    assert.equal(metrics.isPerformanceHistory({ ...data, samples: [sample(now), sample(now - 1)] }, range), false);
    assert.equal(metrics.isPerformanceHistory({ ...data, samples: [sample(now), sample(now)] }, range), false);
    assert.equal(metrics.isPerformanceHistory({ ...data, interval: 1 }, range), false);
  }
  assert.equal(capacity, 1108);
  for (const range of ["constructor", "__proto__", "all", ""]) assert.equal(metrics.isPerformanceRange(range), false);
});

test("charts preserve missing measurements and offline gaps instead of drawing invented data", () => {
  const samples = [sample(now - 240_000), sample(now - 210_000), sample(now - 180_000, { cpu_usage: null }), sample(now - 150_000), sample(now)];
  assert.deepEqual(metrics.metricSegments(samples, "cpu_usage", 30_000).map((group) => group.length), [2, 1, 1]);
  assert.deepEqual(metrics.metricSegments(samples, "ram_usage", 30_000).map((group) => group.length), [4, 1]);
  const { PerformanceChart } = load("../components/dashboard/devices/device-performance.tsx", dependencies);
  const html = renderToStaticMarkup(React.createElement(PerformanceChart, { data: history("1h", samples), metric: "cpu_usage", label: "CPU usage", color: "#34d399", icon: require("lucide-react").Cpu }));
  assert.equal((html.match(/<polyline/g) ?? []).length, 3);
  assert.equal((html.match(/<circle/g) ?? []).length, 4);
  assert.match(html, /0\.0%/);
  assert.match(html, /role="img"/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("real Upstash SDK serializes one atomic bounded write and decodes time-scoped history", async (t) => {
  const commands = [];
  let result = 1;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    commands.push(JSON.parse(init.body));
    return Response.json({ result });
  });
  const redis = new Redis({ url: "https://redis.example.test", token: "test-only", retry: false, enableAutoPipelining: false });
  const storage = load("../lib/performance/history.ts", { "server-only": {}, "./metrics": metrics, "@/lib/realtime/redis": { getRedis: () => redis } });
  await storage.storePerformanceSample(deviceId, sample());
  assert.equal(commands.length, 1);
  const [operation, script, count, ...args] = commands[0];
  assert.equal(operation, "eval"); assert.equal(count, 4);
  const ranges = Object.keys(metrics.PERFORMANCE_RANGES);
  assert.deepEqual(args.slice(0, 4), ranges.map((range) => `sentinelgrid:device:{${deviceId}}:performance:${range}`));
  assert.deepEqual(JSON.parse(args[4]), sample());
  assert.equal(Number(args[5]), now);
  assert.deepEqual(args.slice(6).map(Number), Object.values(metrics.PERFORMANCE_RANGES).flatMap((config) => [config.duration, config.interval]));
  assert.match(script, /cjson\.decode\(previous\[1\]\)\.timestamp\) < now/);
  assert.match(script, /ZREMRANGEBYRANK/); assert.match(script, /EXPIRE/);
  for (const range of ranges) {
    const config = metrics.PERFORMANCE_RANGES[range];
    result = [JSON.stringify(sample(now - config.duration - 1)), JSON.stringify(sample(now - 30_000)), JSON.stringify(sample())];
    const data = await storage.readPerformanceHistory(deviceId, range, now);
    assert.deepEqual(data, history(range, [sample(now - 30_000), sample()]));
    const call = commands.at(-1);
    assert.equal(call[0], "zrange"); assert.ok(call.includes("byscore"));
    assert.equal(call.at(-1), config.duration / config.interval + 1);
  }
  result = [JSON.stringify({ cpu_usage: 1000 })];
  await assert.rejects(storage.readPerformanceHistory(deviceId, "1h", now), /INVALID_PERFORMANCE_HISTORY/);
});

function database(result, user = { id: "user" }) {
  const calls = [];
  return { calls, auth: { getUser: async () => ({ data: { user } }) }, from(table) {
    const call = { table, operations: [] }; calls.push(call);
    const query = new Proxy({}, { get(_, method) {
      if (method === "maybeSingle") return async () => result;
      return (...args) => { call.operations.push([method, ...args]); return query; };
    } });
    return query;
  } };
}

test("history API checks authentication and device RLS before Redis, without management permission", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  for (const [user, result, status] of [
    [null, { data: { id: deviceId } }, 401],
    [{ id: "other-tenant" }, { data: null }, 404],
    [{ id: "user" }, { data: null, error: { code: "unavailable" } }, 503],
    [{ id: "read-only-member" }, { data: { id: deviceId } }, 200],
  ]) {
    const db = database(result, user); const reads = [];
    const { GET } = load("../app/api/devices/[deviceId]/performance/route.ts", { ...dependencies,
      "@/lib/supabase/server": { createClient: async () => db },
      "@/lib/performance/history": { readPerformanceHistory: async (...args) => { reads.push(args); return history("7d"); } },
    });
    const response = await GET(new Request(`https://app.example.test/api/devices/${deviceId}/performance?range=7d`), { params: Promise.resolve({ deviceId }) });
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal(reads.length, status === 200 ? 1 : 0);
    if (status === 200) {
      assert.deepEqual(reads[0], [deviceId, "7d"]);
      assert.deepEqual(db.calls[0], { table: "devices", operations: [["select", "id"], ["eq", "id", deviceId]] });
    }
    const invalid = await GET(new Request(`https://app.example.test/api/devices/${deviceId}/performance?range=constructor`), { params: Promise.resolve({ deviceId }) });
    assert.equal(invalid.status, 400);
  }
  assert.equal(errors.length, 1);
});

test("Redis outage is a visible API error, never a success-shaped empty history", async (t) => {
  t.mock.method(console, "error", () => {});
  const { GET } = load("../app/api/devices/[deviceId]/performance/route.ts", { ...dependencies,
    "@/lib/supabase/server": { createClient: async () => database({ data: { id: deviceId } }) },
    "@/lib/performance/history": { readPerformanceHistory: async () => { throw new Error("test outage"); } },
  });
  const response = await GET(new Request(`https://app.example.test/api/devices/${deviceId}/performance`), { params: Promise.resolve({ deviceId }) });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).samples, undefined);
});

test("heartbeat persists metrics only after token authentication; storage failure cannot break update health or inventory", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  for (const [body, device, status, expectedWrites] of [
    [{ cpu_usage: 0, ram_usage: 42, disk_usage: 55 }, { id: deviceId }, 200, 1],
    [{ cpu_usage: 50, device_id: "spoofed" }, { id: deviceId }, 200, 1],
    [{ cpu_usage: 50 }, null, 401, 0],
    [{ inventory: { hostname: "test-device" } }, { id: deviceId }, 200, 0],
    [{}, { id: deviceId }, 200, 0],
  ]) {
    const callbacks = [], writes = [];
    const db = database({ data: device });
    const { POST } = load("../app/api/agent/heartbeat/route.ts", { ...dependencies,
      "next/server": { ...require("next/server"), after: (callback) => callbacks.push(callback) },
      "@/lib/supabase/admin": { createAdminClient: () => db },
      "@/lib/performance/history": { storePerformanceSample: async (...args) => { writes.push(args); throw new Error("test Redis unavailable"); } },
    });
    const response = await POST(new Request("https://app.example.test/api/agent/heartbeat", { method: "POST",
      headers: { Authorization: "Bearer synthetic-test-token", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal(response.status, status);
    assert.equal(writes.length, 0, "Redis does not delay the heartbeat response");
    if (status === 200) assert.deepEqual(await response.json(), { ok: true, device_id: deviceId });
    assert.equal(db.calls.length, 1);
    assert.ok(db.calls[0].operations.some((op) => op[0] === "eq" && op[1] === "agent_token_hash" && op[2] !== "synthetic-test-token"));
    await Promise.all(callbacks.map((callback) => callback()));
    assert.equal(writes.length, expectedWrites);
    if (expectedWrites) assert.equal(writes[0][0], deviceId);
  }
  assert.equal(errors.length, 2);
  assert.ok(errors.every((args) => args[0] === "[Performance] SAMPLE_STORE_FAILED"));
});

function elements(tree) {
  return React.isValidElement(tree) ? [tree, ...React.Children.toArray(tree.props.children).flatMap(elements)] : [];
}
function harness(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const listeners = new Map();
  const previous = globalThis.document;
  globalThis.document = { hidden: false, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name) => listeners.delete(name) };
  const slots = [], effects = [], requests = [];
  let cursor = 0;
  t.mock.method(globalThis, "fetch", (url, options) => new Promise((resolve, reject) => {
    requests.push({ url, options, resolve, reject });
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const Component = load("../components/dashboard/devices/device-performance.tsx", { ...dependencies, react: { ...React,
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, (next) => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
    },
    useEffect(callback, deps) {
      const index = cursor++; const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        slots[index] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  } }).default;
  let id = deviceId;
  function render(nextId = id) {
    id = nextId; cursor = 0;
    const tree = Component({ deviceId: id });
    effects.splice(0).forEach((callback) => callback());
    return tree;
  }
  function dispose() { slots.forEach((slot) => slot?.cleanup?.()); }
  t.after(() => { dispose(); if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  return { render, requests, dispose, visibility(hidden) { globalThis.document.hidden = hidden; listeners.get("visibilitychange")?.(); } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("period selection is immediate, cancels stale requests, and cannot show another device's data", async (t) => {
  const ui = harness(t);
  let tree = ui.render();
  assert.equal(ui.requests.length, 1);
  elements(tree).find((item) => item.type === "button" && item.props.children === "7 days").props.onClick();
  ui.render();
  assert.equal(ui.requests.length, 2);
  assert.match(ui.requests[1].url, /range=7d/);
  assert.equal(ui.requests[0].options.signal.aborted, true);
  const receivedAt = Date.now();
  ui.requests[1].resolve(Response.json({ ...history("7d"), to: receivedAt, from: receivedAt - metrics.PERFORMANCE_RANGES["7d"].duration, samples: [sample(receivedAt)] }));
  await settle();
  tree = ui.render();
  assert.ok(elements(tree).some((item) => item.props.children === "Receiving metrics"));
  tree = ui.render("40000000-0000-4000-8000-000000000002");
  assert.ok(!elements(tree).some((item) => item.props.children === "Receiving metrics"));
  assert.match(ui.requests[2].url, /000000000002/);
});

test("refresh polling runs only for the visible mounted Performance tab", async (t) => {
  const ui = harness(t); ui.render();
  ui.requests[0].resolve(Response.json(history())); await settle();
  t.mock.timers.tick(29_999); assert.equal(ui.requests.length, 1);
  t.mock.timers.tick(1); assert.equal(ui.requests.length, 2);
  ui.visibility(true); assert.equal(ui.requests[1].options.signal.aborted, true);
  await settle(); t.mock.timers.tick(120_000); assert.equal(ui.requests.length, 2);
  ui.visibility(false); assert.equal(ui.requests.length, 3);
  ui.dispose(); assert.equal(ui.requests[2].options.signal.aborted, true);
  await settle(); t.mock.timers.tick(120_000); assert.equal(ui.requests.length, 3);
});

test("UI distinguishes empty history, session expiry and read failure; retry works", async (t) => {
  const ui = harness(t); ui.render();
  ui.requests[0].resolve(Response.json(history("1h", []))); await settle();
  let tree = ui.render();
  assert.ok(elements(tree).some((item) => item.props.children === "Waiting for metric samples"));
  const refresh = elements(tree).find((item) => item.type === "button" && item.props.disabled !== undefined);
  refresh.props.onClick(); ui.render();
  ui.requests[1].resolve(Response.json({ error: "unavailable" }, { status: 503 })); await settle();
  tree = ui.render();
  assert.match(renderToStaticMarkup(tree), /Could not load performance history/);
  elements(tree).find((item) => item.type === "button" && item.props.disabled !== undefined).props.onClick(); ui.render();
  ui.requests[2].resolve(Response.json({ error: "unauthorized" }, { status: 401 })); await settle();
  assert.match(renderToStaticMarkup(ui.render()), /Session expired/);
});
