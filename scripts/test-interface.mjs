import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dashboardLoader } from "./dashboard-test-loader.mjs";

const { DEFAULT_INTERFACE, INTERFACE_STORAGE_KEY, parseInterfacePreferences, persistInterfacePreferences } = dashboardLoader()("lib\\appearance.ts");

test("interface preferences migrate the previous client view without overriding a saved default", () => {
  assert.deepEqual(parseInterfacePreferences(null), DEFAULT_INTERFACE);
  assert.equal(parseInterfacePreferences(null, "grid").defaultView, "grid");
  assert.equal(parseInterfacePreferences(JSON.stringify({ defaultView: "list" }), "grid").defaultView, "list");
});

test("all interface settings and remembered sidebar state round-trip without sharing the theme key", () => {
  const values = new Map();
  const preferences = { density: "compact", motion: "reduced", sidebar: "remember", defaultView: "grid", sidebarExpanded: false };
  persistInterfacePreferences({ setItem: (key, value) => values.set(key, value) }, preferences);
  assert.deepEqual(parseInterfacePreferences(values.get(INTERFACE_STORAGE_KEY)), preferences);
  assert.equal(values.size, 1);
  assert.throws(() => persistInterfacePreferences({ setItem() { throw new Error("Blocked"); } }, preferences), /Blocked/);
});

test("malformed storage is reported and unknown fields cannot inject preference values", () => {
  for (const value of ["broken", "null", "[]", '"compact"']) assert.throws(() => parseInterfacePreferences(value));
  assert.deepEqual(parseInterfacePreferences(JSON.stringify({ density: "giant", motion: "fast", sidebar: "off", defaultView: "table", sidebarExpanded: "false" })), DEFAULT_INTERFACE);
});

test("organization directory removes metric cards, keeps permissions and uses compact semantic summary", () => {
  const page = readFileSync("app\\dashboard\\organizations\\[id]\\page.tsx", "utf8");
  assert.doesNotMatch(page, /StatCard/);
  assert.match(page, /<CompactSummary label="Organization infrastructure summary"/);
  assert.match(page, /canManageOrganization && <Link/);
  assert.match(page, /canManageInfrastructure && <Link/);
  assert.match(page, /<RoleBadge/);
  const directory = readFileSync("app\\dashboard\\organizations\\[id]\\organization-clients.tsx", "utf8");
  assert.doesNotMatch(directory, /localStorage|min-h-56/);
  assert.match(directory, /useAppearance/);
  assert.match(directory, /<StatusBadge status={client.status}/);
});

test("appearance removes explanatory placeholders and scopes portal interaction tokens", () => {
  const settings = readFileSync("components\\dashboard\\appearance-settings.tsx", "utf8");
  assert.doesNotMatch(settings, /Instant preview|A new look, the same signals|localStorage|useTheme/);
  for (const name of ["density", "motion", "sidebar", "defaultView"]) assert.ok(settings.includes(`name="${name}"`));
  const css = readFileSync("app\\dashboard\\dashboard-interface.css", "utf8");
  assert.match(css, /sg-themed-portal/);
  assert.match(css, /data-sg-density="compact"/);
  assert.match(css, /data-sg-motion="reduced"/);
  assert.doesNotMatch(css, /scale\(/);
});
