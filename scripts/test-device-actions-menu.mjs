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
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const definitions = load("../lib/remote/action-definitions.ts");

function harness() {
  const slots = [];
  let cursor = 0;
  const effects = [];
  const refs = [];
  const Menu = load("../components/dashboard/devices/device-actions-menu.tsx", {
    "@/lib/remote/action-definitions": definitions,
    react: {
      ...React,
      useState(initial) {
        const index = cursor++;
        slots[index] ??= { value: initial };
        return [slots[index].value, (value) => { slots[index].value = value; }];
      },
      useRef() {
        const index = cursor++;
        if (!slots[index]) { slots[index] = { current: null }; refs.push(slots[index]); }
        return slots[index];
      },
      useEffect(callback, deps) {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
          effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
        }
      },
    },
  }).default;
  const changes = [];
  const props = { device: { id: "device", hostname: "test", display_name: null }, online: true, busy: false,
    open: true, onOpenChange: (open) => changes.push(open), onAction() {} };
  return {
    refs, changes,
    render(overrides = {}) { cursor = 0; return renderToStaticMarkup(React.createElement(Menu, { ...props, ...overrides })); },
    flush() { effects.splice(0).forEach((effect) => effect()); },
    dispose() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test("pending availability does not disable actions; local safety guards and animation remain", () => {
  const menu = harness();
  const html = menu.render();
  assert.equal((html.match(/ disabled=""/g) ?? []).length, 0);
  for (const action of definitions.DEVICE_ACTIONS) assert.ok(html.includes(action.label));
  assert.match(html, /animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150 motion-reduce:animate-none/);
  assert.match(html, /aria-expanded="true"/);
  assert.doesNotMatch(html, /Checking action availability/);
  assert.equal((menu.render({ online: false }).match(/ disabled=""/g) ?? []).length, 8);
  assert.equal((menu.render({ busy: true }).match(/ disabled=""/g) ?? []).length, 8);
  assert.doesNotMatch(menu.render({ open: false }), /aria-label="Device actions"/);
});

test("outside pointer/focus and Escape dismiss; reopen retains availability without a new fetch", async (t) => {
  const listeners = new Map();
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ actions: {
    ...Object.fromEntries(definitions.DEVICE_ACTIONS.map(({ type }) => [type, null])),
    reboot: "Another device command is already running",
  } }) }));
  const originalDocument = globalThis.document, originalNode = globalThis.Node;
  class MockNode {}
  globalThis.Node = MockNode;
  globalThis.document = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const menu = harness();
  t.after(() => {
    menu.dispose();
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalNode === undefined) delete globalThis.Node; else globalThis.Node = originalNode;
  });
  menu.render({ open: false }); menu.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(listeners.size, 0);
  assert.equal((menu.render().match(/ disabled=""/g) ?? []).length, 1);
  menu.flush();
  const inside = new MockNode(), outside = new MockNode();
  let focused = false;
  menu.refs[0].current = { contains: (node) => node === inside };
  menu.refs[1].current = { focus() { focused = true; } };
  listeners.get("pointerdown")({ target: inside });
  assert.deepEqual(menu.changes, []);
  listeners.get("pointerdown")({ target: outside });
  listeners.get("focusin")({ target: outside });
  let prevented = false, stopped = false;
  listeners.get("keydown")({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.deepEqual(menu.changes, [false, false, false]);
  assert.ok(focused && prevented && stopped);
  menu.render({ open: false }); menu.flush();
  assert.equal(listeners.size, 0);
  assert.equal((menu.render().match(/ disabled=""/g) ?? []).length, 1);
  menu.flush();
  assert.equal(fetch.mock.callCount(), 1);
});
