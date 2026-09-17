import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  getOrganizationSubscriptionById,
  resolveOrganizationAccessForUser,
  accessHasPermission,
  type OrganizationPermission,
} from "./organization-access-core";

export {
  ORGANIZATION_ROLES,
  accessCanCreateResource,
  accessHasFeature,
  accessHasPermission,
  getAccessResourceLimit,
  getOrganizationSubscriptionById,
  isOrganizationRole,
  roleHasPermission,
  type OrganizationSubscription,
  type OrganizationAccess,
  type OrganizationPermission,
  type OrganizationRole,
} from "./organization-access-core";

export async function getOrganizationSubscription(organizationId: string) {
  return getOrganizationSubscriptionById(
    createAdminClient(),
    organizationId
  );
}

export async function getOrganizationAccessForUser(
  organizationId: string,
  userId: string
) {
  return resolveOrganizationAccessForUser(
    createAdminClient(),
    organizationId,
    userId
  );
}

export async function getOrganizationAccess(organizationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  return getOrganizationAccessForUser(organizationId, user.id);
}

export async function assertOrganizationPermission(organizationId: string, permission: OrganizationPermission) {
  const access = await getOrganizationAccess(organizationId);
  if (!access || !accessHasPermission(access, permission)) throw new Error("Organization permission denied");
  return access;
}
