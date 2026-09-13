import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dashboardLoader } from "./dashboard-test-loader.mjs";
import { renderDashboardFixtures } from "./dashboard-ui-fixtures.mjs";

const load = dashboardLoader();
const { StatusBadge, RoleBadge } = load("components\\dashboard\\dashboard-badges.tsx");
const fixtures = await renderDashboardFixtures();

test("Organization and Client share compact headers, summaries and content panels", () => {
  for (const name of ["organization", "clients"]) {
    const html = fixtures[name];
    assert.match(html, /class="sg-organization-header"/);
    assert.match(html, /class="sg-compact-summary"/);
    assert.match(html, /sg-surface sg-clients-panel/);
    assert.doesNotMatch(html, /sg-stat(?: |")/);
    const summary = html.match(/<dl[^>]+class="sg-compact-summary">(.*?)<\/dl>/s)[1];
    assert.equal((summary.match(/<dt>/g) ?? []).length, name === "organization" ? 3 : 4);
    assert.equal((summary.match(/<dd /g) ?? []).length, name === "organization" ? 3 : 4);
  }
});

test("roles remain neutral and equivalent operational states use the same badge and dot", () => {
  for (const role of ["owner", "admin", "member"]) {
    const html = renderToStaticMarkup(React.createElement(RoleBadge, { role }));
    assert.match(html, /sg-badge sg-role-badge/);
    assert.match(html, /data-tone="neutral"/);
    assert.doesNotMatch(html, /sg-badge-dot/);
  }
  for (const status of ["active", "online", "connected", "healthy", "success"]) {
    const html = renderToStaticMarkup(React.createElement(StatusBadge, { status }));
    assert.match(html, /data-tone="success"/);
    assert.equal((html.match(/sg-badge-dot/g) ?? []).length, 1);
  }
  for (const [status, tone] of [["offline", "neutral"], ["warning", "warning"], ["failed", "danger"]]) {
    assert.match(renderToStaticMarkup(React.createElement(StatusBadge, { status })), new RegExp(`data-tone="${tone}"`));
  }
  for (const name of ["clients", "drawer-overview", "monitors", "dashboard"]) assert.match(fixtures[name], /sg-status-badge/);
  assert.match(fixtures.organization, /sg-role-badge/);
  assert.match(fixtures.settings, /sg-role-badge/);
});

test("both directory loading boundaries preserve the compact shape", () => {
  for (const file of ["app\\dashboard\\organizations\\[id]\\loading.tsx", "app\\dashboard\\organizations\\[id]\\clients\\[clientId]\\loading.tsx"]) {
    const html = renderToStaticMarkup(React.createElement(load(file).default));
    assert.match(html, /sg-compact-summary/);
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /sg-stat|xl:grid-cols-4/);
  }
});

test("Sentinel navigation is blue; semantic tokens and sliding markers are independent", () => {
  const themes = readFileSync("app\\dashboard\\dashboard-themes.css", "utf8");
  assert.match(themes, /--sg-accent: #60a5fa/);
  assert.match(themes, /--sg-accent-text: #93c5fd/);
  assert.doesNotMatch(readFileSync("components\\dashboard\\devices\\device-tabs.tsx", "utf8"), /emerald/);
  const css = readFileSync("app\\dashboard\\dashboard-interface.css", "utf8");
  assert.match(css, /\.sg-sidebar-item\[data-active\]::before/);
  assert.match(css, /left: calc\(-1 \* var\(--sg-sidebar-gutter\)\)/);
  assert.match(css, /transition: transform 200ms/);
  assert.doesNotMatch(css, /box-shadow: inset/);
});
