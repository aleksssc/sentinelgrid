import {
  createHash,
  randomBytes,
  randomUUID,
} from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";

type EnrollAgentInput = {
  token: string;
  hostname: string;
  os: string;

  arch?: string | null;
  localIp?: string | null;
  macAddress?: string | null;

  capabilities?: Record<string, unknown> | null;
};

export async function enrollAgent({
  token,
  hostname,
  os,
  arch,
  localIp,
  macAddress,
  capabilities,
}: EnrollAgentInput) {
  const admin =
    createAdminClient();

  /* =========================
     TOKEN HASH
  ========================= */

  const tokenHash =
    createHash("sha256")
      .update(token)
      .digest("hex");

  /* =========================
     FIND ENROLLMENT TOKEN
  ========================= */

  const {
    data: enrollmentToken,
    error: tokenError,
  } =
    await admin
      .from(
        "agent_enrollment_tokens"
      )
      .select(`
        id,
        organization_id,
        client_id,
        site_id,
        expires_at,
        used_at,
        revoked_at
      `)
      .eq(
        "token_hash",
        tokenHash
      )
      .maybeSingle();

  if (
    tokenError ||
    !enrollmentToken
  ) {
    throw new Error(
      "INVALID_TOKEN"
    );
  }

  /* =========================
     TOKEN VALIDATION
  ========================= */

  if (
    enrollmentToken.revoked_at
  ) {
    throw new Error(
      "TOKEN_REVOKED"
    );
  }

  if (
    enrollmentToken.used_at
  ) {
    throw new Error(
      "TOKEN_ALREADY_USED"
    );
  }

  const expiresAt =
    new Date(
      enrollmentToken.expires_at
    ).getTime();

  if (
    expiresAt <
    Date.now()
  ) {
    throw new Error(
      "TOKEN_EXPIRED"
    );
  }

  /* =========================
     CLAIM TOKEN

     Isto impede dois agents
     de usarem o mesmo token
     ao mesmo tempo.
  ========================= */

  const now =
    new Date().toISOString();

  const {
    data: claimedToken,
    error: claimError,
  } =
    await admin
      .from(
        "agent_enrollment_tokens"
      )
      .update({
        used_at: now,
      })
      .eq(
        "id",
        enrollmentToken.id
      )
      .is(
        "used_at",
        null
      )
      .is(
        "revoked_at",
        null
      )
      .gt(
        "expires_at",
        now
      )
      .select("id")
      .maybeSingle();

  if (
    claimError ||
    !claimedToken
  ) {
    throw new Error(
      "TOKEN_UNAVAILABLE"
    );
  }

  /* =========================
     AGENT ID
  ========================= */

  const agentId =
    randomUUID();

  /* =========================
     PERMANENT AGENT TOKEN
  ========================= */

  const agentToken =
    `SG-AGENT-${randomBytes(
      48
    ).toString("hex")}`;

  const agentTokenHash =
    createHash("sha256")
      .update(agentToken)
      .digest("hex");

  /* =========================
     CREATE DEVICE
  ========================= */

  const {
    data: device,
    error: deviceError,
  } =
    await admin
      .from("devices")
      .insert({
        client_id:
          enrollmentToken.client_id,

        site_id:
          enrollmentToken.site_id,

        hostname,

        display_name:
          hostname,

        os,

        arch:
          arch ?? null,

        local_ip:
          localIp ?? null,

        mac_address:
          macAddress ?? null,

        capabilities:
          normalizeCapabilities(capabilities),

        status:
          "online",

        agent_id:
          agentId,

        agent_token_hash:
          agentTokenHash,

        enrolled_at:
          now,

        last_seen:
          now,
      })
      .select(`
        id,
        agent_id
      `)
      .single();

  if (
    deviceError ||
    !device
  ) {
    console.error(
      "Device enrollment error:",
      deviceError
    );

    /* =========================
       RELEASE TOKEN

       Se criar o device falhar,
       permitimos tentar outra vez.
    ========================= */

    await admin
      .from(
        "agent_enrollment_tokens"
      )
      .update({
        used_at: null,
      })
      .eq(
        "id",
        enrollmentToken.id
      );

    throw new Error(
      "DEVICE_CREATION_FAILED"
    );
  }

  /* =========================
     SUCCESS
  ========================= */

  return {
    deviceId:
      device.id,

    agentId:
      device.agent_id,

    agentToken,
  };
}

function normalizeCapabilities(
  value?: Record<string, unknown> | null
) {
  const names = [
    "agent_update",
    "commands",
    "terminal",
    "force_inventory",
    "restart_agent",
    "services",
    "software",
    "security",
    "tcp_tunnel",
    "rdp",
  ];

  return Object.fromEntries(
    names.map((name) => [
      name,
      value?.[name] === true,
    ])
  );
}