import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), loaded, loaded.exports);
  return loaded.exports;
}

const accessCore = {
  accessHasPermission: (access, permission) => access.permissions.includes(permission),
  accessHasFeature: (access, feature) => access.features.includes(feature),
};
const remoteAccess = load("../lib/remote-feature-access.ts", { "./organization-access-core": accessCore });
const errors = load("../lib/remote-feature-errors.ts");

function access({ permissions = ["devices.actions", "devices.terminal", "devices.rdp", "billing.manage"], features = ["deviceActions", "terminal", "rdp"], status = "active" } = {}) {
  return { permissions, features, subscription: { status } };
}

test("remote feature access distinguishes role, entitlement, and subscription states", () => {
  assert.deepEqual(remoteAccess.getRemoteFeatureAccess(access(), "devices.terminal", "terminal"), {
    state: "allowed", canUse: true, canManageBilling: true,
  });
  assert.deepEqual(remoteAccess.getRemoteFeatureAccess(access({ permissions: [] }), "devices.terminal", "terminal"), {
    state: "permission_denied", canUse: false, canManageBilling: false,
  });
  assert.deepEqual(remoteAccess.getRemoteFeatureAccess(access({ features: [] }), "devices.terminal", "terminal"), {
    state: "upgrade_required", canUse: false, canManageBilling: true,
  });
  assert.deepEqual(remoteAccess.getRemoteFeatureAccess(access({ status: "restricted" }), "devices.terminal", "terminal"), {
    state: "subscription_restricted", canUse: false, canManageBilling: true,
  });
  assert.deepEqual(remoteAccess.getRemoteFeatureAccess(access({ status: "canceled", permissions: ["devices.rdp"] }), "devices.rdp", "rdp"), {
    state: "subscription_restricted", canUse: false, canManageBilling: false,
  });
});

test("remote errors are presented without raw backend codes", () => {
  for (const [code, message] of Object.entries({
    RDP_SERVICE_FAILED: "Remote Desktop is temporarily unavailable.",
    RDP_NOT_CONFIGURED: "Remote Desktop is not configured for this environment.",
    DEVICE_OFFLINE: "This device is offline.",
    RDP_DISABLED: "Remote Desktop is disabled by organization policy.",
    RDP_UNSUPPORTED: "This device does not support Remote Desktop.",
    SESSION_LIMIT_REACHED: "The Remote Desktop session limit has been reached.",
    RATE_LIMITED: "Too many requests. Try again shortly.",
  })) {
    assert.equal(errors.remoteErrorMessage(code, "Fallback"), message);
    assert.notEqual(errors.remoteErrorMessage(code, "Fallback"), code);
  }
  assert.equal(errors.remoteErrorMessage("UNKNOWN", "Fallback"), "Fallback");
});
