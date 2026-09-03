import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createHash,
} from "crypto";

import {
  createClient,
} from "@supabase/supabase-js";

/* =========================
   TYPES
========================= */

type AgentInventory = {
  hostname?: unknown;

  os?: unknown;

  os_version?: unknown;

  os_build?: unknown;

  arch?: unknown;

  local_ip?: unknown;

  mac_address?: unknown;

  manufacturer?: unknown;

  model?: unknown;

  serial_number?: unknown;

  cpu_name?: unknown;

  ram_total_bytes?: unknown;

  agent_version?: unknown;
};

type HeartbeatBody = {
  agent_token?: unknown;

  token?: unknown;

  cpu_usage?: unknown;

  ram_usage?: unknown;

  ram_total_bytes?: unknown;

  ram_used_bytes?: unknown;

  disk_usage?: unknown;

  disk_total_bytes?: unknown;

  disk_used_bytes?: unknown;

  uptime_seconds?: unknown;

  inventory?: AgentInventory;
};

/* =========================
   SUPABASE ADMIN
========================= */

function createAdminClient() {
  const url =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL;

  const serviceRoleKey =
    process.env
      .SUPABASE_SERVICE_ROLE_KEY;

  if (
    !url ||
    !serviceRoleKey
  ) {
    throw new Error(
      "Supabase server environment variables are missing."
    );
  }

  return createClient(
    url,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

/* =========================
   POST
========================= */

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (await request
        .json()
        .catch(() => ({}))) as HeartbeatBody;

    /* =========================
       AGENT TOKEN
    ========================= */

    const authorization =
      request.headers.get(
        "authorization"
      );

    let bearerToken =
      "";

    if (
      authorization
        ?.toLowerCase()
        .startsWith(
          "bearer "
        )
    ) {
      bearerToken =
        authorization
          .slice(7)
          .trim();
    }

    const bodyAgentToken =
      safeString(
        body.agent_token
      ) ||
      safeString(
        body.token
      );

    const agentToken =
      bearerToken ||
      bodyAgentToken;

    if (!agentToken) {
      return NextResponse.json(
        {
          error:
            "Missing agent token.",
        },
        {
          status: 401,
        }
      );
    }

    /* =========================
       HASH TOKEN
    ========================= */

    const tokenHash =
      createHash(
        "sha256"
      )
        .update(
          agentToken
        )
        .digest(
          "hex"
        );

    const supabase =
      createAdminClient();

    /* =========================
       FIND DEVICE
    ========================= */

    const {
      data: device,
      error: deviceError,
    } =
      await supabase
        .from(
          "devices"
        )
        .select(
          "id"
        )
        .eq(
          "agent_token_hash",
          tokenHash
        )
        .maybeSingle();

    if (deviceError) {
      console.error(
        "Heartbeat lookup error:",
        deviceError
      );

      return NextResponse.json(
        {
          error:
            "Could not validate agent.",
        },
        {
          status: 500,
        }
      );
    }

    if (!device) {
      return NextResponse.json(
        {
          error:
            "Invalid agent token.",
        },
        {
          status: 401,
        }
      );
    }

    /* =========================
       BASE UPDATE
    ========================= */

    const updateData:
      Record<
        string,
        string | number
      > = {
        status:
          "online",

        last_seen:
          new Date()
            .toISOString(),
      };

    /* =========================
       PUBLIC IP
    ========================= */

    const publicIP =
      getPublicIP(
        request
      );

    if (publicIP) {
      updateData.public_ip =
        publicIP;
    }

    /* =========================
       METRICS
    ========================= */

    assignNumber(
      updateData,
      "cpu_usage",
      body.cpu_usage
    );

    assignNumber(
      updateData,
      "ram_usage",
      body.ram_usage
    );

    assignNumber(
      updateData,
      "ram_total_bytes",
      body.ram_total_bytes
    );

    assignNumber(
      updateData,
      "ram_used_bytes",
      body.ram_used_bytes
    );

    assignNumber(
      updateData,
      "disk_usage",
      body.disk_usage
    );

    assignNumber(
      updateData,
      "disk_total_bytes",
      body.disk_total_bytes
    );

    assignNumber(
      updateData,
      "disk_used_bytes",
      body.disk_used_bytes
    );

    assignNumber(
      updateData,
      "uptime_seconds",
      body.uptime_seconds
    );

    /* =========================
       INVENTORY
    ========================= */

    const inventory =
      body.inventory;

    if (
      inventory &&
      typeof inventory ===
        "object"
    ) {
      assignString(
        updateData,
        "hostname",
        inventory.hostname
      );

      assignString(
        updateData,
        "os",
        inventory.os
      );

      assignString(
        updateData,
        "os_version",
        inventory.os_version
      );

      assignString(
        updateData,
        "os_build",
        inventory.os_build
      );

      assignString(
        updateData,
        "arch",
        inventory.arch
      );

      assignString(
        updateData,
        "local_ip",
        inventory.local_ip
      );

      assignString(
        updateData,
        "mac_address",
        inventory.mac_address
      );

      assignString(
        updateData,
        "manufacturer",
        inventory.manufacturer
      );

      assignString(
        updateData,
        "model",
        inventory.model
      );

      assignString(
        updateData,
        "serial_number",
        inventory.serial_number
      );

      assignString(
        updateData,
        "cpu_name",
        inventory.cpu_name
      );

      assignString(
        updateData,
        "agent_version",
        inventory.agent_version
      );

      assignNumber(
        updateData,
        "ram_total_bytes",
        inventory.ram_total_bytes
      );
    }

    /* =========================
       UPDATE DEVICE
    ========================= */

    const {
      error: updateError,
    } =
      await supabase
        .from(
          "devices"
        )
        .update(
          updateData
        )
        .eq(
          "id",
          device.id
        );

    if (updateError) {
      console.error(
        "Heartbeat update error:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "Could not update device.",
        },
        {
          status: 500,
        }
      );
    }

    /* =========================
       RESPONSE
    ========================= */

    return NextResponse.json(
      {
        ok: true,

        device_id:
          device.id,
      }
    );
  } catch (error) {
    console.error(
      "Agent heartbeat failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Internal server error.",
      },
      {
        status: 500,
      }
    );
  }
}

/* =========================
   SAFE STRING
========================= */

function safeString(
  value: unknown
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  return value.trim();
}

/* =========================
   ASSIGN STRING
========================= */

function assignString(
  target: Record<
    string,
    string | number
  >,
  key: string,
  value: unknown
) {
  const parsed =
    safeString(
      value
    );

  if (parsed) {
    target[key] =
      parsed;
  }
}

/* =========================
   ASSIGN NUMBER
========================= */

function assignNumber(
  target: Record<
    string,
    string | number
  >,
  key: string,
  value: unknown
) {
  if (
    typeof value !==
    "number"
  ) {
    return;
  }

  if (
    !Number.isFinite(
      value
    )
  ) {
    return;
  }

  target[key] =
    value;
}

/* =========================
   PUBLIC IP
========================= */

function getPublicIP(
  request: NextRequest
) {
  const forwarded =
    request.headers.get(
      "x-forwarded-for"
    );

  if (forwarded) {
    const first =
      forwarded
        .split(",")[0]
        ?.trim();

    if (first) {
      return first;
    }
  }

  const realIP =
    request.headers.get(
      "x-real-ip"
    );

  return (
    realIP?.trim() ||
    ""
  );
}