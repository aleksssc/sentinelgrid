import assert from "node:assert/strict";

export async function checkRefinement({ evaluate, wait, choose, move }) {
  await choose("motion", "full");
  await choose("density", "comfortable");
  await choose("sidebar", "expanded");
  await wait("document.querySelector('.sg-desktop-sidebar').getBoundingClientRect().width === 224");
  const geometry = () => evaluate(`(() => {
    const group = document.querySelector('[aria-label="Device sections"]');
    const active = group.querySelector('[aria-pressed="true"]');
    const marker = group.querySelector('.sg-selection-indicator');
    const style = getComputedStyle(marker);
    const matrix = new DOMMatrix(style.transform);
    return { x: matrix.m41, y: matrix.m42, target: active.offsetLeft, targetY: active.offsetTop + active.offsetHeight - 2,
      width: parseFloat(style.width), targetWidth: active.offsetWidth, duration: parseFloat(style.transitionDuration),
      height: group.getBoundingClientRect().height };
  })()`);
  await move('[aria-label="Device sections"] button');
  const heights = await evaluate("['.sg-tabs', '[aria-label=\"Client view\"]', '.sg-control', '.sg-preference-options'].map(selector => document.querySelector(selector).getBoundingClientRect().height)");
  for (const height of heights) assert.equal(height, 40, "Tabs, view toggles, inputs and interface choices share a 40px control height");
  const before = await geometry();
  await evaluate(`document.querySelectorAll('[aria-label="Device sections"] button')[1].click()`);
  await wait(`document.querySelectorAll('[aria-label="Device sections"] button')[1].getAttribute('aria-pressed') === 'true'`);
  const during = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const group = document.querySelector('[aria-label="Device sections"]');
    const marker = group.querySelector('.sg-selection-indicator');
    const style = getComputedStyle(marker);
    resolve({ x: new DOMMatrix(style.transform).m41, target: group.querySelector('[aria-pressed="true"]').offsetLeft, duration: parseFloat(style.transitionDuration) });
  })))`);
  assert.ok(during.duration >= 0.18 && during.duration <= 0.25, "Sliding indicators use a 180-250ms transition");
  assert.ok(during.x > before.x && during.x < during.target, "The indicator visibly interpolates, not an instantaneous border swap");
  await wait(`(() => { const g = document.querySelector('[aria-label="Device sections"]'); return Math.abs(new DOMMatrix(getComputedStyle(g.querySelector('.sg-selection-indicator')).transform).m41 - g.querySelector('[aria-pressed="true"]').offsetLeft) < 0.1; })()`);
  const after = await geometry();
  assert.equal(after.height, before.height, "Changing sections never shifts the layout");
  assert.equal(after.width, after.targetWidth);
  assert.equal(after.y, after.targetY);
  await evaluate(`document.querySelectorAll('[aria-label="Device sections"] button')[2].click(); document.querySelectorAll('[aria-label="Device sections"] button')[0].click()`);
  await wait(`document.querySelectorAll('[aria-label="Device sections"] button')[0].getAttribute('aria-pressed') === 'true'`);
  await choose("motion", "reduced");
  await wait("document.documentElement.dataset.sgMotion === 'reduced'");
  await evaluate(`document.querySelectorAll('[aria-label="Device sections"] button')[2].click()`);
  await wait(`document.querySelectorAll('[aria-label="Device sections"] button')[2].getAttribute('aria-pressed') === 'true'`);
  assert.ok((await geometry()).duration < 0.001, "Reduced motion removes the sliding transition");
  await choose("motion", "full");

  const styles = await evaluate(`(() => {
    const badges = [...document.querySelectorAll('[data-fixture="badges"] .sg-badge')];
    const active = document.querySelector('.sg-desktop-sidebar .sg-sidebar-link[aria-current="page"]');
    const item = active.parentElement;
    const s = getComputedStyle(active), marker = getComputedStyle(item, '::before');
    return { badges: badges.map(b => { const s = getComputedStyle(b); return { height:b.getBoundingClientRect().height, radius:s.borderRadius, font:s.fontSize, padding:s.paddingInline, border:s.borderWidth, line:s.lineHeight }; }),
      dots: badges.filter(b => b.classList.contains('sg-status-badge')).every(b => b.querySelectorAll('.sg-badge-dot').length === 1),
      roleDots: badges.filter(b => b.classList.contains('sg-role-badge')).some(b => b.querySelector('.sg-badge-dot')),
      sidebar: { shadow:s.boxShadow, border:s.borderWidth, indicatorPosition:marker.position, indicatorWidth:marker.width,
        indicatorX:item.getBoundingClientRect().x + parseFloat(marker.left), edge:document.querySelector('.sg-desktop-sidebar').getBoundingClientRect().x,
        itemPadding:s.paddingLeft } };
  })()`);
  assert.equal(styles.badges.length, 8);
  for (const badge of styles.badges) assert.deepEqual(badge, styles.badges[0], "Roles and statuses share exactly the same geometry");
  assert.equal(styles.badges[0].height, 24);
  assert.equal(styles.badges[0].radius, "6px");
  assert.ok(styles.dots && !styles.roleDots);
  assert.equal(styles.sidebar.shadow, "none");
  assert.equal(styles.sidebar.border, "0px");
  assert.equal(styles.sidebar.indicatorPosition, "absolute");
  assert.equal(styles.sidebar.indicatorWidth, "2px");
  assert.ok(Math.abs(styles.sidebar.indicatorX - styles.sidebar.edge) <= 1, "Marker is at the sidebar edge, outside the link");
  await choose("sidebar", "compact");
  await wait("document.querySelector('.sg-desktop-sidebar').getBoundingClientRect().width === 64");
  const compactMarker = await evaluate(`(() => { const e = document.querySelector('.sg-desktop-sidebar .sg-sidebar-item[data-active]'); return e.getBoundingClientRect().x + parseFloat(getComputedStyle(e, '::before').left); })()`);
  assert.ok(Math.abs(compactMarker - styles.sidebar.edge) <= 1, "Marker remains at the edge in compact navigation");
  await choose("sidebar", "expanded");
  await wait("document.querySelector('.sg-desktop-sidebar').getBoundingClientRect().width === 224");
  console.log("Uniform badge geometry, external sidebar marker and real 200ms/reduced-motion indicator behavior passed.");
}
