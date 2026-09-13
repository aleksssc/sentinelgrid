import "server-only";

import { createClient } from "@/lib/supabase/server";

import {
  canCreateResource,
  canUsePaidFeatures,
  getPlanLimit,
  normalizeSubscriptionStatus,
  planHasFeature,
  type EnterpriseCustomLimits,
  type PlanFeature,
  type PlanName,
  type PlanResource,
  type SubscriptionStatus,
} from "@/lib/plans";


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
    ORGANIZATION_ROLES.includes(
      value as OrganizationRole
    )
  );
}


export function roleHasPermission(
  role: OrganizationRole,
  permission: OrganizationPermission
) {
  return ROLE_PERMISSIONS[role].has(
    permission
  );
}


export type AccountSubscription = {
  userId: string;
  plan: PlanName;
  status: SubscriptionStatus;
  customLimits: EnterpriseCustomLimits;
};


export type OrganizationAccess = {
  organizationId: string;
  ownerId: string;
  userId: string;
  role: OrganizationRole;
  subscription: AccountSubscription;
};


function normalizePlan(
  plan: unknown
): PlanName {
  if (
    plan === "pro" ||
    plan === "business" ||
    plan === "enterprise"
  ) {
    return plan;
  }

  return "free";
}


export async function getAccountSubscription(
  ownerUserId: string
): Promise<AccountSubscription> {
  const supabase = await createClient();

  const {
    data,
    error,
  } = await supabase
    .from("account_subscriptions")
    .select(`
      user_id,
      plan,
      status,
      custom_max_members,
      custom_max_clients,
      custom_max_devices,
      custom_max_monitors
    `)
    .eq("user_id", ownerUserId)
    .maybeSingle();

  if (error) {
    console.error(
      "Account subscription access error:",
      error
    );
  }

  return {
    userId: ownerUserId,
    plan: normalizePlan(data?.plan),
    status: normalizeSubscriptionStatus(
      data?.status
    ),
    customLimits: {
      members: data?.custom_max_members ?? null,
      clients: data?.custom_max_clients ?? null,
      devices: data?.custom_max_devices ?? null,
      monitors: data?.custom_max_monitors ?? null,
    },
  };
}


export async function getOrganizationAccess(
  organizationId: string
): Promise<OrganizationAccess | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const {
    data: organization,
    error: organizationError,
  } = await supabase
    .from("organizations")
    .select("id, owner_id")
    .eq("id", organizationId)
    .maybeSingle();

  if (
    organizationError ||
    !organization
  ) {
    return null;
  }

  let role: OrganizationRole | null = null;

  if (organization.owner_id === user.id) {
    role = "owner";
  } else {
    const {
      data: membership,
      error: membershipError,
    } = await supabase
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      console.error(
        "Organization membership access error:",
        membershipError
      );
    }

    if (
      membership &&
      membership.status !== "pending" &&
      isOrganizationRole(membership.role)
    ) {
      role = membership.role;
    }
  }

  if (!role) {
    return null;
  }

  const subscription =
    await getAccountSubscription(
      organization.owner_id
    );

  return {
    organizationId,
    ownerId: organization.owner_id,
    userId: user.id,
    role,
    subscription,
  };
}


export function accessHasPermission(
  access: OrganizationAccess,
  permission: OrganizationPermission
) {
  return roleHasPermission(
    access.role,
    permission
  );
}


export function accessHasFeature(
  access: OrganizationAccess,
  feature: PlanFeature
) {
  return (
    canUsePaidFeatures(
      access.subscription.status
    ) &&
    planHasFeature(
      access.subscription.plan,
      feature
    )
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
    customLimits:
      access.subscription.customLimits,
    subscriptionStatus:
      access.subscription.status,
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
