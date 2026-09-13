import assert from "node:assert/strict";

export async function checkOnboarding({ command, evaluate, origin }) {
  const palettes = { sentinel: "rgb(10, 10, 12)", midnight: "rgb(6, 12, 24)", aurora: "rgb(12, 8, 20)", graphite: "rgb(11, 12, 13)" };
  for (const width of [320, 390, 768, 1440]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 600, deviceScaleFactor: 1, mobile: false });
    for (const mode of ["create", "join", "invite-setup"]) {
      await command("Page.navigate", { url: `${origin}/onboarding-${mode}` });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(`location.pathname === '/onboarding-${mode}' && document.readyState === 'complete' && !!document.querySelector('.sg-onboarding')`)) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
      for (const [theme, canvas] of Object.entries(palettes)) {
        const state = await evaluate(`(() => {
          document.documentElement.dataset.sgTheme = '${theme}';
          document.documentElement.dataset.sgMotion = 'full';
          const main = document.querySelector('main');
          const background = document.querySelector('.dashboard-grid');
          const content = document.querySelector('.sg-onboarding-content');
          return { canvas: getComputedStyle(main).backgroundColor,
            grid: getComputedStyle(background).animationName,
            pointerEvents: getComputedStyle(background.parentElement).pointerEvents,
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: document.documentElement.clientWidth,
            contentFits: content.scrollWidth <= content.clientWidth + 1,
            mainWidth: main.getBoundingClientRect().width,
            mainTop: main.getBoundingClientRect().top + scrollY,
            formCount: document.querySelectorAll('form').length };
        })()`);
        assert.equal(state.canvas, canvas, `${mode}/${theme}: theme canvas`);
        assert.equal(state.grid, theme === "graphite" ? "none" : "dashboard-grid-move");
        assert.equal(state.pointerEvents, "none");
        assert.ok(state.documentWidth <= width + 1, `${mode}/${width}: horizontal overflow`);
        assert.ok(state.contentFits, `${mode}/${width}: form overflow`);
        assert.equal(state.mainWidth, state.viewportWidth, `${mode}/${width}: full-bleed background`);
        assert.equal(state.mainTop, mode === "invite-setup" ? 65 : 0, `${mode}/${width}: header remains outside the background`);
        assert.ok(state.formCount > 0);
      }
      await evaluate("document.documentElement.dataset.sgTheme = 'sentinel'; document.documentElement.dataset.sgMotion = 'reduced'");
      const animations = () => evaluate("Array.from(document.querySelectorAll('.dashboard-grid, .dashboard-glow, .dashboard-scanline, .sg-onboarding-content')).map(el => getComputedStyle(el).animationName)");
      assert.ok((await animations()).every(name => name === "none"), `${mode}: explicit Reduced stops decoration`);
      await evaluate("delete document.documentElement.dataset.sgMotion");
      await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      assert.ok((await animations()).every(name => name === "none"), `${mode}: System respects OS before preferences hydrate`);
      await evaluate("document.documentElement.dataset.sgMotion = 'full'");
      assert.ok((await animations()).every(name => name !== "none"), `${mode}: Full allows animation`);
      const first = await evaluate("getComputedStyle(document.querySelector('.dashboard-grid')).backgroundPosition");
      await new Promise(resolve => setTimeout(resolve, 120));
      assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.dashboard-grid')).backgroundPosition"), first, `${mode}: grid actually moves`);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.sg-onboarding-content')).transform"), "none", "Pending fixed overlay must remain viewport-relative");
    }
  }
}
