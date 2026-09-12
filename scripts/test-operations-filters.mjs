import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
const filters = load("../lib/operations/filters.ts");
const dropdown = load("../components/ui/dropdown-menu.tsx", { "@/lib/utils": load("../lib/utils.ts") });
const dependencies = { "@/lib/operations/filters": filters, "@/components/ui/dropdown-menu": dropdown };
const defaults = (params = {}, kind = "incidents") => filters.parseOperationsFilters(params, kind);
const statuses = [{ id: "failed", name: "Failed" }, { id: "expired", name: "Expired" }];
function elements(tree) {
  if (!React.isValidElement(tree)) return [];
  return [tree, ...React.Children.toArray(tree.props.children).flatMap(elements)];
}
function find(tree, predicate) {
  const result = elements(tree).find(predicate);
  assert.ok(result, "Expected control is present");
  return result;
}
const search = (tree) => find(tree, (element) => element.type === "input" && element.props.name === "q");
const select = (tree, name) => find(tree, (element) => typeof element.type === "function" && element.props.name === name);
const button = (tree, label) => find(tree, (element) => element.type === "button" && (element.props["aria-label"] === label || element.props.children === label));

function harness(t, initial = defaults()) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const listeners = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    location: { search: "" },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const slots = [], effects = [], calls = [];
  let cursor = 0, dirty = false, pending = false;
  const Bar = load("../components/dashboard/operations/operations-filters.tsx", {
    ...dependencies,
    react: { ...React,
      useState(initialValue) {
        const index = cursor++;
        slots[index] ??= { value: initialValue };
        return [slots[index].value, (next) => {
          slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
          dirty = true;
        }];
      },
      useRef(initialValue) {
        const index = cursor++;
        slots[index] ??= { current: initialValue };
        return slots[index];
      },
      useEffect(callback, deps) {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
          slots[index] = { deps };
          effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
        }
      },
      useTransition: () => [pending, (callback) => { pending = true; callback(); }],
    },
    "next/navigation": { useRouter: () => ({ replace: (href, options) => calls.push({ href, options }) }) },
  }).default;
  let props = { kind: "incidents", filters: initial, statuses, placeholder: "Search commands..." };
  function render(overrides = {}) {
    props = { ...props, ...overrides };
    let tree;
    for (let i = 0; i < 5; i++) {
      cursor = 0; dirty = false;
      tree = Bar(props);
      if (!dirty) break;
    }
    assert.equal(dirty, false, "render-time reconciliation settles");
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  function dispose() { slots.forEach((slot) => slot?.cleanup?.()); }
  t.after(() => {
    dispose();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  });
  return {
    render, calls, listeners, dispose,
    tick: (ms) => t.mock.timers.tick(ms),
    commit(params) { pending = false; return render({ filters: defaults(params) }); },
    type(value) { search(render()).props.onChange({ target: { value } }); return render(); },
  };
}

test("dark dropdowns replace native selects, keep labels and remove Apply", () => {
  const Bar = load("../components/dashboard/operations/operations-filters.tsx", {
    ...dependencies, "next/navigation": { useRouter: () => ({ replace() {} }) },
  }).default;
  const html = renderToStaticMarkup(React.createElement(Bar, {
    kind: "incidents", filters: defaults(), statuses, placeholder: "Search commands...",
  }));
  assert.doesNotMatch(html, /<select|>Apply</);
  assert.equal((html.match(/aria-haspopup="menu"/g) ?? []).length, 2);
  assert.match(html, /role="search"/);
  assert.match(html, /Last 7 days/);
  assert.match(html, /All signals/);
  assert.match(html, /bg-\[#090a0c\]/);
  assert.match(html, /aria-labelledby=/);
  assert.match(html, /name="days" value="7"/);
});

test("typing is immediate, debounced at 250ms and keeps source, status and range", (t) => {
  const h = harness(t, defaults({ status: "failed", days: "30", page: "3" }));
  assert.equal(search(h.type("D")).props.value, "D");
  h.tick(200);
  assert.equal(h.calls.length, 0);
  h.type("DNS & GP");
  h.tick(249);
  assert.equal(h.calls.length, 0);
  h.tick(1);
  assert.equal(h.calls.length, 1);
  const { href, options } = h.calls[0];
  assert.deepEqual(options, { scroll: false });
  const params = new URL(href, "https://test.invalid").searchParams;
  assert.equal(params.get("q"), "DNS & GP");
  assert.equal(params.get("days"), "30");
  assert.equal(params.get("status"), "failed");
  assert.equal(params.get("source"), "commands");
  assert.equal(params.get("page"), null);
  assert.match(renderToStaticMarkup(h.render()), /Updating/);
});

test("status and range apply immediately with pending text, cancelling queued searches", (t) => {
  const h = harness(t);
  h.type("DNS");
  select(h.render(), "status").props.onChange("failed");
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].href, /q=DNS&status=failed&days=7/);
  select(h.render(), "days").props.onChange("90");
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1].href, /q=DNS&status=failed&days=90/);
  h.tick(500);
  assert.equal(h.calls.length, 2);
});

test("Enter applies immediately, and repeated equivalent submissions do not query again", (t) => {
  const h = harness(t);
  h.type("DNS");
  let prevented = false;
  h.render().props.onSubmit({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(h.calls.length, 1);
  h.tick(500);
  assert.equal(h.calls.length, 1);
  h.commit({ q: "DNS" });
  h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 1);
});

test("clear and reset cancel queued searches, restore focus and reset pagination", (t) => {
  const h = harness(t, defaults({ q: "old", days: "90", status: "expired", page: "4" }));
  let focused = 0;
  search(h.render()).props.ref.current = { focus: () => focused++ };
  h.type("new");
  button(h.render(), "Clear search").props.onClick();
  assert.equal(search(h.render()).props.value, "");
  assert.equal(h.calls.length, 1);
  assert.doesNotMatch(h.calls[0].href, /[?&]q=|page=/);
  assert.match(h.calls[0].href, /status=expired&days=90/);
  h.type("another");
  button(h.render(), "Reset").props.onClick();
  assert.equal(h.calls.at(-1).href, "/dashboard/incidents?source=commands&days=7");
  assert.equal(focused, 2);
  h.tick(500);
  assert.equal(h.calls.length, 2);
});

test("server responses preserve newer input and subsequent pagination synchronizes cleanly", (t) => {
  const h = harness(t);
  h.type("D"); h.tick(250);
  h.type("DNS");
  const committed = h.commit({ q: "D" });
  assert.equal(search(committed).props.value, "DNS");
  h.tick(250);
  assert.match(h.calls.at(-1).href, /q=DNS/);
  h.commit({ q: "DNS" });
  assert.equal(search(h.commit({ q: "DNS", page: "2" })).props.value, "DNS");
  assert.equal(search(h.commit({})).props.value, "");
});

test("back navigation and unmount cancel pending typing without sending stale requests", (t) => {
  const h = harness(t);
  h.type("cancelled");
  window.location.search = "?source=commands&q=restored&days=30";
  h.listeners.get("popstate")();
  assert.equal(search(h.render()).props.value, "restored");
  h.tick(500);
  assert.equal(h.calls.length, 0);
  h.type("unmounted");
  h.dispose();
  h.tick(500);
  assert.equal(h.calls.length, 0);
  assert.equal(h.listeners.size, 0);
});

test("IME composition waits for committed text rather than submitting intermediate characters", (t) => {
  const h = harness(t);
  search(h.render()).props.onCompositionStart();
  h.type("composing");
  h.tick(500);
  assert.equal(h.calls.length, 0);
  search(h.render()).props.onCompositionEnd({ currentTarget: { value: "completed" } });
  h.tick(250);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].href, /q=completed/);
});

test("alert sources use the same live filtering without incident-only range parameters", (t) => {
  const initial = defaults({ source: "monitors" }, "alerts");
  const h = harness(t, initial);
  h.render({ kind: "alerts", statuses: [{ id: "unchecked", name: "Not checked" }] });
  h.type("Endpoint");
  select(h.render(), "status").props.onChange("unchecked");
  assert.equal(h.calls[0].href, "/dashboard/alerts?source=monitors&q=Endpoint&status=unchecked");
  assert.equal(elements(h.render()).some((element) => element.props.name === "days"), false);
});
