import {
  createHash,
  randomBytes,
} from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function createEnrollmentToken({
  organizationId,
  clientId,
  siteId,
}: {
  organizationId: string;
  clientId: string;
  siteId?: string | null;
}) {
  const supabase =
    await createClient();

  const admin =
    createAdminClient();

  /* =========================
     USER
  ========================= */

  const {
    data: { user },
  } =
    await supabase.auth.getUser();

  if (!user) {
    throw new Error(
      "UNAUTHORIZED"
    );
  }

  /* =========================
     ORGANIZATION
  ========================= */

  const {
    data: organization,
  } =
    await supabase
      .from("organizations")
      .select(`
        id,
        owner_id
      `)
      .eq(
        "id",
        organizationId
      )
      .maybeSingle();

  if (!organization) {
    throw new Error(
      "ORGANIZATION_NOT_FOUND"
    );
  }

  /* =========================
     PERMISSION
  ========================= */

  const isOwner =
    organization.owner_id ===
    user.id;

  let isAdmin = false;

  if (!isOwner) {
    const {
      data: membership,
    } =
      await supabase
        .from(
          "organization_members"
        )
        .select("role")
        .eq(
          "organization_id",
          organization.id
        )
        .eq(
          "user_id",
          user.id
        )
        .maybeSingle();

    isAdmin =
      membership?.role ===
      "admin";
  }

  if (
    !isOwner &&
    !isAdmin
  ) {
    throw new Error(
      "FORBIDDEN"
    );
  }

  /* =========================
     CLIENT
  ========================= */

  const {
    data: client,
  } =
    await supabase
      .from("clients")
      .select("id")
      .eq(
        "id",
        clientId
      )
      .eq(
        "organization_id",
        organization.id
      )
      .maybeSingle();

  if (!client) {
    throw new Error(
      "CLIENT_NOT_FOUND"
    );
  }

  /* =========================
     SITE
  ========================= */

  if (siteId) {
    const {
      data: site,
    } =
      await supabase
        .from("sites")
        .select("id")
        .eq(
          "id",
          siteId
        )
        .eq(
          "client_id",
          client.id
        )
        .maybeSingle();

    if (!site) {
      throw new Error(
        "SITE_NOT_FOUND"
      );
    }
  }

  /* =========================
     TOKEN
  ========================= */

  const token =
    `SG-ENROLL-${randomBytes(
      32
    ).toString("hex")}`;

  const tokenHash =
    createHash("sha256")
      .update(token)
      .digest("hex");

  const expiresAt =
    new Date(
      Date.now() +
        30 * 60 * 1000
    );

  /* =========================
     DATABASE
  ========================= */

  const {
    error,
  } =
    await admin
      .from(
        "agent_enrollment_tokens"
      )
      .insert({
        organization_id:
          organization.id,

        client_id:
          client.id,

        site_id:
          siteId ?? null,

        token_hash:
          tokenHash,

        created_by:
          user.id,

        expires_at:
          expiresAt.toISOString(),
      });

  if (error) {
    console.error(
      "Enrollment token error:",
      error
    );

    throw new Error(
      "TOKEN_CREATION_FAILED"
    );
  }

  return {
    token,
    expiresAt:
      expiresAt.toISOString(),
  };
}