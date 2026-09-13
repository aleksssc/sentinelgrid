import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardLoader } from "./dashboard-test-loader.mjs";

function database(rows, userId = "owner") {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        maybeSingle() { return query; },
        then(resolve, reject) {
          const result = (rows[table] ?? []).find((row) => filters.every((filter) => filter(row))) ?? null;
          return Promise.resolve({ data: result, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function access({ userId, role, plan, status }) {
  return {
    organizationId: "organization",
    ownerId: "owner",
    userId,
    role,
    subscription: { userId: "owner", plan, status, customLimits: {} },
  };
}

function loadCommands(result) {
  const db = database({
    devices: [{ id: "device", client_id: "client" }],
    clients: [{ id: "client", organization_id: "organization" }],
    organizations: [{ id: "organization", owner_id: "owner" }],
  }, result?.userId ?? "owner");
  let accessLookups = 0;
  const load = dashboardLoader({
    "server-only": {},
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/organization-access": {
      getOrganizationAccessForUser: async () => { accessLookups += 1; return result; },
      accessHasPermission: (value, permission) => (value.role === "owner" || value.role === "admin") && permission === "devices.actions",
      accessHasFeature: (value, feature) => value.subscription.plan !== "free" && !["restricted", "canceled"].includes(value.subscription.status) && feature === "deviceActions",
    },
  });
  return { commands: load("lib/remote/commands.ts"), accessLookups: () => accessLookups };
}

test("organization access resolves membership against the owner's subscription", async () => {
  const db = database({
    organizations: [{ id: "organization", owner_id: "owner" }],
    organization_members: [
      { organization_id: "organization", user_id: "admin", role: "admin" },
      { organization_id: "organization", user_id: "member", role: "member" },
      { organization_id: "organization", user_id: "invalid", role: "invalid" },
    ],
    account_subscriptions: [{ user_id: "owner", plan: "pro", status: "active" }],
  });
  const load = dashboardLoader({
    "server-only": {},
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/supabase/admin": { createAdminClient: () => db },
  });
  const organizationAccess = load("lib/organization-access.ts");

  assert.equal((await organizationAccess.getOrganizationAccessForUser("organization", "owner"))?.role, "owner");
  const admin = await organizationAccess.getOrganizationAccessForUser("organization", "admin");
  assert.equal(admin?.role, "admin");
  assert.equal(admin?.subscription.plan, "pro");
  assert.equal((await organizationAccess.getOrganizationAccessForUser("organization", "member"))?.role, "member");
  assert.equal(await organizationAccess.getOrganizationAccessForUser("organization", "missing"), null);
  assert.equal(await organizationAccess.getOrganizationAccessForUser("organization", "invalid"), null);
  assert.equal(organizationAccess.accessHasFeature({ ...admin, subscription: { ...admin.subscription, status: "restricted" } }, "deviceActions"), false);
});

test("Device Actions require role permission and the organization owner's paid entitlement", async () => {
  const cases = [
    ["free owner", access({ userId: "owner", role: "owner", plan: "free", status: "active" }), false],
    ["pro owner", access({ userId: "owner", role: "owner", plan: "pro", status: "active" }), true],
    ["invited free admin in pro organization", access({ userId: "admin", role: "admin", plan: "pro", status: "active" }), true],
    ["pro member", access({ userId: "member", role: "member", plan: "pro", status: "active" }), false],
    ["restricted pro owner", access({ userId: "owner", role: "owner", plan: "pro", status: "restricted" }), false],
    ["canceled pro admin", access({ userId: "admin", role: "admin", plan: "pro", status: "canceled" }), false],
    ["past due pro owner", access({ userId: "owner", role: "owner", plan: "pro", status: "past_due" }), true],
    ["grace period pro owner", access({ userId: "owner", role: "owner", plan: "pro", status: "grace_period" }), true],
  ];

  for (const [name, effectiveAccess, allowed] of cases) {
    const { commands, accessLookups } = loadCommands(effectiveAccess);
    if (allowed) {
      await commands.commandContext("device");
      assert.equal(accessLookups(), 1, name);
    } else {
      await assert.rejects(commands.commandContext("device"), /FORBIDDEN/, name);
      assert.equal(accessLookups(), 1, name);
    }
  }
});
