import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../components/dashboard/devices/device-terminal.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function harness(t) {
  const slots = [], effects = [], listeners = new Map(), sockets = [];
  let cursor = 0, focused = 0, closed = 0, input, run;
  const inputNode = { disabled: true, focus() { assert.equal(this.disabled, false); focused++; } };
  class Socket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = Socket.OPEN;
    sent = [];
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close(code, reason) { this.readyState = Socket.CLOSED; this.closeArgs = [code, reason]; }
    message(value) { this.onmessage({ data: JSON.stringify(value) }); }
  }
  const globals = {
    window: { location: { origin: "https://test.invalid" }, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout },
    document: {
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    },
    WebSocket: Socket,
  };
  const previousGlobals = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const changed = (previous, deps) => !previous || deps.some((value, index) => !Object.is(value, previous.deps[index]));
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(callback, deps) {
      const index = cursor++;
      if (changed(slots[index], deps)) slots[index] = { deps, value: callback() };
      return slots[index].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const index = cursor++, previous = slots[index];
      if (changed(previous, deps)) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
    },
  };
  const mocks = {
    react: hooks,
    "@/lib/supabase/client": { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } }) },
    "@/lib/realtime/endpoint": { browserRealtimeURL: async () => "wss://test.invalid" },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), loaded, loaded.exports);
  const props = { open: true, initialShell: "powershell", device: { id: "device", hostname: "test", display_name: null }, canManage: true, onClose: () => { closed++; } };
  function visit(node) {
    if (!React.isValidElement(node)) return;
    if (node.type === "input") { input = node.props; inputNode.disabled = input.disabled; input.ref.current = inputNode; }
    if (node.type === "button" && node.props.children === "Run") run = node.props;
    if (node.type === "div" && node.props.ref) node.props.ref.current = { scrollIntoView() {} };
    React.Children.forEach(node.props.children, visit);
  }
  function render(overrides = {}) {
    Object.assign(props, overrides);
    cursor = 0;
    const tree = loaded.exports.default(props);
    visit(tree);
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  t.after(() => {
    slots.forEach((slot) => slot?.cleanup?.());
    for (const [key, descriptor] of Object.entries(previousGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return {
    render, listeners, sockets,
    get focused() { return focused; }, get closed() { return closed; },
    get input() { return input; },
    async connect() {
      render(); render();
      await new Promise((resolve) => setImmediate(resolve));
      sockets[0].onopen();
      sockets[0].message({ type: "browser_authenticated", online: true });
      render();
    },
    submit(command, enter = false) {
      input.onChange({ target: { value: command } }); render();
      if (enter) input.onKeyDown({ key: "Enter", preventDefault() {} }); else run.onClick();
      render();
    },
  };
}

for (const shell of ["powershell", "cmd"]) {
  test(`${shell}: refocus after success/error and local clear without changing command delivery`, async (t) => {
    const terminal = harness(t);
    terminal.render({ initialShell: shell });
    await terminal.connect();
    assert.equal(terminal.focused, 1);
    const socket = terminal.sockets[0];
    for (const [index, result] of [
      { type: "command_result", stdout: "ok", exit_code: 0 },
      { type: "command_result", stderr: "failure", exit_code: 1 },
      { type: "error", message: "Command timed out", code: "COMMAND_TIMEOUT" },
    ].entries()) {
      terminal.submit("echo test", index === 0);
      assert.equal(terminal.input.disabled, true);
      assert.equal(terminal.input.value, "");
      assert.deepEqual(socket.sent.at(-1), { type: "command", shell, command: "echo test" });
      const count = terminal.focused;
      socket.message(result); terminal.render();
      assert.equal(terminal.input.disabled, false);
      assert.equal(terminal.focused, count + 1);
      terminal.render();
      assert.equal(terminal.focused, count + 1);
    }
    terminal.input.onKeyDown({ key: "ArrowUp", preventDefault() {} }); terminal.render();
    assert.equal(terminal.input.value, "echo test");
    for (const command of ["clear", "cls"]) {
      const count = terminal.focused, sent = socket.sent.length;
      terminal.submit(command);
      assert.equal(terminal.focused, count + 1);
      assert.equal(terminal.input.value, "");
      assert.equal(socket.sent.length, sent);
    }
    const count = terminal.focused;
    socket.message({ type: "pong", online: false }); terminal.render();
    assert.equal(terminal.input.disabled, true);
    assert.equal(terminal.focused, count);
    socket.message({ type: "pong", online: true }); terminal.render();
    assert.equal(terminal.focused, count + 1);
    assert.equal(terminal.sockets.length, 1);
  });
}

test("Escape uses existing close lifecycle, including while busy, and listener is removed on close", async (t) => {
  const terminal = harness(t);
  assert.equal(terminal.render({ open: false }), null);
  assert.equal(terminal.listeners.size, 0);
  terminal.render({ open: true });
  await terminal.connect();
  terminal.submit("echo test");
  const handler = terminal.listeners.get("keydown");
  handler({ key: "a" });
  handler({ key: "Escape", isComposing: true });
  handler({ key: "Escape", defaultPrevented: true });
  assert.equal(terminal.closed, 0);
  let prevented = false, stopped = false;
  handler({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(terminal.closed, 1);
  assert.ok(prevented && stopped);
  assert.deepEqual(terminal.sockets[0].closeArgs, [1000, "Terminal closed"]);
  const count = terminal.focused;
  assert.equal(terminal.render({ open: false }), null);
  assert.equal(terminal.listeners.size, 0);
  assert.equal(terminal.focused, count);
});
