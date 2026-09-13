import assert from "node:assert/strict";

export async function checkControls({ evaluate, wait, choose, move, key, command, selectedTheme, tokenColor }) {
  await choose("motion", "full");
  await choose("density", "comfortable");
  // Rendered from the real Terminal, with only its disabled input enabled in this network-free fixture.
  await evaluate("document.querySelector('[data-terminal-input]').disabled = false");
  const fields = [
    ['input[aria-label="Search infrastructure"]', ".sg-input-frame"],
    ['input[aria-label="Shared input"]', null],
    ['textarea[aria-label="Shared textarea"]', null],
    ['input[aria-label="Search clients"]', null],
    ["[data-terminal-input]", ".sg-input-frame"],
  ];
  async function fieldStyle(selector, frame) {
    return evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const field = ${frame ? `input.closest(${JSON.stringify(frame)})` : "input"};
      const s = getComputedStyle(field), inner = getComputedStyle(input), r = field.getBoundingClientRect();
      const color = document.createElement('i'); color.style.color = 'var(--sg-field-ring)'; field.parentElement.append(color);
      color.style.setProperty('--sg-field-ring', s.getPropertyValue('--sg-field-ring'));
      const ring = getComputedStyle(color).color; color.remove();
      return { width:r.width, height:r.height, border:s.borderWidth, color:s.borderColor, background:s.backgroundColor,
        outline:s.outlineStyle, shadow:s.boxShadow, ring, innerOutline:inner.outlineStyle, innerShadow:inner.boxShadow,
        focus:document.activeElement === input, visible:input.matches(':focus-visible') };
    })()`);
  }
  const transparent = "rgba(0, 0, 0, 0)";
  for (const theme of ["sentinel", "midnight", "aurora", "graphite"]) {
    await evaluate(`document.querySelector('input[name=appearance-theme][value=${theme}]').click()`);
    await selectedTheme(theme);
    const accentText = await tokenColor("--sg-accent-text");
    const edge = await tokenColor("--sg-accent-edge");
    const activeTab = '.sg-tab[aria-pressed="true"]';
    await move(activeTab, true);
    await wait(`getComputedStyle(document.querySelector('${activeTab}')).backgroundColor === '${transparent}'`);
    const tab = await evaluate(`(() => { const s = getComputedStyle(document.querySelector('${activeTab}')); return { background:s.backgroundColor, color:s.color, border:s.borderColor, shadow:s.boxShadow, outline:s.outlineStyle }; })()`);
    assert.equal(tab.background, transparent, `${theme}: selected tabs remain transparent while hovered/clicked`);
    assert.equal(tab.color, accentText);
    assert.equal(tab.shadow, "none");
    assert.equal(tab.outline, "none", "Clicking tabs does not leave a keyboard ring");
    assert.equal(tab.border, transparent);

    const groups = await evaluate(`Array.from(document.querySelectorAll('.sg-preference-options')).map(group => {
      const selected = group.querySelector('input:checked + span'), s = getComputedStyle(selected);
      return { height:group.getBoundingClientRect().height, optionHeight:selected.getBoundingClientRect().height,
        font:s.fontSize, weight:s.fontWeight, radius:s.borderRadius, padding:s.padding, border:s.borderWidth,
        background:s.backgroundColor, color:s.color, markers:group.querySelectorAll('.sg-selection-indicator').length };
    })`);
    assert.equal(groups.length, 4);
    for (const group of groups) {
      assert.deepEqual(group, groups[0], `${theme}: all four settings use the same selected geometry and styling`);
      assert.equal(group.height, 40);
      assert.equal(group.background, transparent);
      assert.equal(group.border, "0px", "No inner border on preference options");
      assert.equal(group.markers, 1, "Exactly one selection marker");
      assert.equal(group.color, accentText);
    }
    const choice = '.sg-preference-option:has(input[name="interface-defaultView"]:checked)';
    await move(choice, true);
    await wait(`getComputedStyle(document.querySelector('${choice} > span')).backgroundColor === '${transparent}'`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('${choice} > span')).outlineStyle`), "none");

    for (const [selector, frame] of fields) {
      await evaluate("document.activeElement.blur()");
      const normal = await fieldStyle(selector, frame);
      await move(selector, true);
      await wait("document.documentElement.dataset.sgInputModality === 'pointer'");
      await wait(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})${frame ? `.closest('${frame}')` : ""}).boxShadow === 'none'`);
      await wait(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})${frame ? `.closest('${frame}')` : ""}).borderColor === ${JSON.stringify(edge)}`);
      const mouse = await fieldStyle(selector, frame);
      assert.ok(mouse.focus, `${selector}: real pointer focuses the input`);
      assert.equal(mouse.outline, "none");
      assert.equal(mouse.innerOutline, "none");
      assert.equal(mouse.shadow, "none", `${selector}: mouse focus is border-only`);
      assert.equal(mouse.color, edge, `${theme}: field uses the theme accent border`);
      assert.equal(mouse.width, normal.width);
      assert.equal(mouse.height, normal.height);
      assert.equal(mouse.border, normal.border);
      assert.equal(mouse.background, normal.background, "Focus preserves the dark surface");

      await key("Tab");
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await wait("document.documentElement.dataset.sgInputModality === 'keyboard'");
      await wait(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})${frame ? `.closest('${frame}')` : ""}).boxShadow.includes('0px 0px 0px 2px')`);
      const expectedRing = (await fieldStyle(selector, frame)).ring;
      await wait(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})${frame ? `.closest('${frame}')` : ""}).boxShadow.includes(${JSON.stringify(expectedRing)})`, `${theme} ${selector}: keyboard ring reaches the theme color`);
      const keyboard = await fieldStyle(selector, frame);
      assert.ok(keyboard.focus && keyboard.visible, `${selector}: keyboard navigation returns visible focus`);
      assert.ok(keyboard.shadow.includes(keyboard.ring), `${theme}: keyboard ring uses the theme token`);
      assert.equal(keyboard.outline, "none");
      assert.equal(keyboard.innerOutline, "none");
      if (frame) assert.equal(keyboard.innerShadow, "none", "Composite field must not have a second inner ring");
      assert.equal(keyboard.width, normal.width);
      assert.equal(keyboard.height, normal.height);
      assert.equal(keyboard.border, normal.border);
      await move(selector, true);
      await wait(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})${frame ? `.closest('${frame}')` : ""}).boxShadow === 'none'`, "Pointer removes the ring even on an already focused text input");
    }
  }

  await choose("defaultView", "list");
  await move('.sg-preference-option:has(input[name="interface-defaultView"][value="list"])');
  await wait("document.querySelector('input[name=interface-defaultView]:checked').value === 'list'");
  const markerX = "new DOMMatrix(getComputedStyle(document.querySelector('.sg-preference-options:has(input[name=interface-defaultView]) .sg-selection-indicator')).transform).m41";
  await wait(`${markerX} === document.querySelector('.sg-preference-option:has(input[name=interface-defaultView]:checked)').offsetLeft`);
  const before = await evaluate(markerX);
  await choose("defaultView", "grid");
  const moving = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ x:${markerX}, target:document.querySelector('.sg-preference-option:has(input[name=interface-defaultView]:checked)').offsetLeft }))))`);
  assert.ok(moving.x > before && moving.x < moving.target, "Settings underline slides instead of swapping filled buttons");
  await wait(`Math.abs(${markerX} - document.querySelector('.sg-preference-option:has(input[name=interface-defaultView]:checked)').offsetLeft) < 0.1`);
  for (const density of ["comfortable", "compact"]) {
    await choose("density", density);
    const heights = await evaluate("Array.from(document.querySelectorAll('.sg-preference-options')).map(e => e.getBoundingClientRect().height)");
    assert.ok(heights.every(h => h === (density === "compact" ? 36 : 40)), `${density}: all preference controls have equal height`);
  }
  for (const [motion, os] of [["reduced", "no-preference"], ["system", "reduce"], ["full", "reduce"]]) {
    await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: os }] });
    await choose("motion", motion);
    const reduced = motion !== "full";
    await wait(`document.documentElement.dataset.sgMotion === '${reduced ? "reduced" : "full"}'`);
    const durations = await evaluate("Array.from(document.querySelectorAll('.sg-selection-indicator')).map(e => parseFloat(getComputedStyle(e).transitionDuration))");
    assert.ok(durations.every(d => reduced ? d < 0.001 : d >= 0.18 && d <= 0.25));
  }
  await command("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
  for (const [selector, frame] of fields) {
    await move(selector, true);
    const focused = await fieldStyle(selector, frame);
    assert.equal(focused.outline, "solid", `${selector}: high-contrast mode retains a visible focus fallback`);
    if (frame) assert.equal(focused.innerOutline, "none", "High contrast also avoids duplicate field outlines");
  }
  await command("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
  await choose("density", "comfortable");
  await choose("defaultView", "list");
  console.log("Shared field mouse/keyboard focus, stable dimensions, single-layer selection, all palettes/densities and motion/forced-color preferences passed.");
}
