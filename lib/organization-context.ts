import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function getOrganizationContext() {
  const supabase = await createClient();

  // =========================
  // USER
  // =========================

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      organization: null,
      ownedOrganization: null,
    };
  }

  // =========================
  // OWNED ORGANIZATION
  // =========================

  const {
    data: ownedOrganization,
    error: ownedOrganizationError,
  } = await supabase
    .from("organizations")
    .select(`
      id,
      name,
      owner_id,
      setup_completed
    `)
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();

  if (ownedOrganizationError) {
    console.error(
      "Owned organization context error:",
      ownedOrganizationError
    );
  }

  // =========================
  // OWNER + SETUP COMPLETE
  // =========================

  if (
    ownedOrganization &&
    ownedOrganization.setup_completed
  ) {
    return {
      user,
      organization: ownedOrganization,
      ownedOrganization,
    };
  }

  // =========================
  // MEMBERSHIP
  // =========================

  const {
    data: membership,
    error: membershipError,
  } = await supabase
    .from("organization_members")
    .select(`
      organization_id
    `)
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error(
      "Organization membership context error:",
      membershipError
    );
  }

  // =========================
  // MEMBER ORGANIZATION
  // =========================

  if (membership?.organization_id) {
    const {
      data: memberOrganization,
      error: memberOrganizationError,
    } = await supabase
      .from("organizations")
      .select(`
        id,
        name,
        owner_id,
        setup_completed
      `)
      .eq(
        "id",
        membership.organization_id
      )
      .eq(
        "setup_completed",
        true
      )
      .maybeSingle();

    if (memberOrganizationError) {
      console.error(
        "Member organization context error:",
        memberOrganizationError
      );
    }

    if (memberOrganization) {
      return {
        user,
        organization: memberOrganization,
        ownedOrganization,
      };
    }
  }

  // =========================
  // NO CONFIGURED ORGANIZATION
  // =========================

  return {
    user,
    organization: null,
    ownedOrganization,
  };
}