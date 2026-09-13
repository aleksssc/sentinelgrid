import assert from "node:assert/strict";

export async function checkDeviceMobile({ evaluate, command, origin }) {
  async function wait(expression) {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Device check timed out: ${expression} at ${await evaluate("innerWidth + 'x' + innerHeight")}`);
  }
  async function tap(selector) {
    const point = await evaluate(`(() => {
      const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('Missing touch target');
      const r = e.getBoundingClientRect();
      const x = r.x+r.width/2, y = r.y+r.height/2;
      if (!e.contains(document.elementFromPoint(x,y))) throw new Error('Touch target obscured: ' + ${JSON.stringify(selector)} + ' at ' + innerWidth + 'x' + innerHeight);
      return {x,y};
    })()`);
    await command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, radiusX: 2, radiusY: 2 }] });
    await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  async function fits(selector, viewportHeight) {
    const box = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const r = e.getBoundingClientRect(); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, height:r.height, width:e.clientWidth, scroll:e.scrollWidth, viewport:innerWidth, viewportHeight:innerHeight}; })()`);
    assert.ok(box.left >= -1 && box.top >= -1 && box.right <= box.viewport + 1 && box.bottom <= (viewportHeight ?? box.viewportHeight) + 1, `${selector} stays visible: ${JSON.stringify(box)}`);
    assert.ok(box.width > 0 && box.height > 0, `${selector} must not be hidden`);
    assert.ok(box.scroll <= box.width + 1, `${selector} has no horizontal overflow: ${JSON.stringify(box)}`);
  }
  async function escape() {
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  try {
    for (const [width, height] of [[320,568], [375,667], [390,844], [430,932], [844,390], [768,1024], [1440,900]]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 1024 });
      await command("Page.navigate", { url: `${origin}/mobile-device` });
      await wait("location.pathname === '/mobile-device' && !!document.querySelector('.sg-row')");
      await tap(".sg-row");
      await wait("!!document.querySelector('.sg-drawer') && getComputedStyle(document.querySelector('.sg-drawer')).transform === 'matrix(1, 0, 0, 1, 0, 0)'");
      await fits(".sg-drawer");
      await fits('button[aria-label="Close device details"]');
      await fits('input[aria-label="Remote Desktop session reason"]');
      await tap('.sg-device-toolbar button[aria-haspopup="menu"]');
      await wait("!!document.querySelector('.sg-device-actions-menu [role=menuitem]')");
      await new Promise(resolve => setTimeout(resolve, 250));
      await fits(".sg-device-actions-menu");
      assert.equal(await evaluate("!!document.querySelector('.sg-device-actions-menu').closest('.sg-drawer')"), false, "Menu escapes drawer clipping/transform");
      await evaluate("document.querySelector('.sg-device-actions-menu [role=menuitem]:last-child').scrollIntoView({block:'nearest'})");
      await fits(".sg-device-actions-menu");
      await escape();
      await wait("!document.querySelector('.sg-device-actions-menu')");
      assert.equal(await evaluate("document.activeElement.matches('.sg-device-toolbar button[aria-haspopup=menu]')"), true, "Escape restores the Actions trigger");
      await tap('.sg-device-toolbar button[aria-haspopup="menu"]');
      await wait("!!document.querySelector('.sg-device-actions-menu')");
      await command('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:width/2,y:4}]});
      await command('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
      await wait("!document.querySelector('.sg-device-actions-menu')");
      for (const tab of ["Overview", "Performance", "Inventory", "Software", "Services", "Security", "Activity"]) {
        await evaluate(`Array.from(document.querySelectorAll('.sg-tab')).find(e => e.textContent === ${JSON.stringify(tab)}).click()`);
        await fits(".sg-drawer");
      }
      await evaluate("document.querySelector('.sg-drawer').scrollTop = 0");
      await tap('.sg-device-toolbar .sg-button-primary');
      await wait("!!document.querySelector('.sg-viewport-dialog:modal') && !document.querySelector('[data-terminal-input]').disabled");
      await new Promise(resolve => setTimeout(resolve, 250));
      await fits(".sg-terminal-panel");
      await fits('.sg-terminal-close');
      await fits('[data-terminal-input]');
      await fits('.sg-terminal-shell');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.sg-viewport-dialog'),'::backdrop').backdropFilter"), "none");
      if (width < 1024) assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('[data-terminal-input]')).fontSize) >= 16"), "Input does not trigger Safari focus zoom");
      await evaluate("window.fixtureSockets.at(-1).message({type:'command_result',stdout:('long-output-'.repeat(90)+'\\n').repeat(70),exit_code:0})");
      await fits('.sg-terminal-close');
      await fits('.sg-terminal-output');
      await evaluate("document.querySelector('[data-terminal-input]').focus()");
      await command("Input.insertText", { text: "echo fixture" });
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await wait("document.querySelector('[data-terminal-input]').disabled && window.fixtureCommands.length === 1");
      // CDP does not emulate an iOS keyboard: exercise its separate visual-viewport events explicitly.
      if (width < 640) {
        await evaluate(`window.fixtureViewport = { height:Object.getOwnPropertyDescriptor(visualViewport,'height'), offsetTop:Object.getOwnPropertyDescriptor(visualViewport,'offsetTop') }; Object.defineProperty(visualViewport,'height',{configurable:true,value:300}); Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:40}); visualViewport.dispatchEvent(new Event('resize')); visualViewport.dispatchEvent(new Event('scroll'));`);
        const bounds = await evaluate("(() => { const r = document.querySelector('.sg-terminal-panel').getBoundingClientRect(); return {top:r.top,bottom:r.bottom}; })()");
        assert.ok(bounds.top >= 40 && bounds.bottom <= 340, `Terminal follows panned/shrunken visual viewport: ${JSON.stringify(bounds)}`);
        await fits('.sg-terminal-close', 340);
        await fits('[data-terminal-input]', 340);
        await tap('.sg-terminal-close');
        await wait("!document.querySelector('.sg-viewport-dialog')");
        await evaluate("for (const [name,descriptor] of Object.entries(window.fixtureViewport)) { if (descriptor) Object.defineProperty(visualViewport,name,descriptor); else delete visualViewport[name]; } visualViewport.dispatchEvent(new Event('resize'));");
      } else {
        await tap('.sg-terminal-close');
        await wait("!document.querySelector('.sg-viewport-dialog')");
      }
      assert.equal(await evaluate("document.activeElement.matches('.sg-device-toolbar .sg-button-primary')"), true, "Closing restores focus to Terminal");
      assert.equal(await evaluate("window.fixtureSockets.at(-1).readyState"), 3, "Touch close uses existing disconnect lifecycle");
      await tap('.sg-device-toolbar .sg-button-primary');
      await wait("!!document.querySelector('.sg-viewport-dialog:modal')");
      await escape();
      await wait("!document.querySelector('.sg-viewport-dialog')");
      await tap('.sg-device-toolbar .sg-button-primary');
      await wait("!!document.querySelector('.sg-viewport-dialog:modal')");
      for (let i = 0; i < 6; i++) {
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        assert.equal(await evaluate("document.querySelector('.sg-viewport-dialog').contains(document.activeElement) || document.activeElement === document.body"), true, "Native modal prevents keyboard focus on background controls");
      }
      assert.equal(await evaluate("document.elementFromPoint(3,3) === document.querySelector('.sg-viewport-dialog')"), true);
      await command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{x:3,y:3}] });
      await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await wait("!document.querySelector('.sg-viewport-dialog')");
      await tap('button[aria-label="Close device details"]');
      await wait("!document.querySelector('.sg-drawer')");
      await tap('.sg-row');
      await wait("!!document.querySelector('.sg-drawer') && getComputedStyle(document.querySelector('.sg-drawer')).transform === 'matrix(1, 0, 0, 1, 0, 0)'");
      assert.equal(await evaluate("document.querySelectorAll(':modal').length"), 0, "No inert modal left behind");
    }
    await command("Emulation.setDeviceMetricsOverride", { width:390, height:844, deviceScaleFactor:1, mobile:true });
    await evaluate("document.documentElement.dataset.sgMotion = 'reduced'; document.querySelector('.sg-drawer').scrollTop = 0");
    await tap('.sg-device-toolbar .sg-button-primary');
    await wait("!!document.querySelector('.sg-viewport-dialog:modal')");
    assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('.sg-terminal-panel')).animationDuration) < 0.001"));
    await tap('.sg-terminal-close');
    await wait("!document.querySelector('.sg-viewport-dialog')");
  } finally {
    await command("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
  console.log("Device touch checks passed: 7 phone/landscape/tablet/desktop viewports, all sections, Actions collisions/scroll/dismissal, terminal close/reopen/focus/disconnect, long output, reduced motion and simulated iOS visual viewport events.");
}
