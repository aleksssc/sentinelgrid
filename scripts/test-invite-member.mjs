import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { dashboardLoader } from "./dashboard-test-loader.mjs";

const source = readFileSync("components\\organization\\invite-member-button.tsx", "utf8");
function renderInvite(open, pending = false) {
  const load = dashboardLoader({
    react: { ...React, useState: () => [open, () => {}] },
    "react-dom": { useFormStatus: () => ({ pending }) },
  });
  const { InviteMemberButton } = load("components\\organization\\invite-member-button.tsx");
  return renderToStaticMarkup(React.createElement(InviteMemberButton, {
    organizationId: "org-fixture",
    action() {},
  }));
}

test("invitation uses shared theme-aware surfaces, controls and typography", () => {
  const html = renderInvite(true);
  for (const name of ["sg-surface", "sg-dialog", "sg-panel-header", "sg-section-icon", "sg-section-title", "sg-section-description", "sg-panel-body", "sg-control", "sg-button-secondary", "sg-button-primary"]) {
    assert.ok(html.includes(name), name);
  }
  assert.match(html, /text-\[var\(--sg-accent-text\)\]/);
  assert.doesNotMatch(source, /(?:text|bg|border)-(?:violet|blue|green|zinc)-|#[0-9a-f]{3,8}\b/i);
  assert.match(html, /lucide-chevron-down/);
});

test("invitation retains form fields, role values, validation and pending feedback", () => {
  const html = renderInvite(true);
  assert.match(html, /name="organization_id" value="org-fixture"/);
  const email = html.match(/<input\b[^>]*name="email"[^>]*>/)?.[0];
  assert.ok(email);
  assert.match(email, /type="email"/);
  assert.match(email, /required=""/);
  assert.match(email, /autoComplete="email"/);
  assert.match(html, /<option value="member" selected="">Member<\/option>/);
  assert.match(html, /<option value="admin">Admin<\/option>/);
  assert.equal((html.match(/<option /g) ?? []).length, 2);
  assert.match(source, /<form action=\{action\}>/);
  const pending = renderInvite(true, true);
  assert.match(pending, /disabled="" aria-busy="true"/);
  assert.match(pending, /Sending\.\.\./);
});

test("modal is labelled, restores focus and uses the browser modal focus trap", () => {
  const html = renderInvite(true);
  assert.match(html, /<dialog[^>]*aria-labelledby="[^"]+-title"[^>]*aria-describedby="[^"]+-description"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-describedby="[^"]+-role-description"/);
  assert.match(source, /showModal\(\)/);
  assert.match(source, /onCancel=\{\(\) => setOpen\(false\)\}/);
  assert.match(source, /trigger\.current\?\.focus\(\)/);
  assert.match(source, /event\.target !== event\.currentTarget/);
  assert.match(source, /getBoundingClientRect\(\)/);
  assert.doesNotMatch(renderInvite(false), /name="email"/);
});

test("entry animation compiles and existing motion rules cover the modal", async () => {
  const result = await postcss([tailwindcss({
    content: [{ raw: source, extension: "tsx" }],
    plugins: [(await import("tailwindcss-animate")).default],
  })]).process("@tailwind utilities;", { from: undefined });
  assert.match(result.css, /animation-duration: (?:200ms|\.2s|0\.2s)/);
  assert.match(result.css, /width: calc\(100% - 2rem\)/);
  assert.match(result.css, /::backdrop/);
  assert.match(readFileSync("app\\dashboard\\dashboard-interface.css", "utf8"), /data-sg-motion="reduced"[^]*animation-duration: 0\.01ms/);
  assert.match(readFileSync("app\\dashboard\\dashboard-design.css", "utf8"), /prefers-reduced-motion: reduce/);
});
