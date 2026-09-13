import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { renderOnboardingFixtures } from "./onboarding-appearance-fixtures.mjs";

const fixtures = await renderOnboardingFixtures();

for (const [mode, html] of Object.entries(fixtures)) {
  test(`${mode}: onboarding reuses one decorative dashboard background and retains the form`, () => {
    assert.equal((html.match(/<main\b/g) ?? []).length, 1);
    assert.equal((html.match(/class="dashboard-grid /g) ?? []).length, 1);
    for (const layer of ["dashboard-glow-left", "dashboard-glow-right", "dashboard-scanline"]) assert.ok(html.includes(layer));
    assert.match(html, /aria-hidden="true" class="pointer-events-none absolute inset-0 z-0 overflow-hidden"/);
    assert.match(html, /sg-dashboard sg-onboarding/);
    assert.match(html, /sg-onboarding-content relative z-10/);
    assert.match(html, /<form\b/);
    assert.match(html, /type="submit"/);
    if (mode === "create") {
      assert.match(html, /Create your organization/);
      assert.match(html, /name="organization_name"/);
      assert.doesNotMatch(html, /name="invite_id"/);
    } else if (mode === "join") {
      assert.match(html, /Join organization/);
      assert.match(html, /Decline/);
      assert.equal((html.match(/name="invite_id" value="invite-1"/g) ?? []).length, 2);
    } else {
      assert.match(html, /Complete Account Setup/);
      assert.match(html, /id="password"/);
      assert.match(html, /id="confirmPassword"/);
      assert.match(html, /Back to home/);
    }
  });
}

test("onboarding shares saved palette and motion, with no transform containing block around fixed pending feedback", () => {
  const shell = readFileSync("components\\onboarding\\onboarding-shell.tsx", "utf8");
  const css = readFileSync("components\\onboarding\\onboarding-shell.css", "utf8");
  const background = readFileSync("app\\dashboard\\dashboard-background.css", "utf8");
  assert.match(shell, /dashboard-themes\.css/);
  assert.doesNotMatch(shell, /localStorage|AppearanceProvider/);
  assert.match(css, /240ms cubic-bezier/);
  assert.doesNotMatch(css, /transform|will-change/);
  for (const source of [css, background]) {
    assert.match(source, /html\[data-sg-motion="reduced"\][^{]+\{\s*animation: none;/);
    assert.match(source, /prefers-reduced-motion: reduce/);
    assert.match(source, /html:not\(\[data-sg-motion="full"\]\)/);
  }
});
