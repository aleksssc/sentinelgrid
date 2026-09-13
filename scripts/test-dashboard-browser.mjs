// Usage: node scripts\test-dashboard-browser.mjs "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, rmdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import WebSocket from "ws";
import { renderDashboardFixtures, fixtureMocks } from "./dashboard-ui-fixtures.mjs";
import { dashboardLoader } from "./dashboard-test-loader.mjs";
import { appearanceBrowserFixture } from "./dashboard-appearance-browser.mjs";
import { checkInterface } from "./dashboard-interface-checks.mjs";
import { renderOnboardingFixtures } from "./onboarding-appearance-fixtures.mjs";
import { checkOnboarding } from "./onboarding-appearance-checks.mjs";

const executable = process.argv[2];
if (!executable || !existsSync(executable)) throw new Error("Supply the path to an already-installed Chromium browser. No browser is downloaded.");
const h = React.createElement;
const fixtures = await renderDashboardFixtures();
const appearance = await appearanceBrowserFixture();
fixtures.appearance = `<div id="appearance-root">${appearance.markup}</div>`;
const mocks = {
  ...fixtureMocks(),
  "./dashboard-background.css": {}, "./dashboard-design.css": {}, "./dashboard-themes.css": {}, "./dashboard-interface.css": {},
  "@/components/dashboard/organization-gate": ({ children }) => children,
  "@/components/dashboard/notifications/notifications-bell": () => h("button", { "aria-label": "Notifications", className: "sg-button sg-button-ghost sg-button-icon" }, "3"),
  "@/components/user-menu": { UserMenu: () => h("button", { "aria-label": "Account menu", className: "sg-button sg-button-secondary sg-button-icon" }, "AM") },
};
const shellLoad = dashboardLoader(mocks);
const Shell = shellLoad("app\\dashboard\\layout.tsx").default;
const Provider = shellLoad("components\\dashboard\\appearance-provider.tsx").AppearanceProvider;
const tailwind = await postcss([tailwindcss()]).process(readFileSync("app\\globals.css", "utf8"), { from: resolve("app\\globals.css") });
const css = tailwind.css + readFileSync("app\\dashboard\\dashboard-background.css", "utf8") + readFileSync("app\\dashboard\\dashboard-design.css", "utf8") + readFileSync("app\\dashboard\\dashboard-themes.css", "utf8") + readFileSync("app\\dashboard\\dashboard-interface.css", "utf8");
const documents = Object.fromEntries(Object.entries(fixtures).map(([name, markup]) => [name,
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="font-family:Arial,sans-serif">${name === "appearance" ? markup : renderToStaticMarkup(h(Provider, null, h(Shell, null, h("div", { dangerouslySetInnerHTML: { __html: markup } }))))}${name === "appearance" ? '<script src="/appearance-bundle.js"></script>' : ""}</body></html>`,
]));
const onboardingCss = readFileSync("components\\onboarding\\onboarding-shell.css", "utf8");
for (const [mode, markup] of Object.entries(await renderOnboardingFixtures())) {
  documents[`onboarding-${mode}`] = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${onboardingCss}</style></head><body style="font-family:Arial,sans-serif">${markup}</body></html>`;
}

const server = createServer((request, response) => {
  if (request.url === "/appearance-bundle.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(appearance.script);
    return;
  }
  const key = request.url?.slice(1) || "dashboard";
  if (Object.hasOwn(documents, key)) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(documents[key]);
  } else if (["logos/sentinelgrid-mark.svg", "logos/sentinelgrid-wordmark.svg"].includes(key)) {
    response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end(readFileSync(join("public", ...key.split("/"))));
  } else { response.writeHead(404); response.end(); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const temporary = mkdtempSync(join(tmpdir(), "sentinelgrid-ui-"));
const profile = join(temporary, "browser-profile");
mkdirSync(profile);
let browser;
let socket;
let command;
try {
  browser = spawn(executable, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--disable-extensions", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let launchError;
  browser.once("error", (error) => { launchError = error; });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; !existsSync(portFile) && i < 150; i++) {
    if (launchError) throw launchError;
    if (browser.exitCode !== null) throw new Error(`Browser exited: ${browser.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!existsSync(portFile)) throw new Error("The isolated browser did not start its debugging endpoint.");
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const endpoint = `http://127.0.0.1:${port}`;
  const version = await fetch(`${endpoint}/json/version`).then((r) => r.json());
  assert.ok(version.Browser, "Browser must be running and responsive");
  const target = await fetch(`${endpoint}/json/new?${encodeURIComponent(`${origin}/dashboard`)}`, { method: "PUT" }).then((r) => r.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, "open");
  let sequence = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") runtimeErrors.push(message.params.args.map(arg => arg.value ?? arg.description).join(" "));
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result); }
  });
  command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 10000);
    pending.set(id, { resolve: (result) => { clearTimeout(timer); resolve(result); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await command("Page.enable");
  await command("Runtime.enable");
  let checks = 0;
  for (const width of [320, 390, 768, 1440, 1920]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const name of Object.keys(fixtures)) {
      await command("Page.navigate", { url: `${origin}/${name}` });
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`document.readyState === 'complete' && location.pathname === '/${name}'`)) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const measurements = await evaluate(`(() => {
        const main = document.querySelector('main');
        const surface = document.querySelector('.sg-surface:not(.sg-danger)');
        const page = document.querySelector('.sg-page');
        const drawer = document.querySelector('.sg-drawer');
        const title = document.querySelector('h1');
        const style = element => element ? getComputedStyle(element) : null;
        return {
          viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth, mainOverflow: style(main).overflowY,
          pageWidth: page?.getBoundingClientRect().width, pagePadding: style(page)?.paddingLeft,
          surfaceColor: style(surface)?.backgroundColor, surfaceRadius: style(surface)?.borderRadius,
          titleSize: style(title)?.fontSize,
          drawerWidth: drawer?.getBoundingClientRect().width, drawerTop: drawer?.getBoundingClientRect().top,
          drawerScrollWidth: drawer?.scrollWidth, drawerClientWidth: drawer?.clientWidth,
          sidebarWidth: document.querySelector('.sg-sidebar').getBoundingClientRect().width,
          sidebarScrollWidth: document.querySelector('.sg-sidebar').scrollWidth,
          sidebarClientWidth: document.querySelector('.sg-sidebar').clientWidth,
          buttonHeight: document.querySelector('.sg-page .sg-button-primary')?.getBoundingClientRect().height
        };
      })()`);
      assert.ok(measurements.documentWidth <= width + 1, `${name} ${width}: document overflows ${JSON.stringify(measurements)}`);
      assert.ok(measurements.mainScrollWidth <= measurements.mainWidth + 1, `${name} ${width}: page content overflows ${JSON.stringify(measurements)}`);
      assert.equal(measurements.mainOverflow, "auto", `${name}: main scrolling`);
      if (measurements.pageWidth) assert.ok(measurements.pageWidth <= 1440, `${name}: max width`);
      if (measurements.surfaceColor) { assert.equal(measurements.surfaceColor, "rgb(13, 15, 18)", `${name}: opaque panel`); assert.equal(measurements.surfaceRadius, "16px", `${name}: radius`); }
      if (measurements.titleSize) assert.equal(measurements.titleSize, width < 640 ? "28px" : "30px", `${name}: heading`);
      if (measurements.drawerWidth) {
        assert.ok(measurements.drawerWidth <= width, `${name}: drawer fits viewport`);
        assert.equal(measurements.drawerTop, 72, `${name}: drawer aligns with topbar`);
        assert.ok(measurements.drawerScrollWidth <= measurements.drawerClientWidth + 1, `${name}: drawer content overflows`);
      }
      assert.ok(measurements.sidebarScrollWidth <= measurements.sidebarClientWidth + 1, `${name}: sidebar content fits`);
      if (width < 1024) assert.equal(measurements.sidebarWidth, 0, `${name}: navigation moves to the menu overlay`);
      if (name === "organization" || name === "clients") {
        const summaryHeight = await evaluate("document.querySelector('.sg-compact-summary').getBoundingClientRect().height");
        assert.ok(summaryHeight <= 48, `${name} summary stays compact at ${width}px: ${summaryHeight}px`);
      }
      checks++;
    }
  }
  await command("Page.navigate", { url: `${origin}/monitors` });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const focus = await evaluate(`(() => { const button = document.querySelector('.sg-page .sg-button'); button.focus({preventScroll:true}); const s = getComputedStyle(button); return { width: s.outlineWidth, style: s.outlineStyle }; })()`);
  assert.equal(focus.style, "solid"); assert.equal(focus.width, "2px");
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const motion = await evaluate("getComputedStyle(document.querySelector('.dashboard-grid')).animationDuration");
  assert.ok(parseFloat(motion) < 0.001, "Reduced motion disables the decorative grid animation");
  const expectedThemes = {
    sentinel: { surface: "rgb(13, 15, 18)", canvas: "rgb(10, 10, 12)", radius: "16px" },
    midnight: { surface: "rgb(11, 20, 36)", canvas: "rgb(6, 12, 24)", radius: "14px" },
    aurora: { surface: "rgb(21, 16, 32)", canvas: "rgb(12, 8, 20)", radius: "20px" },
    graphite: { surface: "rgb(20, 21, 22)", canvas: "rgb(11, 12, 13)", radius: "8px" },
  };
  for (const width of [390, 1440]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const name of ["dashboard", "clients", "monitors", "settings", "drawer-overview", "performance"]) {
      await command("Page.navigate", { url: `${origin}/${name}` });
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`document.readyState === 'complete' && location.pathname === '/${name}'`)) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      for (const [theme, expected] of Object.entries(expectedThemes)) {
        let result;
        for (let attempt = 0; attempt < 100; attempt++) {
          result = await evaluate(`(() => {
          document.documentElement.setAttribute('data-sg-theme', '${theme}');
          const surface = getComputedStyle(document.querySelector('.sg-surface:not(.sg-danger)'));
          const main = document.querySelector('main');
          return { surface: surface.backgroundColor, radius: surface.borderRadius,
            canvas: getComputedStyle(document.querySelector('.sg-dashboard')).backgroundColor,
            fits: main.scrollWidth <= main.clientWidth + 1 };
        })()`);
          if (result.surface === expected.surface && result.radius === expected.radius) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.deepEqual(result, { ...expected, fits: true }, `${name} ${width} ${theme}`);
        checks++;
      }
    }
  }
  async function appearanceReady() {
    for (let i = 0; i < 200; i++) {
      if (await evaluate("location.pathname === '/appearance' && !!document.querySelector('input[name=appearance-theme]') && !document.querySelector('fieldset').disabled")) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Appearance did not hydrate: ${runtimeErrors.join("\n")}`);
  }
  async function selectedTheme(theme) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`document.documentElement.dataset.sgTheme === '${theme}' && document.querySelector('input[value="${theme}"]').checked`)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Theme ${theme} was not applied`);
  }
  await command("Page.navigate", { url: `${origin}/appearance` });
  await appearanceReady();
  for (const theme of Object.keys(expectedThemes)) {
    await evaluate(`document.querySelector('input[value="${theme}"]').click()`);
    await selectedTheme(theme);
    if (theme !== "sentinel") assert.equal(await evaluate("localStorage.getItem('sentinelgrid-appearance')"), theme);
  }
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.dashboard-grid')).animationName"), "none");
  await command("Page.reload");
  await appearanceReady();
  await selectedTheme("graphite");
  assert.deepEqual(await evaluate("window.appearanceHydrationErrors"), [], "Saved themes must hydrate cleanly");
  await evaluate("document.querySelector('input[value=midnight]').focus()");
  const outline = await evaluate("getComputedStyle(document.querySelector('input[value=midnight] + .sg-theme-card')).outlineWidth");
  assert.equal(outline, "2px", "Radio keyboard focus is visible on its card");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await selectedTheme("aurora");
  const other = await command("Target.createTarget", { url: `${origin}/appearance` });
  const attached = await command("Target.attachToTarget", { targetId: other.targetId, flatten: true });
  await command("Runtime.evaluate", { expression: "localStorage.setItem('sentinelgrid-appearance', 'midnight')" }, attached.sessionId);
  await selectedTheme("midnight");
  await command("Target.closeTarget", { targetId: other.targetId });
  await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Reset to Sentinel')).click()");
  await selectedTheme("sentinel");
  assert.equal(await evaluate("localStorage.getItem('sentinelgrid-appearance')"), "sentinel");
  await evaluate("window.originalStorageSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new DOMException('Blocked', 'SecurityError'); }; document.querySelector('input[value=aurora]').click()");
  await selectedTheme("aurora");
  assert.match(await evaluate("document.querySelector('[role=alert]').textContent"), /could not save/);
  await evaluate("Storage.prototype.setItem = window.originalStorageSetItem");
  await command("Page.reload");
  await appearanceReady();
  await selectedTheme("sentinel");
  assert.deepEqual(await evaluate("window.appearanceHydrationErrors"), []);
  await checkInterface({ evaluate, command, appearanceReady, selectedTheme, origin });
  await checkOnboarding({ evaluate, command, origin });
  assert.deepEqual(runtimeErrors, [], "Browser fixtures must not produce runtime or hydration console errors");
  console.log("Appearance selection, persistence, reset, cross-tab sync, keyboard navigation, blocked-storage feedback and hydration passed.");
  console.log(`${checks} responsive page/drawer checks passed (${version.Browser}); keyboard focus and reduced motion passed.`);
} finally {
  if (command && socket?.readyState === WebSocket.OPEN) {
    try { await command("Browser.close"); } catch (error) { if (browser?.exitCode === null) console.error("Browser close:", error.message); }
  }
  socket?.terminate();
  if (browser && browser.exitCode === null) {
    await Promise.race([once(browser, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (browser.exitCode === null) browser.kill();
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  rmdirSync(temporary);
}
