import "server-only";

import { randomUUID } from "crypto";

import { createClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/lib/audit/create-audit-log";
import {
  agentCommandChannel,
  publishRealtimeMessage,
} from "@/lib/realtime/pubsub";
import { enforceRemoteRateLimit } from "@/lib/remote/rate-limit";

export const QUICK_ACTIONS = [
  "update_agent",
  "reboot",
  "shutdown",
  "lock",
  "restart_agent",
  "force_inventory",
  "flush_dns",
  "gpupdate",
] as const;

export type QuickAction =
  (typeof QUICK_ACTIONS)[number];

type CommandPayload = {
  delay_seconds?: number;
  force?: boolean;
};

function isQuickAction(
  value: unknown,
): value is QuickAction {
  return (
    typeof value === "string" &&
    QUICK_ACTIONS.includes(
      value as QuickAction,
    )
  );
}

function validatePayload(
  commandType: QuickAction,
  payload: unknown,
): CommandPayload {
  if (commandType === "update_agent") {
    if (
      payload !== undefined &&
      (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        Object.keys(payload).length !== 0
      )
    ) {
      throw new Error(
        "INVALID_PAYLOAD",
      );
    }

    return {};
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return {};
  }

  const input =
    payload as Record<
      string,
      unknown
    >;

  const result: CommandPayload = {};

  if ("delay_seconds" in input) {
    if (
      typeof input.delay_seconds !==
        "number" ||
      !Number.isInteger(
        input.delay_seconds,
      ) ||
      input.delay_seconds < 0 ||
      input.delay_seconds > 3600
    ) {
      throw new Error(
        "INVALID_PAYLOAD",
      );
    }

    result.delay_seconds =
      input.delay_seconds;
  }

  if ("force" in input) {
    if (
      typeof input.force !==
      "boolean"
    ) {
      throw new Error(
        "INVALID_PAYLOAD",
      );
    }

    result.force =
      input.force;
  }

  if (
    commandType !== "reboot" &&
    commandType !== "shutdown" &&
    (
      "delay_seconds" in result ||
      "force" in result
    )
  ) {
    throw new Error(
      "INVALID_PAYLOAD",
    );
  }

  return result;
}

export async function createQuickAction({
  deviceId,
  commandType,
  payload,
  idempotencyKey,
}: {
  deviceId: string;
  commandType: unknown;
  payload?: unknown;
  idempotencyKey?: unknown;
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
    !isQuickAction(commandType)
  ) {
    throw new Error(
      "INVALID_COMMAND_TYPE",
    );
  }

  await enforceRemoteRateLimit(
    user.id,
    "commands",
  );

  const safePayload =
    validatePayload(
      commandType,
      payload,
    );

  const safeIdempotencyKey =
    typeof idempotencyKey ===
      "string" &&
    /^[a-zA-Z0-9_-]{8,120}$/.test(
      idempotencyKey,
    )
      ? idempotencyKey
      : randomUUID();

  const {
    data: device,
  } =
    await supabase
      .from("devices")
      .select(
        `
          id,
          hostname,
          display_name,
          status,
          last_seen,
          client_id,
          capabilities
        `,
      )
      .eq("id", deviceId)
      .maybeSingle();

  if (!device) {
    throw new Error(
      "DEVICE_NOT_FOUND",
    );
  }

  const capabilities =
    device.capabilities &&
    typeof device.capabilities ===
      "object"
      ? device.capabilities as Record<
          string,
          unknown
        >
      : {};

  if (
    capabilities.commands !== true
  ) {
    throw new Error(
      "AGENT_UNSUPPORTED",
    );
  }

  if (
    commandType ===
      "update_agent" &&
    (
      capabilities.agent_update !==
        true ||
      process.env
        .SENTINELGRID_AGENT_UPDATES_ENABLED !==
        "true"
    )
  ) {
    throw new Error(
      "AGENT_UNSUPPORTED",
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
      .from("organizations")
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

  const {
    data: existingCommand,
  } =
    await supabase
      .from(
        "device_commands",
      )
      .select(
        "id, status, expires_at",
      )
      .eq(
        "organization_id",
        organization.id,
      )
      .eq(
        "device_id",
        device.id,
      )
      .eq(
        "idempotency_key",
        safeIdempotencyKey,
      )
      .maybeSingle();

  if (existingCommand) {
    return {
      commandId:
        existingCommand.id,

      status:
        existingCommand.status,

      expiresAt:
        existingCommand.expires_at,
    };
  }

  let role:
    | "owner"
    | "admin"
    | "member"
    | null = null;

  if (
    organization.owner_id ===
    user.id
  ) {
    role = "owner";
  } else {
    const {
      data: membership,
    } =
      await supabase
        .from(
          "organization_members",
        )
        .select("role")
        .eq(
          "organization_id",
          organization.id,
        )
        .eq(
          "user_id",
          user.id,
        )
        .maybeSingle();

    if (
      membership?.role ===
        "admin" ||
      membership?.role ===
        "member"
    ) {
      role =
        membership.role;
    }
  }

  /*
   * SentinelGrid does NOT require
   * MFA/AAL2.
   *
   * Sensitive actions remain
   * protected by authentication
   * and organization role.
   */

  if (
    role !== "owner" &&
    role !== "admin"
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
      .select(
        `
          remote_access_enabled,
          terminal_enabled
        `,
      )
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

  const expiresAt =
    new Date(
      Date.now() +
        5 * 60_000,
    ).toISOString();

  const {
    data: command,
    error,
  } =
    await supabase
      .from(
        "device_commands",
      )
      .insert({
        organization_id:
          organization.id,

        device_id:
          device.id,

        requested_by:
          user.id,

        command_type:
          commandType,

        payload:
          safePayload,

        idempotency_key:
          safeIdempotencyKey,

        expires_at:
          expiresAt,
      })
      .select(
        `
          id,
          status,
          expires_at
        `,
      )
      .single();

  if (
    error ||
    !command
  ) {
    throw new Error(
      "COMMAND_CREATE_FAILED",
    );
  }

  await publishRealtimeMessage(
    agentCommandChannel(
      device.id,
    ),
    {
      type:
        "typed_command",

      command_id:
        command.id,

      command_type:
        commandType,

      payload:
        safePayload,

      idempotency_key:
        safeIdempotencyKey,

      created_at:
        new Date()
          .toISOString(),

      expires_at:
        expiresAt,
    },
  );

  await supabase
    .from(
      "device_commands",
    )
    .update({
      status:
        "dispatched",

      dispatched_at:
        new Date()
          .toISOString(),
    })
    .eq(
      "id",
      command.id,
    )
    .eq(
      "status",
      "queued",
    );

  await createAuditLog({
    organizationId:
      organization.id,

    action:
      "device.command.requested",

    targetType:
      "device",

    targetId:
      device.id,

    targetName:
      device.display_name ||
      device.hostname,

    metadata: {
      commandId:
        command.id,

      commandType,

      expiresAt,
    },
  });

  return {
    commandId:
      command.id,

    status:
      "dispatched",

    expiresAt,
  };
}