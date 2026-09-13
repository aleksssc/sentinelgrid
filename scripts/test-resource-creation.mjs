import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), module, module.exports);
  return module.exports;
}
const plans = load("../lib/plans.ts");
function access(plan, status = "active", role = "owner", customLimits = {}) { return { role, subscription: { plan, status, customLimits } }; }
const core = {
  getOrganizationAccessForUser: async (_organizationId, userId) => access("pro", "active", userId === "member" ? "member" : "owner"),
  accessHasPermission: (value, permission) => value.role !== "member" && ["clients.create", "devices.create"].includes(permission),
  getAccountSubscriptionForOwner: async () => ({ plan: "free", status: "active", customLimits: {} }),
};
const creation = load("../lib/resource-creation.ts", { "./organization-access": core, "./plans": plans });

for (const [resource, cases] of Object.entries({
  clients: [["free", 0, true], ["free", 2, true], ["free", 3, false], ["free", 10, false], ["pro", 24, true], ["pro", 25, false]],
  devices: [["free", 9, true], ["free", 10, false], ["pro", 99, true], ["pro", 100, false]],
  monitors: [["free", 9, true], ["free", 10, false], ["pro", 99, true], ["pro", 100, false]],
})) {
  test(`${resource} plan limits permit only usage below the limit`, () => {
    for (const [plan, usage, permitted] of cases) {
      assert.equal(plans.canCreateResource({ plan, resource, currentUsage: usage }), permitted, `${plan} ${usage}`);
    }
  });
}
test("restricted subscriptions and members cannot create organization resources", async () => {
  assert.equal(plans.canCreateResource({ plan: "pro", resource: "devices", currentUsage: 0, subscriptionStatus: "restricted" }), false);
  const db = { from() { const query = { select() { return query; }, eq() { return query; }, in() { return query; }, then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); } }; return query; } };
  const member = await creation.getOrganizationResourceCreationAccess(db, "org", "member", "devices");
  assert.equal(member.reason, "permission_denied");
});
test("enterprise custom device limits honor finite and unlimited values", () => {
  assert.equal(plans.canCreateResource({ plan: "enterprise", resource: "devices", currentUsage: 249, customLimits: { devices: 250 } }), true);
  assert.equal(plans.canCreateResource({ plan: "enterprise", resource: "devices", currentUsage: 250, customLimits: { devices: 250 } }), false);
  assert.equal(plans.canCreateResource({ plan: "enterprise", resource: "devices", currentUsage: 1000, customLimits: { devices: null } }), true);
});
