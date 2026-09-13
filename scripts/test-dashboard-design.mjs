import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dashboardLoader } from "./dashboard-test-loader.mjs";
import { renderDashboardFixtures, fixtureMocks } from "./dashboard-ui-fixtures.mjs";

const h = React.createElement;
const load = dashboardLoader(fixtureMocks());
const { PageHeader, SectionHeader, Surface, StatCard, EmptyState } = load("components\\dashboard\\dashboard-primitives.tsx");
const fixtures = await renderDashboardFixtures();

test("all primary pages share page width, heading hierarchy and opaque surfaces", () => {
  for (const name of ["dashboard", "clients", "monitors", "settings"]) {
    const html = fixtures[name];
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, name);
    assert.match(html, /class="sg-page"/, name);
    assert.match(html, /class="sg-(page|organization)-header"/, name);
    assert.match(html, /class="sg-page-title"/, name);
    assert.match(html, /sg-surface/, name);
    assert.doesNotMatch(html, /bg-\[#111113\]\/|bg-zinc-900\/70/, name);
    assert.doesNotMatch(html, /<main\b/, "The layout owns the main landmark");
  }
});

test("reusable headings support actions, wrapping and escaped user content", () => {
  const html = renderToStaticMarkup(h(PageHeader, { title: "<script>client</script>", description: "Infrastructure", actions: h("button", null, "Add device") }));
  assert.match(html, /&lt;script&gt;client&lt;\/script&gt;/);
  assert.match(html, /sg-page-actions/);
  assert.match(renderToStaticMarkup(h(SectionHeader, { title: "System", level: 3 })), /<h3/);
  assert.match(renderToStaticMarkup(h(Surface, { id: "general", className: "sg-danger" })), /id="general"/);
  assert.match(renderToStaticMarkup(h(StatCard, { value: 0, label: "Online", icon: h("span"), tone: "success" })), />0<\/p>/);
  assert.match(renderToStaticMarkup(h(EmptyState, { title: "No matches", description: "Clear filters", icon: h("span"), action: h("button", null, "Reset") })), />Reset<\/button>/);
});

test("monitor states retain unknown, failed and empty distinctions with labelled fields", () => {
  assert.match(fixtures.monitors, />Not checked<\/span>/);
  assert.match(fixtures.monitors, />Offline<\/span>/);
  assert.match(fixtures.monitors, />503 HTTP<\/p>/);
  assert.match(fixtures["monitors-empty"], /No monitors yet/);
  assert.match(fixtures.monitors, /for="monitor-name"/);
  assert.match(fixtures.monitors, /for="monitor-url"/);
  assert.match(fixtures.monitors, /Last recorded checks/);
  assert.doesNotMatch(fixtures.monitors, /Live status overview/);
});

test("settings keep form bindings, member roles, invitations and destructive confirmations", () => {
  const html = fixtures.settings;
  for (const id of ["general", "members", "danger-zone"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const name of ["organization_id", "name", "description", "member_id", "role", "invite_id"]) assert.match(html, new RegExp(`name="${name}"`));
  assert.match(html, /Role for Jordan Taylor/);
  for (const text of ["Save changes", "Invite member", "Update", "Remove", "Cancel invitation", "Delete organization"]) assert.ok(html.includes(text), text);
  assert.match(html, /sg-danger/);
  const deletion = readFileSync("components\\organization\\delete-organization-button.tsx", "utf8");
  assert.match(deletion, /confirmation\.trim\(\) === organizationName/);
  assert.match(deletion, /disabled=\{!canDelete \|\| deleting\}/);
});

test("submit controls preserve caller disabled state and expose pending feedback", () => {
  for (const pending of [false, true]) {
    const loadedModule = dashboardLoader({ "react-dom": { useFormStatus: () => ({ pending }) } })("components\\dashboard\\form-submit-button.tsx");
    const html = renderToStaticMarkup(h(loadedModule.FormSubmitButton, { pendingLabel: "Updating..." }, "Update"));
    assert.match(html, new RegExp(`aria-busy="${pending}"`));
    assert.equal(html.includes('disabled=""'), pending);
    assert.ok(html.includes(pending ? "Updating..." : ">Update</button>"));
    assert.match(renderToStaticMarkup(h(loadedModule.FormSubmitButton, { disabled: true }, "Update")), /disabled=""/);
  }
});

test("all device sections keep the same tabs, drawer shell and honest unavailable states", () => {
  for (const tab of ["overview", "inventory", "software", "services", "security", "activity"]) {
    const html = fixtures[`drawer-${tab}`];
    assert.match(html, /sg-drawer /, tab);
    assert.match(html, /aria-label="Close device details"/, tab);
    assert.equal((html.match(/class="sg-tab"/g) ?? []).length, 7, tab);
    assert.match(html, /aria-pressed="true"/, tab);
  }
  assert.match(fixtures["drawer-software"], /Software inventory is not available/);
  assert.match(fixtures["drawer-activity"], /No device activity yet/);
  assert.match(fixtures["drawer-overview"], /sg-drawer-metric/);
  assert.match(fixtures.performance, /sg-surface/);
  assert.equal((fixtures.performance.match(/<svg/g) ?? []).length, 6);
});

test("the dashboard layout owns scrolling; pages cannot introduce nested main landmarks", () => {
  const layout = readFileSync("app\\dashboard\\layout.tsx", "utf8");
  assert.match(layout, /<main id="dashboard-content"[^>]+overflow-y-auto/);
  assert.match(layout, /href="#dashboard-content"/);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  for (const file of walk("app\\dashboard").filter((file) => file.endsWith("page.tsx"))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /<main\b/, file);
  }
  assert.match(fixtures.loading, /aria-busy="true"/);
  assert.match(fixtures.loading, /role="status"/);
  assert.match(fixtures.loading, /motion-reduce:animate-none/);
});

test("surface tokens, focus, responsive gutters and reduced motion stay dashboard-scoped", () => {
  const css = readFileSync("app\\dashboard\\dashboard-design.css", "utf8");
  for (const color of ["#0d0f12", "#12151a", "#090b0e", "#252a32"]) assert.ok(css.includes(color));
  assert.match(css, /max-width: 1440px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /focus-visible/);
  assert.match(css, /\.sg-dashboard \.sg-control/);
  assert.doesNotMatch(css, /\[class[*^$]?=/, "No selectors coupled to Tailwind class-string fragments");
});
