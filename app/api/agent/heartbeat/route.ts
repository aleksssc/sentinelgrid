import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  processHeartbeat,
} from "@/lib/agent/heartbeat";

export async function POST(
  request: NextRequest
) {
  try {
    const authorization =
      request.headers.get(
        "authorization"
      );

    if (
      !authorization ||
      !authorization.startsWith(
        "Bearer "
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Missing agent authentication.",
        },
        {
          status: 401,
        }
      );
    }

    const agentToken =
      authorization
        .slice(
          "Bearer ".length
        )
        .trim();

    if (!agentToken) {
      return NextResponse.json(
        {
          error:
            "Invalid agent authentication.",
        },
        {
          status: 401,
        }
      );
    }

    const heartbeat =
      await processHeartbeat(
        agentToken
      );

    return NextResponse.json({
      ok: true,

      device_id:
        heartbeat.deviceId,

      hostname:
        heartbeat.hostname,

      status:
        heartbeat.status,

      last_seen:
        heartbeat.lastSeen,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_ERROR";

    if (
      message ===
      "INVALID_AGENT"
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid agent.",
        },
        {
          status: 401,
        }
      );
    }

    console.error(
      "Heartbeat error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Could not process heartbeat.",
      },
      {
        status: 500,
      }
    );
  }
}