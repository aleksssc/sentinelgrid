import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  getAccountSubscriptionForOwner,
  resolveOrganizationAccessForUser,
} from "./organization-access-core";

export {
  ORGANIZATION_ROLES,
  accessCanCreateResource,
  accessHasFeature,
  accessHasPermission,
  getAccessResourceLimit,
  getAccountSubscriptionForOwner,
  isOrganizationRole,
  roleHasPermission,
  type AccountSubscription,
  type OrganizationAccess,
  type OrganizationPermission,
  type OrganizationRole,
} from "./organization-access-core";

export async function getAccountSubscription(ownerUserId: string) {
  return getAccountSubscriptionForOwner(
    createAdminClient(),
    ownerUserId
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
