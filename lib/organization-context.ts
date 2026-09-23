import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  isOrganizationRole,
  type OrganizationRole,
} from "@/lib/organization-access-core";

export type OrganizationContextItem = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  setup_completed: boolean;
  created_at: string | null;
};

type OrganizationContextRow = Omit<OrganizationContextItem, "setup_completed"> & {
  setup_completed: boolean | null;
};

type MembershipRow = {
  organization_id: string;
  role: string;
};

export const getOrganizationContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      organization: null,
      ownedOrganization: null,
      organizations: [] as OrganizationContextItem[],
      organizationRoles: {} as Record<string, OrganizationRole>,
    };
  }

  const [organizationsResult, membershipsResult, cookieStore] =
    await Promise.all([
      supabase
        .from("organizations")
        .select("id, name, description, owner_id, setup_completed, created_at")
        .order("name")
        .returns<OrganizationContextRow[]>(),
      supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", user.id)
        .returns<MembershipRow[]>(),
      cookies(),
    ]);

  if (organizationsResult.error) {
    throw new Error("Organization context lookup failed", {
      cause: organizationsResult.error,
    });
  }

  if (membershipsResult.error) {
    throw new Error("Membership lookup failed", {
      cause: membershipsResult.error,
    });
  }

  const membershipRoles = new Map<string, OrganizationRole>();

  for (const membership of membershipsResult.data ?? []) {
    if (
      isOrganizationRole(membership.role) &&
      membership.role !== "owner"
    ) {
      membershipRoles.set(membership.organization_id, membership.role);
    }
  }

  const organizationRoles: Record<string, OrganizationRole> = {};
  const normalizedOrganizations: OrganizationContextItem[] =
    (organizationsResult.data ?? []).map((organization) => ({
      ...organization,
      setup_completed: Boolean(organization.setup_completed),
    }));

  const organizations = normalizedOrganizations.filter(
    (organization) => {
      if (organization.owner_id === user.id) {
        organizationRoles[organization.id] = "owner";
        return true;
      }

      const role = membershipRoles.get(organization.id);
      if (!role) return false;

      organizationRoles[organization.id] = role;
      return true;
    }
  );

  const selectedId =
    cookieStore.get("sentinelgrid-organization")?.value;

  const available = organizations.filter(
    (organization) => organization.setup_completed
  );

  const organization =
    available.find((item) => item.id === selectedId) ??
    (available.length === 1 ? available[0] : null);

  const owned = organizations.filter(
    (organization) => organization.owner_id === user.id
  );

  const ownedOrganization =
    owned.find((item) => item.id === selectedId) ??
    (owned.length === 1 ? owned[0] : null);

  return {
    user,
    organization,
    ownedOrganization,
    organizations,
    organizationRoles,
  };
});
