import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canCreateResource,
  canUsePaidFeatures,
  getPlanLimit,
  normalizeSubscriptionStatus,
  planHasFeature,
  isPlanName,
  type EnterpriseCustomLimits,
  type PlanFeature,
  type PlanName,
  type PlanResource,
  type SubscriptionStatus,
} from "./plans";

export const ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "member",
] as const;

export type OrganizationRole =
  (typeof ORGANIZATION_ROLES)[number];

export type OrganizationPermission =
  | "organization.manage"
  | "billing.manage"
  | "members.manage"
  | "clients.create"
  | "clients.manage"
  | "devices.create"
  | "devices.manage"
  | "devices.actions"
  | "devices.terminal"
  | "devices.rdp"
  | "monitors.create"
  | "monitors.manage";

const ROLE_PERMISSIONS: Record<
  OrganizationRole,
  ReadonlySet<OrganizationPermission>
> = {
  owner: new Set([
    "organization.manage",
    "billing.manage",
    "members.manage",
    "clients.create",
    "clients.manage",
    "devices.create",
    "devices.manage",
    "devices.actions",
    "devices.terminal",
    "devices.rdp",
    "monitors.create",
    "monitors.manage",
  ]),
  admin: new Set([
    "clients.create",
    "clients.manage",
    "devices.create",
    "devices.manage",
    "devices.actions",
    "devices.terminal",
    "devices.rdp",
    "monitors.create",
    "monitors.manage",
  ]),
  member: new Set([]),
};

export function isOrganizationRole(
  value: unknown
): value is OrganizationRole {
  return (
    typeof value === "string" &&
    ORGANIZATION_ROLES.includes(value as OrganizationRole)
  );
}

export function roleHasPermission(
  role: OrganizationRole,
  permission: OrganizationPermission
) {
  return ROLE_PERMISSIONS[role].has(permission);
}

export type OrganizationSubscription = {
  organizationId: string;
  plan: PlanName;
  status: SubscriptionStatus;
  customLimits: EnterpriseCustomLimits;
};

export type OrganizationAccess = {
  organizationId: string;
  ownerId: string;
  userId: string;
  role: OrganizationRole;
  subscription: OrganizationSubscription;
};

export async function getOrganizationSubscriptionById(
  admin: SupabaseClient,
  organizationId: string
): Promise<OrganizationSubscription> {
  const { data, error } = await admin
    .from("organization_subscriptions")
    .select(`
      organization_id,
      plan,
      status,
      licensed_members,
      licensed_clients,
      licensed_devices,
      licensed_monitors
    `)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error("Organization subscription lookup failed", { cause: error });
  }

  if (!data || !isPlanName(data.plan)) throw new Error("Organization subscription is missing or invalid");
  return {
    organizationId,
    plan: data.plan,
    status: normalizeSubscriptionStatus(data?.status),
    customLimits: {
      members: data?.licensed_members ?? null,
      clients: data?.licensed_clients ?? null,
      devices: data?.licensed_devices ?? null,
      monitors: data?.licensed_monitors ?? null,
    },
  };
}

export async function resolveOrganizationAccessForUser(
  admin: SupabaseClient,
  organizationId: string,
  userId: string
): Promise<OrganizationAccess | null> {
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id, owner_id")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationError) {
    console.error("Organization access lookup error:", organizationError);
    return null;
  }

  if (!organization?.owner_id) {
    return null;
  }

  let role: OrganizationRole | null = null;

  if (organization.owner_id === userId) {
    role = "owner";
  } else {
    const { data: membership, error: membershipError } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      console.error("Organization membership access error:", membershipError);
      return null;
    }

    if (membership && isOrganizationRole(membership.role) && membership.role !== "owner") {
      role = membership.role;
    }
  }

  if (!role) {
    return null;
  }

  const subscription = await getOrganizationSubscriptionById(
    admin,
    organizationId
  );

  return {
    organizationId,
    ownerId: organization.owner_id,
    userId,
    role,
    subscription,
  };
}

export function accessHasPermission(
  access: OrganizationAccess,
  permission: OrganizationPermission
) {
  return roleHasPermission(access.role, permission);
}

export function accessHasFeature(
  access: OrganizationAccess,
  feature: PlanFeature
) {
  return (
    canUsePaidFeatures(access.subscription.status) &&
    planHasFeature(access.subscription.plan, feature)
  );
}

export function accessCanCreateResource(
  access: OrganizationAccess,
  resource: PlanResource,
  currentUsage: number
) {
  return canCreateResource({
    plan: access.subscription.plan,
    resource,
    currentUsage,
    customLimits: access.subscription.customLimits,
    subscriptionStatus: access.subscription.status,
  });
}

export function getAccessResourceLimit(
  access: OrganizationAccess,
  resource: PlanResource
) {
  return getPlanLimit(
    access.subscription.plan,
    resource,
    access.subscription.customLimits
  );
}
