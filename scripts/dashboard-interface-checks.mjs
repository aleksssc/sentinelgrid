import assert from "node:assert/strict";
import { checkRefinement } from "./dashboard-refinement-checks.mjs";
import { checkControls } from "./dashboard-control-checks.mjs";

export async function checkInterface({ evaluate, command, appearanceReady, selectedTheme, origin }) {
  async function wait(expression, message = expression) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Interface check timed out: ${message}`);
  }
  const choose = async (name, value) => {
    await evaluate(`document.querySelector('input[name="interface-${name}"][value="${value}"]').click()`);
    await wait(`document.querySelector('input[name="interface-${name}"][value="${value}"]').checked`);
  };
  async function move(selector, click = false) {
    const point = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    if (click) {
      await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    }
  }
  async function key(key, code = key, windowsVirtualKeyCode = key === "Escape" ? 27 : 9) {
    await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  }
  const style = (selector, property) => evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)}))[${JSON.stringify(property)}]`);
  async function tokenColor(name) {
    return evaluate(`(() => { const p = document.createElement('span'); p.style.backgroundColor = 'var(${name})'; document.querySelector('.sg-dashboard').append(p); const color = getComputedStyle(p).backgroundColor; p.remove(); return color; })()`);
  }
  const reload = async () => { await command("Page.reload"); await appearanceReady(); };

  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await choose("density", "comfortable");
  await choose("defaultView", "list");
  await choose("sidebar", "expanded");
  const positive = await style(".sg-status-badge[data-tone=success]", "color");
  const hovers = new Set();
  for (const theme of ["sentinel", "midnight", "aurora", "graphite"]) {
    await evaluate(`document.querySelector('input[name=appearance-theme][value=${theme}]').click()`);
    await selectedTheme(theme);
    const expectedAccent = { sentinel: "#60a5fa", midnight: "#38bdf8", aurora: "#a78bfa", graphite: "#cbd5e1" }[theme];
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.sg-dashboard')).getPropertyValue('--sg-accent').trim()"), expectedAccent);
    const marker = await evaluate("getComputedStyle(document.querySelector('.sg-desktop-sidebar .sg-sidebar-item[data-active]'), '::before').backgroundColor");
    assert.equal(marker, await tokenColor("--sg-accent"), `${theme}: sidebar marker uses the palette accent`);
    assert.equal(await style('[aria-label="Device sections"] .sg-selection-indicator', "backgroundColor"), marker);
    const hover = await tokenColor("--sg-hover");
    const selected = await tokenColor("--sg-selected");
    hovers.add(hover);
    await move(".sg-client-row");
    await wait(`getComputedStyle(document.querySelector('.sg-client-row')).backgroundColor === ${JSON.stringify(hover)}`);
    assert.equal(await style(".sg-status-badge[data-tone=success]", "color"), positive, "Positive Active status must remain semantic");
    await move(`input[name=appearance-theme][value=${theme}] + .sg-theme-card`);
    await wait(`getComputedStyle(document.querySelector('input[name=appearance-theme][value=${theme}] + .sg-theme-card')).backgroundColor === ${JSON.stringify(hover)}`);
    await move('[data-fixture="filter"]', true);
    await wait("!!document.querySelector('.sg-themed-portal [role=menuitemradio]')");
    assert.equal(await evaluate("!!document.querySelector('.sg-themed-portal').closest('.sg-dashboard')"), false, "Exercise an actual body portal");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.sg-themed-portal')).getPropertyValue('--sg-accent').trim()"), await evaluate("getComputedStyle(document.querySelector('.sg-dashboard')).getPropertyValue('--sg-accent').trim()"));
    assert.equal(await style('.sg-themed-portal [role=menuitemradio][data-state=checked]', "backgroundColor"), selected, `${theme}: selected menu option`);
    const unselected = '.sg-themed-portal [role=menuitemradio][data-state=unchecked]';
    await evaluate(`document.querySelector('${unselected}').focus()`);
    await wait(`getComputedStyle(document.querySelector('${unselected}')).backgroundColor === ${JSON.stringify(hover)}`);
    const nextLabel = await evaluate(`document.querySelector('${unselected}').textContent`);
    await move(unselected, true);
    await wait("!document.querySelector('.sg-themed-portal')");
    await move('[data-fixture="filter"]', true);
    await wait("!!document.querySelector('.sg-themed-portal [role=menuitemradio][data-state=checked]')");
    assert.equal(await evaluate("document.querySelector('.sg-themed-portal [role=menuitemradio][data-state=checked]').textContent"), nextLabel);
    if (theme === "graphite") {
      await move('.sg-themed-portal [role=menuitem][aria-haspopup=menu]');
      await wait("document.querySelectorAll('.sg-themed-portal').length === 2");
      assert.equal(await evaluate("getComputedStyle(document.querySelectorAll('.sg-themed-portal')[1]).getPropertyValue('--sg-accent').trim()"), await evaluate("getComputedStyle(document.querySelector('.sg-dashboard')).getPropertyValue('--sg-accent').trim()"));
      await key("Escape");
    }
    await key("Escape");
    await wait("!document.querySelector('.sg-themed-portal')");
    await move('.sg-tab[aria-pressed="false"]');
    await wait(`getComputedStyle(document.querySelector('.sg-tab[aria-pressed="false"]')).backgroundColor === ${JSON.stringify(hover)}`);
    assert.equal(await style('.sg-tab[aria-pressed="true"]', "backgroundColor"), "rgba(0, 0, 0, 0)");
  }
  assert.equal(hovers.size, 4, "Each palette supplies a distinct subtle hover");

  await checkRefinement({ evaluate, wait, choose, move });
  await checkControls({ evaluate, wait, choose, move, key, command, selectedTheme, tokenColor });

  const comfortable = await evaluate("({ row:document.querySelector('.sg-client-row').getBoundingClientRect().height, panel:parseFloat(getComputedStyle(document.querySelector('[data-fixture=directory]')).paddingTop), toolbar:parseFloat(getComputedStyle(document.querySelector('.sg-client-toolbar')).marginBottom) })");
  await choose("density", "compact");
  await wait("parseFloat(getComputedStyle(document.querySelector('[data-fixture=directory]')).paddingTop) === 16", "Compact panel padding becomes 16px");
  const compact = await evaluate("({ row:document.querySelector('.sg-client-row').getBoundingClientRect().height, panel:parseFloat(getComputedStyle(document.querySelector('[data-fixture=directory]')).paddingTop), toolbar:parseFloat(getComputedStyle(document.querySelector('.sg-client-toolbar')).marginBottom) })");
  assert.ok(compact.row <= comfortable.row - 4 && compact.row >= 44, "Compact rows reduce real padding, preserving usable targets");
  assert.equal(compact.panel, comfortable.panel - 4);
  assert.equal(compact.toolbar, comfortable.toolbar - 4);
  assert.equal(await style(".sg-client-row", "transform"), "none");

  await choose("defaultView", "grid");
  await wait("!!document.querySelector('.sg-client-grid')");
  await evaluate("document.querySelector('button[aria-label=\"List view\"]').click()");
  await wait("!!document.querySelector('.sg-client-list')");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('sentinelgrid-interface')).defaultView"), "grid", "Local toggles do not overwrite the chosen default");
  await choose("defaultView", "list");
  await choose("defaultView", "grid");
  await wait("!!document.querySelector('.sg-client-grid')", "Returning to a default must not restore a stale local override");
  await reload();
  await wait("!!document.querySelector('.sg-client-grid')");
  await choose("defaultView", "list");
  await wait("!!document.querySelector('.sg-client-list')");
  await evaluate(`(() => { const input = document.querySelector('input[aria-label="Search clients"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'not-a-client'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await wait("document.querySelector('[data-fixture=directory]').textContent.includes('No clients found')");
  await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Clear search').click()");
  await wait("document.querySelectorAll('.sg-client-row').length === 2");
  assert.equal(await evaluate("document.querySelector('.sg-client-row').getAttribute('href')"), "/dashboard/organizations/org-1/clients/client-1");

  await choose("sidebar", "compact");
  await wait("document.querySelector('.sg-desktop-sidebar').getBoundingClientRect().width === 64");
  await choose("sidebar", "remember");
  await reload();
  await wait("document.querySelector('.sg-desktop-sidebar').getBoundingClientRect().width === 64");
  await evaluate("document.querySelector('.sg-desktop-sidebar button[aria-label=\"Expand sidebar\"]').click()");
  await wait("document.querySelector('.sg-desktop-sidebar').getBoundingClientRect().width === 224");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('sentinelgrid-interface')).sidebar"), "remember");
  await reload();
  assert.equal(await style(".sg-desktop-sidebar", "width"), "224px");
  await evaluate("document.querySelector('.sg-desktop-sidebar button[aria-label=\"Collapse sidebar\"]').click()");
  await wait("document.documentElement.dataset.sgSidebar === 'compact'");

  await evaluate("document.querySelector('input[name=appearance-theme][value=sentinel]').click()");
  await selectedTheme("sentinel");
  await choose("motion", "reduced");
  await wait("document.documentElement.dataset.sgMotion === 'reduced'");
  assert.equal(await style(".dashboard-grid", "animationName"), "none");
  assert.ok(parseFloat(await style(".sg-desktop-sidebar", "transitionDuration")) < 0.001);
  await choose("motion", "system");
  for (const value of ["no-preference", "reduce"]) {
    await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value }] });
    await wait(`document.documentElement.dataset.sgMotion === '${value === "reduce" ? "reduced" : "full"}'`);
  }
  await choose("motion", "full");
  await wait("document.documentElement.dataset.sgMotion === 'full'");
  await wait("getComputedStyle(document.querySelector('.dashboard-grid')).animationName === 'dashboard-grid-move'", "Full explicitly enables motion even when the OS prefers reduced");

  for (const width of [320, 768, 1023]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.equal(await style(".sg-desktop-sidebar", "display"), "none");
    await move(".sg-mobile-menu-trigger", true);
    await wait("document.querySelector('dialog').open");
    await wait("document.querySelector('.sg-mobile-sidebar').getBoundingClientRect().x >= -1");
    assert.equal(await style(".sg-mobile-sidebar .sg-sidebar-label", "display"), "block");
    assert.ok(await evaluate("document.querySelector('dialog').getBoundingClientRect().width <= innerWidth - 39"));
    for (let index = 0; index < 14; index++) {
      await key("Tab");
      assert.ok(await evaluate("document.querySelector('dialog').contains(document.activeElement) || document.activeElement === document.body"), "Modal navigation must not focus background controls");
    }
    await key("Escape");
    await wait("!document.querySelector('dialog').open");
    assert.equal(await evaluate("document.activeElement.classList.contains('sg-mobile-menu-trigger')"), true, "Escape returns focus to the trigger");
    await move(".sg-mobile-menu-trigger", true);
    await wait("document.querySelector('dialog').open");
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x: width - 5, y: 450, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: width - 5, y: 450, button: "left", clickCount: 1 });
    await wait("!document.querySelector('dialog').open", "Backdrop closes mobile navigation");
    await move(".sg-mobile-menu-trigger", true);
    await wait("document.querySelector('dialog').open");
    await evaluate("document.querySelector('.sg-mobile-sidebar a[aria-label=Clients]').addEventListener('click', e => e.preventDefault(), {once:true})");
    await move('.sg-mobile-sidebar a[aria-label="Clients"]', true);
    await wait("!document.querySelector('dialog').open", "Selecting a route dismisses the menu");
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth + 1"));
  }
  await move(".sg-mobile-menu-trigger", true);
  await wait("document.querySelector('dialog').open");
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await wait("!document.querySelector('dialog').open", "Desktop breakpoint dismisses an open mobile dialog");

  const other = await command("Target.createTarget", { url: `${origin}/appearance` });
  const attached = await command("Target.attachToTarget", { targetId: other.targetId, flatten: true });
  const shared = { density: "comfortable", motion: "reduced", sidebar: "expanded", defaultView: "grid", sidebarExpanded: true };
  await command("Runtime.evaluate", { expression: `localStorage.setItem('sentinelgrid-interface', ${JSON.stringify(JSON.stringify(shared))})` }, attached.sessionId);
  await wait("document.documentElement.dataset.sgDensity === 'comfortable' && document.documentElement.dataset.sgSidebar === 'expanded' && !!document.querySelector('.sg-client-grid')");
  await command("Target.closeTarget", { targetId: other.targetId });
  await evaluate("window.originalStorageSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new DOMException('Blocked','SecurityError'); }");
  await choose("density", "compact");
  await wait("document.documentElement.dataset.sgDensity === 'compact'");
  assert.match(await evaluate("document.querySelector('[role=alert]').textContent"), /could not save/);
  await evaluate("Storage.prototype.setItem = window.originalStorageSetItem");
  await reload();
  await wait("document.documentElement.dataset.sgDensity === 'comfortable'");
  await evaluate("localStorage.setItem('sentinelgrid-interface','broken')");
  await reload();
  assert.match(await evaluate("document.querySelector('[role=alert]').textContent"), /could not restore/);
  await choose("density", "compact");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('sentinelgrid-interface')).density"), "compact");
  await evaluate("localStorage.removeItem('sentinelgrid-interface'); localStorage.setItem('sentinelgrid-organization-clients-view','grid')");
  await reload();
  await wait("!!document.querySelector('.sg-client-grid')");
  assert.deepEqual(await evaluate("window.appearanceHydrationErrors"), []);
  console.log("Interface density, motion/OS changes, remembered sidebar, client defaults/search, modal keyboard/backdrop/resize, themed portal states, storage migration/failures and cross-tab preferences passed.");
}
