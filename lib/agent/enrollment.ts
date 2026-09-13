import {
  createHash,
  randomBytes,
} from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ResourceCreationError, requireOrganizationResourceCreation } from "@/lib/resource-creation";

export async function createEnrollmentToken({ organizationId, clientId, siteId }: { organizationId: string; clientId: string; siteId?: string | null }) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHORIZED");

  const { data: organization } = await supabase.from("organizations").select("id").eq("id", organizationId).maybeSingle();
  if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");

  try {
    await requireOrganizationResourceCreation(admin, organizationId, user.id, "devices");
  } catch (error) {
    if (error instanceof ResourceCreationError) throw error;
    console.error("Enrollment token access check failed:", error);
    throw new Error("ENROLLMENT_ACCESS_CHECK_FAILED");
  }

  const { data: client } = await supabase.from("clients").select("id").eq("id", clientId).eq("organization_id", organization.id).maybeSingle();
  if (!client) throw new Error("CLIENT_NOT_FOUND");

  if (siteId) {
    const { data: site } = await supabase.from("sites").select("id").eq("id", siteId).eq("client_id", client.id).maybeSingle();
    if (!site) throw new Error("SITE_NOT_FOUND");
  }

  const token = `SG-ENROLL-${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const { error } = await admin.from("agent_enrollment_tokens").insert({
    organization_id: organization.id, client_id: client.id, site_id: siteId ?? null,
    token_hash: tokenHash, created_by: user.id, expires_at: expiresAt.toISOString(),
  });
  if (error) {
    console.error("Enrollment token error:", error);
    throw new Error("TOKEN_CREATION_FAILED");
  }
  return { token, expiresAt: expiresAt.toISOString() };
}
