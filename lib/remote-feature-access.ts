import {
  accessHasFeature,
  accessHasPermission,
  type OrganizationAccess,
  type OrganizationPermission,
} from "./organization-access-core";
import type { PlanFeature } from "./plans";

export type RemoteFeatureAccessState =
  | "allowed"
  | "permission_denied"
  | "upgrade_required"
  | "subscription_restricted";

export type RemoteFeatureAccess = {
  state: RemoteFeatureAccessState;
  canUse: boolean;
  canManageBilling: boolean;
};

export function getRemoteFeatureAccess(
  access: OrganizationAccess | null,
  permission: OrganizationPermission,
  feature: PlanFeature,
): RemoteFeatureAccess {
  if (!access || !accessHasPermission(access, permission)) {
    return { state: "permission_denied", canUse: false, canManageBilling: false };
  }

  const canManageBilling = accessHasPermission(access, "billing.manage");
  if (!accessHasFeature(access, feature)) {
    return { state: "upgrade_required", canUse: false, canManageBilling };
  }

  return { state: "allowed", canUse: true, canManageBilling };
}
