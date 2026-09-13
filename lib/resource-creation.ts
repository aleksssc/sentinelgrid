import type { SupabaseClient } from "@supabase/supabase-js";

import {
  accessCanCreateResource,
  accessHasPermission,
  getAccountSubscriptionForOwner,
  getOrganizationAccessForUser,
  type OrganizationAccess,
  type OrganizationPermission,
} from "./organization-access";
import { canCreateResource, type PlanResource } from "./plans";

export type ResourceCreationBlockReason =
  | "permission_denied"
  | "subscription_restricted"
  | "limit_reached";

export type ResourceCreationAccess = {
  allowed: boolean;
  reason?: ResourceCreationBlockReason;
  currentUsage: number;
};

const CREATE_PERMISSION: Record<Exclude<PlanResource, "members">, OrganizationPermission> = {
  clients: "clients.create",
  devices: "devices.create",
  monitors: "monitors.create",
};

export class ResourceCreationError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "SUBSCRIPTION_RESTRICTED" | "LIMIT_REACHED") {
    super(code);
  }
}

function isRestricted(status: OrganizationAccess["subscription"]["status"]) {
  return status === "restricted" || status === "canceled";
}

export async function getOrganizationResourceUsage(
  admin: SupabaseClient,
  organizationId: string,
  resource: "clients" | "devices"
) {
  if (resource === "clients") {
    const { count, error } = await admin
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);

    if (error) throw new Error("RESOURCE_USAGE_LOOKUP_FAILED");
    return count ?? 0;
  }

  const { data: clients, error: clientsError } = await admin
    .from("clients")
    .select("id")
    .eq("organization_id", organizationId);

  if (clientsError) throw new Error("RESOURCE_USAGE_LOOKUP_FAILED");
  const clientIds = (clients ?? []).map((client) => client.id);
  if (!clientIds.length) return 0;

  const { count, error } = await admin
    .from("devices")
    .select("id", { count: "exact", head: true })
    .in("client_id", clientIds);

  if (error) throw new Error("RESOURCE_USAGE_LOOKUP_FAILED");
  return count ?? 0;
}

export async function getOrganizationResourceCreationAccess(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  resource: "clients" | "devices"
): Promise<ResourceCreationAccess> {
  const access = await getOrganizationAccessForUser(organizationId, userId);
  if (!access || !accessHasPermission(access, CREATE_PERMISSION[resource])) {
    return { allowed: false, reason: "permission_denied", currentUsage: 0 };
  }

  const currentUsage = await getOrganizationResourceUsage(admin, organizationId, resource);
  if (isRestricted(access.subscription.status)) {
    return { allowed: false, reason: "subscription_restricted", currentUsage };
  }

  if (!accessCanCreateResource(access, resource, currentUsage)) {
    return { allowed: false, reason: "limit_reached", currentUsage };
  }

  return { allowed: true, currentUsage };
}

export async function requireOrganizationResourceCreation(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  resource: "clients" | "devices"
) {
  const result = await getOrganizationResourceCreationAccess(admin, organizationId, userId, resource);
  if (result.allowed) return result;

  throw new ResourceCreationError(
    result.reason === "limit_reached"
      ? "LIMIT_REACHED"
      : result.reason === "subscription_restricted"
        ? "SUBSCRIPTION_RESTRICTED"
        : "FORBIDDEN"
  );
}

export async function getUserMonitorCreationAccess(
  admin: SupabaseClient,
  userId: string
): Promise<ResourceCreationAccess> {
  const [{ count, error }, subscription] = await Promise.all([
    admin.from("monitors").select("id", { count: "exact", head: true }).eq("user_id", userId),
    getAccountSubscriptionForOwner(admin, userId),
  ]);

  if (error) throw new Error("RESOURCE_USAGE_LOOKUP_FAILED");
  const currentUsage = count ?? 0;
  if (isRestricted(subscription.status)) {
    return { allowed: false, reason: "subscription_restricted", currentUsage };
  }

  return {
    allowed: canCreateResource({
      plan: subscription.plan,
      resource: "monitors",
      currentUsage,
      customLimits: subscription.customLimits,
      subscriptionStatus: subscription.status,
    }),
    reason: canCreateResource({
      plan: subscription.plan,
      resource: "monitors",
      currentUsage,
      customLimits: subscription.customLimits,
      subscriptionStatus: subscription.status,
    }) ? undefined : "limit_reached",
    currentUsage,
  };
}
