import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const getOrganizationContext = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, organization: null, ownedOrganization: null };
  }

  const { data: ownedOrganization, error: ownedOrganizationError } = await supabase
    .from("organizations")
    .select("id, name, owner_id, setup_completed")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();

  if (ownedOrganizationError) {
    console.error("Owned organization context error:", ownedOrganizationError);
  }

  if (ownedOrganization?.setup_completed) {
    return { user, organization: ownedOrganization, ownedOrganization };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("Organization membership context error:", membershipError);
  }

  if (membership?.organization_id) {
    const { data: memberOrganization, error: memberOrganizationError } = await supabase
      .from("organizations")
      .select("id, name, owner_id, setup_completed")
      .eq("id", membership.organization_id)
      .eq("setup_completed", true)
      .maybeSingle();

    if (memberOrganizationError) {
      console.error("Member organization context error:", memberOrganizationError);
    }

    if (memberOrganization) {
      return { user, organization: memberOrganization, ownedOrganization };
    }
  }

  return { user, organization: null, ownedOrganization };
});
