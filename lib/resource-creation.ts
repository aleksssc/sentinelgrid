import type { SupabaseClient } from "@supabase/supabase-js";

import {
  accessCanCreateResource,
  accessHasPermission,
  getOrganizationAccessForUser,
  type OrganizationPermission,
} from "./organization-access";
import { type PlanResource } from "./plans";

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

export async function getOrganizationResourceUsage(
  admin: SupabaseClient,
  organizationId: string,
  resource: "clients" | "devices" | "monitors"
) {
  const { data, error } = await admin.rpc("organization_billing_usage", { p_organization_id: organizationId });
  if (error || !data || !Number.isSafeInteger(data[resource])) throw new Error("RESOURCE_USAGE_LOOKUP_FAILED", { cause: error });
  return Number(data[resource]);
}

export async function getOrganizationResourceCreationAccess(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  resource: "clients" | "devices" | "monitors"
): Promise<ResourceCreationAccess> {
  const access = await getOrganizationAccessForUser(organizationId, userId);
  if (!access || !accessHasPermission(access, CREATE_PERMISSION[resource])) {
    return { allowed: false, reason: "permission_denied", currentUsage: 0 };
  }

  const currentUsage = await getOrganizationResourceUsage(admin, organizationId, resource);

  if (!accessCanCreateResource(access, resource, currentUsage)) {
    return { allowed: false, reason: "limit_reached", currentUsage };
  }

  return { allowed: true, currentUsage };
}

export async function requireOrganizationResourceCreation(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  resource: "clients" | "devices" | "monitors"
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
