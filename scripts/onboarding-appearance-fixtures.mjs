import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dashboardLoader } from "./dashboard-test-loader.mjs";
import { fixtureMocks } from "./dashboard-ui-fixtures.mjs";

export async function renderOnboardingFixtures() {
  const fixtures = {};
  for (const mode of ["create", "join", "invite-setup"]) {
    const user = { id: "onboarding-user", email: "member@example.test", user_metadata: { organization_invite_token: "fixture-token", organization_name: "Example organization" } };
    const invitation = { id: "invite-1", token: "fixture-token", organization_id: "org-1", email: user.email, role: "member", status: "pending", expires_at: null };
    const db = {
      auth: { getUser: async () => ({ data: { user } }) },
      from(table) {
        const data = table === "organizations" ? { id: "org-1", name: "Example organization" } : mode === "create" ? null : invitation;
        return {
          select() { return this; }, ilike() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
          maybeSingle: async () => ({ data, error: null }),
        };
      },
    };
    const load = dashboardLoader({
      ...fixtureMocks(),
      "@/lib/supabase/server": { createClient: async () => db },
      "@/lib/supabase/client": { createClient: () => db },
      "@/lib/organization-context": { getOrganizationContext: async () => ({ user, organization: null, ownedOrganization: null }) },
      "./actions": { acceptOrganizationInvite() { throw new Error("Presentation fixtures cannot accept invitations"); } },
      "@/app/dashboard/dashboard-background.css": {},
      "@/app/dashboard/dashboard-themes.css": {},
      "./onboarding-shell.css": {},
    });
    const page = await load(mode === "invite-setup" ? "app\\auth\\invite\\page.tsx" : "app\\onboarding\\page.tsx").default();
    fixtures[mode] = renderToStaticMarkup(mode === "invite-setup" ? React.createElement(load("app\\auth\\layout.tsx").default, null, page) : page);
  }
  return fixtures;
}
