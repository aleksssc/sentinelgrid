import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardLoader } from "./dashboard-test-loader.mjs";

function loadEnrollment(result) {
  const inserted = [];
  let released = false;
  const token = {
    id: "token", organization_id: "organization", client_id: "client", site_id: null,
    created_by: "owner", expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null, revoked_at: null,
  };
  const db = {
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; }, gt() { return query; },
        update(value) { if (value.used_at === null) released = true; return query; },
        insert(value) { if (table === "devices") inserted.push(value); return query; },
        maybeSingle: async () => ({ data: table === "agent_enrollment_tokens" ? token : { id: "device", agent_id: "agent" }, error: null }),
        single: async () => ({ data: { id: "device", agent_id: "agent" }, error: null }),
      };
      return query;
    },
  };
  class ResourceCreationError extends Error { constructor(code) { super(code); this.code = code; } }
  const load = dashboardLoader({
    "server-only": {},
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/resource-creation": {
      ResourceCreationError,
      requireOrganizationResourceCreation: async () => {
        if (result !== "allowed") throw new ResourceCreationError(result);
      },
    },
  });
  return { enrollAgent: load("lib/agent/device-enrollment.ts").enrollAgent, inserted, released };
}

test("enrollment revalidates a token at consumption and creates a device below the limit", async () => {
  const fixture = loadEnrollment("allowed");
  await fixture.enrollAgent({ token: "token", hostname: "host", os: "windows" });
  assert.equal(fixture.inserted.length, 1);
});

test("an enrollment token issued below the limit is denied after the limit is reached", async () => {
  const fixture = loadEnrollment("LIMIT_REACHED");
  await assert.rejects(fixture.enrollAgent({ token: "token", hostname: "host", os: "windows" }), /LIMIT_REACHED/);
  assert.equal(fixture.inserted.length, 0);
});

test("restricted subscriptions deny enrollment without creating a device", async () => {
  const fixture = loadEnrollment("SUBSCRIPTION_RESTRICTED");
  await assert.rejects(fixture.enrollAgent({ token: "token", hostname: "host", os: "windows" }), /SUBSCRIPTION_RESTRICTED/);
  assert.equal(fixture.inserted.length, 0);
});
