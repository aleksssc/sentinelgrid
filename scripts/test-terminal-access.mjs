import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardLoader } from "./dashboard-test-loader.mjs";

function effectiveAccess({ userId, role, plan, status }) {
  return {
    organizationId: "organization",
    ownerId: "owner",
    userId,
    role,
    subscription: { organizationId: "organization", plan, status, customLimits: {} },
  };
}

function loadSessions(access) {
  const rows = {
    devices: [{ id: "device", hostname: "test", display_name: null, client_id: "client", last_seen: new Date().toISOString() }],
    clients: [{ id: "client", organization_id: "organization" }],
    organizations: [{ id: "organization", owner_id: "owner" }],
    organization_remote_access_settings: [],
  };
  const inserted = [], audits = [], tickets = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: access.userId } } }) },
    from(table) {
      const filters = [];
      let value;
      const query = {
        select() { return query; },
        eq(key, expected) { filters.push(row => row[key] === expected); return query; },
        in() { return query; },
        insert(row) { value = { id: "session", status: "requested", expires_at: row.expires_at }; inserted.push(row); return query; },
        single: async () => ({ data: value, error: null }),
        maybeSingle: async () => ({ data: (rows[table] ?? []).find(row => filters.every(filter => filter(row))) ?? null, error: null }),
        then(resolve, reject) { return Promise.resolve({ count: 0, data: [], error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
  const load = dashboardLoader({
    "server-only": {},
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/organization-access": {
      getOrganizationAccessForUser: async () => access,
      accessHasPermission: (value, permission) => (value.role === "owner" || value.role === "admin") && permission === "devices.terminal",
      accessHasFeature: (value, feature) => dashboardLoader()("lib/organization-access-core.ts").accessHasFeature(value, feature),
    },
    "@/lib/remote/rate-limit": { enforceRemoteRateLimit: async () => {} },
    "@/lib/realtime/redis": { getRedis: () => ({ set: async (...args) => tickets.push(args) }) },
    "@/lib/audit/create-audit-log": { createAuditLog: async value => audits.push(value) },
  });
  return { sessions: load("lib/remote/sessions.ts"), inserted, audits, tickets };
}

test("Terminal HTTP sessions require the organization entitlement and terminal role permission", async () => {
  const cases = [
    ["free owner", effectiveAccess({ userId: "owner", role: "owner", plan: "free", status: "active" }), true],
    ["pro owner", effectiveAccess({ userId: "owner", role: "owner", plan: "pro", status: "active" }), true],
    ["invited free admin in pro organization", effectiveAccess({ userId: "admin", role: "admin", plan: "pro", status: "active" }), true],
    ["pro member", effectiveAccess({ userId: "member", role: "member", plan: "pro", status: "active" }), false],
    ["restricted pro owner", effectiveAccess({ userId: "owner", role: "owner", plan: "pro", status: "restricted" }), true],
    ["canceled pro admin", effectiveAccess({ userId: "admin", role: "admin", plan: "pro", status: "canceled" }), true],
    ["past due pro owner", effectiveAccess({ userId: "owner", role: "owner", plan: "pro", status: "past_due" }), true],
    ["grace period pro owner", effectiveAccess({ userId: "owner", role: "owner", plan: "pro", status: "grace_period" }), true],
  ];

  for (const [name, access, allowed] of cases) {
    const fixture = loadSessions(access);
    if (allowed) {
      await fixture.sessions.createRemoteSession({ deviceId: "device", sessionType: "terminal" });
      assert.equal(fixture.inserted.length, 1, name);
      assert.equal(fixture.audits.length, 1, name);
      assert.equal(fixture.tickets.length, 1, name);
    } else {
      await assert.rejects(fixture.sessions.createRemoteSession({ deviceId: "device", sessionType: "terminal" }), /FORBIDDEN/, name);
      assert.equal(fixture.inserted.length, 0, name);
      assert.equal(fixture.audits.length, 0, name);
      assert.equal(fixture.tickets.length, 0, name);
    }
  }
});
