import assert from "node:assert/strict";

export async function checkMobileNavigation({ evaluate, command, wait, choose }) {
  const drawer = "document.querySelector('.sg-mobile-navigation')";
  const trigger = "document.querySelector('.sg-mobile-menu-trigger')";
  async function tap(selector) {
    const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, radiusX: 2, radiusY: 2 }] });
    await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    for (const width of [390, 768]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 2, mobile: true });
      for (const sidebar of ["expanded", "compact", "remember"]) {
        await choose("sidebar", sidebar);
        await choose("motion", "full");
        for (let cycle = 0; cycle < 3; cycle++) {
          await tap(".sg-mobile-menu-trigger");
          await wait(`${drawer} && ${trigger}.getAttribute('aria-expanded') === 'true'`);
          const state = await evaluate(`(() => {
            const d = ${drawer};
            const background = document.querySelector('.dashboard-glow');
            return {
              role: d.getAttribute('role'),
              modal: d.getAttribute('aria-modal'),
              touchAction: getComputedStyle(d).touchAction,
              backgroundPaused: getComputedStyle(background).animationPlayState,
              sidebarAnimation: getComputedStyle(d.querySelector('aside')).animationName,
            };
          })()`);
          assert.deepEqual(state, { role: "dialog", modal: "true", touchAction: "manipulation", backgroundPaused: "paused", sidebarAnimation: "sg-navigation-enter" }, "Use a lightweight drawer rather than Safari's expensive native modal top layer");
          await wait(`${drawer}.querySelector('.sg-mobile-sidebar').getBoundingClientRect().x >= -1`);
          await tap('.sg-mobile-sidebar button[aria-label="Close navigation"]');
          await wait(`!${drawer} && ${trigger}.getAttribute('aria-expanded') === 'false'`);
          assert.equal(await evaluate("getComputedStyle(document.querySelector('.dashboard-glow')).animationPlayState"), "running", "Background motion resumes on dismissal");
          const nextDensity = cycle % 2 ? "comfortable" : "compact";
          await evaluate(`document.querySelector('input[name="interface-density"][value="${nextDensity}"] + span').scrollIntoView({block:'center'})`);
          await tap(`input[name="interface-density"][value="${nextDensity}"] + span`);
          await wait(`document.documentElement.dataset.sgDensity === '${nextDensity}'`, "Background controls must respond to touch after closing the menu");
        }
      }
    }
    await choose("motion", "reduced");
    await tap(".sg-mobile-menu-trigger");
    await wait(drawer);
    assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('.sg-mobile-sidebar')).animationDuration) < 0.001"), "Reduced motion also applies to the drawer panel");
    await tap('.sg-mobile-sidebar button[aria-label="Close navigation"]');
    await wait(`!${drawer}`);
  } finally {
    await command("Emulation.setTouchEmulationEnabled", { enabled: false });
    await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }
  console.log("Touch navigation opens and closes with a lightweight overlay across desktop preferences.");
}
