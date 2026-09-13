import { readFileSync, writeFileSync, mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import ts from "typescript";
import { device } from "./dashboard-ui-fixtures.mjs";

const require = createRequire(import.meta.url);

export async function deviceBrowserFixture() {
  const directory = mkdtempSync(join(tmpdir(), "sentinelgrid-device-build-"));
  const files = [], sources = new Map();
  function emit(name, source) {
    const path = join(directory, name);
    files.push(path);
    writeFileSync(path, source);
    return path;
  }
  const stubs = new Map([
    [resolve("app\\dashboard\\organizations\\[id]\\clients\\[clientId]\\device-actions.ts"), "export async function deleteDeviceAction() { throw new Error('Fixture cannot delete devices'); }"],
    [resolve("lib\\supabase\\client.ts"), "const db = { auth: { async getSession() { return { data: { session: { access_token: 'fixture-only' } } }; } } }; export function createClient() { return db; }"],
    [resolve("lib\\realtime\\endpoint.ts"), "export async function browserRealtimeURL() { return 'wss://fixture.invalid'; }"],
  ]);
  function compile(path) {
    path = resolve(path);
    if (sources.has(path)) return sources.get(path);
    const output = join(directory, `source-${sources.size}.js`);
    sources.set(path, output);
    let code = stubs.get(path) ?? ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    for (const imported of ts.preProcessFile(code).importedFiles.reverse()) {
      const name = imported.fileName;
      if (!name.startsWith("@/") && !name.startsWith(".")) continue;
      const base = name.startsWith("@/") ? resolve(...name.slice(2).split("/")) : resolve(dirname(path), ...name.split("/"));
      const source = ts.sys.fileExists(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`;
      const target = compile(source);
      code = code.slice(0, imported.pos) + JSON.stringify(target) + code.slice(imported.pos + name.length + 2);
    }
    files.push(output);
    writeFileSync(output, code);
    return output;
  }
  try {
    const Dashboard = compile("app\\dashboard\\organizations\\[id]\\clients\\[clientId]\\device-dashboard.tsx");
    const Provider = compile("components\\dashboard\\appearance-provider.tsx");
    const Background = compile("components\\dashboard\\dashboard-background.tsx");
    const alias = {
      "next/navigation": emit("navigation.js", "const router = { refresh() {}, push() {}, replace() {} }; export const useRouter = () => router; export const usePathname = () => '/dashboard';"),
      "next/link": emit("link.js", "import React from 'react'; export default function Link({children, ...props}) { return React.createElement('a', props, children); }"),
    };
    const entry = emit("entry.js", `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import Dashboard from ${JSON.stringify(Dashboard)};
      import {AppearanceProvider} from ${JSON.stringify(Provider)};
      import Background from ${JSON.stringify(Background)};
      window.fixtureCommands = [];
      window.fixtureSockets = [];
      window.fetch = async (url, options = {}) => {
        if (options.method && options.method !== 'GET') throw new Error('Fixture cannot run device actions');
        if (url.endsWith('/commands')) return new Response(JSON.stringify({actions: {}}));
        if (url.endsWith('/rdp')) return new Response(null, {status:204});
        if (url.includes('/performance')) return new Response(JSON.stringify({error:'No fixture history'}), {status:503});
        throw new Error('Unexpected fixture fetch: ' + url);
      };
      class Socket {
        static OPEN = 1; static CLOSED = 3; readyState = 1;
        constructor() { window.fixtureSockets.push(this); setTimeout(() => this.onopen?.(), 10); }
        message(data) { this.onmessage?.({data:JSON.stringify(data)}); }
        send(data) {
          const body = JSON.parse(data);
          if (body.type === 'browser_auth') setTimeout(() => this.message({type:'browser_authenticated',online:true}), 10);
          if (body.type === 'command') { window.fixtureCommands.push(body); }
        }
        close() { this.readyState = 3; }
      }
      window.WebSocket = Socket;
      const device = ${JSON.stringify({ ...device, agent_id: "agent-fixture", capabilities: { terminal: true, rdp: true, tcp_tunnel: true }, last_seen: new Date().toISOString() })};
      device.last_seen = new Date().toISOString();
      const h = React.createElement;
      createRoot(document.getElementById('device-root')).render(h(AppearanceProvider, null,
        h('div', {className:'sg-dashboard relative flex h-dvh overflow-hidden'}, h(Background),
          h('main', {className:'relative z-10 min-w-0 flex-1 overflow-auto'},
            h('div', {className:'sg-page'}, h(Dashboard, {devices:[device], sites:[device.sites], clientName:'A client with a deliberately long mobile name', canManage:true, rdpConfigured:true, activity:[], activityCommands:[]}))))));
    `);
    const { webpack } = require("next/dist/compiled/webpack/webpack");
    const bundle = join(directory, "bundle.js");
    files.push(bundle);
    const compiler = webpack({ mode: "development", devtool: false, target: "web", context: process.cwd(), entry,
      plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '""' })],
      output: { path: directory, filename: "bundle.js" }, resolve: { alias, modules: [resolve("node_modules"), "node_modules"] },
    });
    try {
      await new Promise((resolve, reject) => compiler.run((error, stats) => {
        if (error) reject(error);
        else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
        else resolve();
      }));
    } finally { await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve())); }
    return readFileSync(bundle, "utf8");
  } finally {
    for (const file of files) if (ts.sys.fileExists(file)) rmSync(file);
    rmdirSync(directory);
  }
}
