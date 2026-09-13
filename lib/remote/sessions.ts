import "server-only";

import {
  createHash,
  randomBytes,
} from "crypto";

import {
  createAuditLog,
} from "@/lib/audit/create-audit-log";

import {
  accessHasFeature,
  accessHasPermission,
  getOrganizationAccessForUser,
} from "@/lib/organization-access";

import {
  getRedis,
} from "@/lib/realtime/redis";

import {
  enforceRemoteRateLimit,
} from "@/lib/remote/rate-limit";

import {
  createClient,
} from "@/lib/supabase/server";

export type RemoteSessionType =
  "terminal";

const TICKET_TTL_SECONDS =
  60;

function isSessionType(
  value: unknown,
): value is RemoteSessionType {
  return value === "terminal";
}

export async function createRemoteSession({
  deviceId,
  sessionType,
  reason,
}: {
  deviceId: string;
  sessionType: unknown;
  reason?: unknown;
}) {
  const supabase =
    await createClient();

  const {
    data: { user },
  } =
    await supabase.auth.getUser();

  if (!user) {
    throw new Error(
      "UNAUTHORIZED",
    );
  }

  if (
    !isSessionType(
      sessionType,
    )
  ) {
    throw new Error(
      "INVALID_SESSION_TYPE",
    );
  }

  await enforceRemoteRateLimit(
    user.id,
    "sessions",
  );

  const {
    data: device,
  } =
    await supabase
      .from("devices")
      .select(`
        id,
        hostname,
        display_name,
        client_id,
        last_seen,
        capabilities
      `)
      .eq("id", deviceId)
      .maybeSingle();

  if (!device) {
    throw new Error(
      "DEVICE_NOT_FOUND",
    );
  }

  const {
    data: client,
  } =
    await supabase
      .from("clients")
      .select(
        "organization_id",
      )
      .eq(
        "id",
        device.client_id,
      )
      .maybeSingle();

  if (!client) {
    throw new Error(
      "DEVICE_NOT_FOUND",
    );
  }

  const {
    data: organization,
  } =
    await supabase
      .from(
        "organizations",
      )
      .select(
        "id, owner_id",
      )
      .eq(
        "id",
        client.organization_id,
      )
      .maybeSingle();

  if (!organization) {
    throw new Error(
      "DEVICE_NOT_FOUND",
    );
  }

  const access = await getOrganizationAccessForUser(
    organization.id,
    user.id,
  );

  if (
    !access ||
    !accessHasPermission(
      access,
      "devices.terminal",
    ) ||
    !accessHasFeature(
      access,
      "terminal",
    )
  ) {
    throw new Error(
      "FORBIDDEN",
    );
  }

  const {
    data: settings,
  } =
    await supabase
      .from(
        "organization_remote_access_settings",
      )
      .select(`
        remote_access_enabled,
        terminal_enabled,
        max_session_minutes,
        max_concurrent_sessions
      `)
      .eq(
        "organization_id",
        organization.id,
      )
      .maybeSingle();

  if (
    settings &&
    !settings.remote_access_enabled
  ) {
    throw new Error(
      "REMOTE_ACCESS_DISABLED",
    );
  }

  if (
    sessionType ===
      "terminal" &&
    settings &&
    !settings.terminal_enabled
  ) {
    throw new Error(
      "TERMINAL_DISABLED",
    );
  }

  if (
    !device.last_seen ||
    Date.now() -
      new Date(
        device.last_seen,
      ).getTime() >
      90_000
  ) {
    throw new Error(
      "DEVICE_OFFLINE",
    );
  }

  const {
    count,
  } =
    await supabase
      .from(
        "remote_sessions",
      )
      .select(
        "id",
        {
          count: "exact",
          head: true,
        },
      )
      .eq(
        "organization_id",
        organization.id,
      )
      .in(
        "status",
        [
          "requested",
          "connecting",
          "active",
        ],
      );

  if (
    (count ?? 0) >=
    (
      settings
        ?.max_concurrent_sessions ??
      2
    )
  ) {
    throw new Error(
      "SESSION_LIMIT_REACHED",
    );
  }

  const maxMinutes =
    settings
      ?.max_session_minutes ??
    30;

  const expiresAt =
    new Date(
      Date.now() +
        maxMinutes *
          60_000,
    ).toISOString();

  const {
    data: session,
    error,
  } =
    await supabase
      .from(
        "remote_sessions",
      )
      .insert({
        organization_id:
          organization.id,

        device_id:
          device.id,

        requested_by:
          user.id,

        session_type:
          sessionType,

        expires_at:
          expiresAt,

        source_metadata: {
          reason:
            typeof reason ===
            "string"
              ? reason.slice(
                  0,
                  240,
                )
              : null,
        },
      })
      .select(`
        id,
        status,
        expires_at
      `)
      .single();

  if (
    error ||
    !session
  ) {
    throw new Error(
      "SESSION_CREATE_FAILED",
    );
  }

  const ticket =
    randomBytes(32)
      .toString(
        "base64url",
      );

  const ticketHash =
    createHash("sha256")
      .update(ticket)
      .digest("hex");

  const redis =
    getRedis();

  await redis.set(
    `sentinelgrid:remote-ticket:${ticketHash}`,
    session.id,
    {
      ex:
        TICKET_TTL_SECONDS,

      nx:
        true,
    },
  );

  await createAuditLog({
    organizationId:
      organization.id,

    action:
      `remote.${sessionType}.requested`,

    targetType:
      "device",

    targetId:
      device.id,

    targetName:
      device.display_name ||
      device.hostname,

    metadata: {
      sessionId:
        session.id,

      expiresAt,

      reason:
        typeof reason ===
        "string"
          ? reason.slice(
              0,
              240,
            )
          : null,
    },
  });

  return {
    sessionId:
      session.id,

    ticket,

    ticketTtlSeconds:
      TICKET_TTL_SECONDS,

    expiresAt,
  };
}
