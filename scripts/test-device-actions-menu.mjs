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
    "@/components/ui/dropdown-menu": {
      DropdownMenu: ({ open, children }) => React.createElement('div', { 'aria-expanded': open }, open ? children : children[0]),
      DropdownMenuTrigger: ({ children }) => children,
      DropdownMenuContent: ({ children, className, 'aria-label': label }) => React.createElement('div', { className, 'aria-label': label }, children),
      DropdownMenuGroup: ({ children }) => React.createElement('div', null, children),
      DropdownMenuLabel: ({ children }) => React.createElement('p', null, children),
      DropdownMenuItem: ({ onSelect, ...props }) => React.createElement('button', { ...props, onClick: onSelect }),
    },
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
  assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, 0);
  for (const action of definitions.DEVICE_ACTIONS) assert.ok(html.includes(action.label));
  assert.match(html, /duration-200 motion-reduce:animate-none/);
  assert.match(html, /aria-expanded="true"/);
  assert.doesNotMatch(html, /Checking action availability/);
  assert.equal((menu.render({ online: false }).match(/aria-disabled="true"/g) ?? []).length, 8);
  assert.equal((menu.render({ busy: true }).match(/aria-disabled="true"/g) ?? []).length, 8);
  assert.doesNotMatch(menu.render({ open: false }), /aria-label="Device actions"/);
});

test("reopen retains fresh availability without another fetch", async t => {
  const originalDocument = globalThis.document;
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ actions: { reboot: "Another device command is already running" } }) }));
  const menu = harness();
  t.after(() => { menu.dispose(); if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
  menu.render({open:false}); menu.flush(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal((menu.render().match(/aria-disabled="true"/g) ?? []).length, 1);
  menu.flush();
  menu.render({open:false}); menu.flush();
  assert.equal((menu.render().match(/aria-disabled="true"/g) ?? []).length, 1);
  menu.flush();
  assert.equal(fetch.mock.callCount(), 1);
});

test("availability makes no periodic requests closed/hidden, refreshes stale reopen and invalidates on local state changes", async t => {
  const originalDocument=globalThis.document;
  const listeners=new Map(), timers=new Set();
  globalThis.document={visibilityState:"visible",addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)};
  let now=10000;
  t.mock.method(Date,"now",()=>now);
  t.mock.method(globalThis,"setInterval",callback=>{timers.add(callback);return callback;});
  t.mock.method(globalThis,"clearInterval",callback=>timers.delete(callback));
  const actions=Object.fromEntries(definitions.DEVICE_ACTIONS.map(({type})=>[type,null]));
  t.mock.method(globalThis,"fetch",async()=>({ok:true,json:async()=>({actions})}));
  const menu=harness();
  t.after(()=>{menu.dispose();if(originalDocument===undefined) delete globalThis.document;else globalThis.document=originalDocument;});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  menu.render({open:false});menu.flush();await settle();
  assert.equal(fetch.mock.callCount(),1);assert.equal(timers.size,0);
  now+=60000;
  assert.equal(fetch.mock.callCount(),1,"closed menu must not run periodic fetches");
  menu.render();menu.flush();await settle();
  assert.equal(fetch.mock.callCount(),2);assert.equal(timers.size,1);
  globalThis.document.visibilityState="hidden";now+=60000;
  for(const callback of timers) callback(); await settle();
  assert.equal(fetch.mock.callCount(),2,"hidden tab must not poll");
  globalThis.document.visibilityState="visible";listeners.get("visibilitychange")();await settle();
  assert.equal(fetch.mock.callCount(),3);
  for(const callback of timers) callback();await settle();
  assert.equal(fetch.mock.callCount(),3,"fresh visibility fetch must not be duplicated by timer");
  now+=5000;for(const callback of timers) callback();await settle();
  assert.equal(fetch.mock.callCount(),4);
  menu.render({busy:true});menu.flush();await settle();assert.equal(fetch.mock.callCount(),5);
  menu.render({online:false});menu.flush();await settle();assert.equal(fetch.mock.callCount(),6);
  menu.render({open:false,online:false});menu.flush();await settle();
  assert.equal(timers.size,0);assert.equal(listeners.size,0);assert.equal(fetch.mock.callCount(),6);
});

test("availability aborts on close and failed refresh remains an explicit error", async t => {
  const originalDocument=globalThis.document;
  globalThis.document={visibilityState:"visible",addEventListener(){},removeEventListener(){}};
  let signal;
  t.mock.method(globalThis,"fetch",async(_url,options)=>{
    signal=options.signal;
    return {ok:false,status:503};
  });
  const menu=harness();
  t.after(()=>{menu.dispose();if(originalDocument===undefined) delete globalThis.document;else globalThis.document=originalDocument;});
  menu.render();menu.flush();await new Promise(resolve=>setImmediate(resolve));
  assert.match(menu.render(),/Could not check action availability/);
  const previousSignal=signal;
  menu.render({open:false});menu.flush();
  assert.equal(previousSignal.aborted,true);
  await new Promise(resolve=>setImmediate(resolve));
});
