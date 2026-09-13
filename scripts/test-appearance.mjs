import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";
import { dashboardLoader } from "./dashboard-test-loader.mjs";

const load = dashboardLoader();
const { APP_THEMES, APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, isAppTheme, persistAppearance } = load("lib\\appearance.ts");

test("four distinct themes retain Sentinel as the default and reject unknown values", () => {
  assert.equal(APP_THEMES.length, 4);
  assert.equal(new Set(APP_THEMES.map(({ id }) => id)).size, 4);
  assert.equal(DEFAULT_APPEARANCE, "sentinel");
  for (const { id } of APP_THEMES) assert.ok(isAppTheme(id));
  for (const value of [null, undefined, "", "system", "light", "<script>", {}]) assert.equal(isAppTheme(value), false);
});

test("saving uses its own browser key and reports storage failures to the caller", () => {
  const values = new Map([["theme", "dark"]]);
  const storage = { setItem: (key, value) => values.set(key, value) };
  for (const { id } of APP_THEMES) {
    persistAppearance(storage, id);
    assert.equal(values.get(APPEARANCE_STORAGE_KEY), id);
  }
  persistAppearance(storage, DEFAULT_APPEARANCE);
  assert.equal(values.get(APPEARANCE_STORAGE_KEY), "sentinel");
  assert.equal(values.get("theme"), "dark");
  assert.throws(() => persistAppearance({ setItem() { throw new Error("Storage blocked"); } }, "aurora"), /Storage blocked/);
});

test("SSR provides labelled native radios without assuming a client-only saved theme", () => {
  const { AppearanceProvider } = load("components\\dashboard\\appearance-provider.tsx");
  const Page = load("app\\dashboard\\settings\\page.tsx").default;
  const html = renderToString(React.createElement(AppearanceProvider, null, React.createElement(Page)));
  assert.equal((html.match(/name="appearance-theme"/g) ?? []).length, 4);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<legend class="sr-only">Application theme<\/legend>/);
  assert.match(html, /<fieldset disabled="" aria-busy="true">/);
  assert.doesNotMatch(html, /name="appearance-theme"[^>]* checked=""/);
  assert.equal((html.match(/name="interface-/g) ?? []).length, 10);
  for (const { id } of APP_THEMES) assert.match(html, new RegExp(`data-sg-preview="${id}"`));
  assert.match(html, /Reset to Sentinel/);
  assert.match(html, /data-sg-theme/);
  assert.match(html, /sentinelgrid-appearance/);
});

test("account menu exposes personal settings without replacing profile or billing", () => {
  const source = readFileSync("components\\user-menu.tsx", "utf8");
  for (const route of ["/dashboard/settings", "/dashboard/profile", "/dashboard/billing"]) assert.ok(source.includes(route));
  assert.match(source, /setOpen\(false\);\s*router.push\("\/dashboard\/settings"\)/);
});

test("themes share preview palettes and do not redefine operational status or chart colours", () => {
  const css = readFileSync("app\\dashboard\\dashboard-themes.css", "utf8");
  for (const { id } of APP_THEMES) assert.ok(css.includes(`[data-sg-preview="${id}"]`));
  for (const { id } of APP_THEMES.filter(({ id }) => id !== "sentinel")) assert.ok(css.includes(`html[data-sg-theme="${id}"] .sg-dashboard`));
  assert.doesNotMatch(css, /\.(text-(red|amber|emerald)|sg-badge|sg-danger)|--chart-/);
  assert.match(css, /graphite[^\n]+animation: none/);
  assert.match(css, /input:focus-visible \+ \.sg-theme-card/);
});
