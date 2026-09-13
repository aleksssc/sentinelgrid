import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL("../components/dashboard/devices/remote-feature-gate.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", code)((name) => ({
  react: React,
  "next/link": ({ children, href, ...props }) => React.createElement("a", { ...props, href }, children),
  "@/components/ui/dropdown-menu": {
    DropdownMenu: ({ children }) => React.createElement("div", null, children),
    DropdownMenuTrigger: ({ children }) => children,
    DropdownMenuContent: ({ children }) => React.createElement("div", null, children),
  },
}[name] ?? require(name)), loaded, loaded.exports);
const { RemoteFeatureGate } = loaded.exports;
const button = React.createElement("button", null, "Feature");

function markup(state, canManageBilling = false) {
  return renderToStaticMarkup(React.createElement(RemoteFeatureGate, {
    feature: "Terminal", access: { state, canUse: state === "allowed", canManageBilling },
  }, button));
}

test("allowed remote features preserve their normal control", () => {
  assert.equal(markup("allowed"), "<button>Feature</button>");
});

test("gated remote controls distinguish permission, upgrade, and billing attention", () => {
  const permission = markup("permission_denied");
  assert.match(permission, /You don&#x27;t have permission to use Terminal\./);
  assert.doesNotMatch(permission, /Upgrade to Pro|Review billing/);

  const upgrade = markup("upgrade_required");
  assert.match(upgrade, /Terminal is available on Pro\./);
  assert.match(upgrade, /PRO/);
  assert.match(upgrade, /Upgrade to Pro/);
  assert.match(upgrade, /href="\/dashboard\/billing"/);

  const restrictedOwner = markup("subscription_restricted", true);
  assert.match(restrictedOwner, /subscription requires attention/);
  assert.match(restrictedOwner, /Review billing/);

  const restrictedAdmin = markup("subscription_restricted", false);
  assert.match(restrictedAdmin, /subscription requires attention/);
  assert.doesNotMatch(restrictedAdmin, /Review billing/);
});
