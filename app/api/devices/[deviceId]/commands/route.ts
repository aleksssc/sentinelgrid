import { NextResponse } from "next/server";

import { createQuickAction } from "@/lib/remote/commands";
import { createClient } from "@/lib/supabase/server";

const ERROR_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  AAL2_REQUIRED: 403,
  DEVICE_NOT_FOUND: 404,
  DEVICE_OFFLINE: 409,
  REMOTE_ACCESS_DISABLED: 403,
  INVALID_COMMAND_TYPE: 400,
  INVALID_PAYLOAD: 400,
  COMMAND_CREATE_FAILED: 500,
  RATE_LIMITED: 429,
  AGENT_UNSUPPORTED: 409,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  try {
    const { deviceId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      command_type?: unknown;
      payload?: unknown;
      idempotency_key?: unknown;
    };

    const result = await createQuickAction({
      deviceId,
      commandType: body.command_type,
      payload: body.payload,
      idempotencyKey: body.idempotency_key,
    });

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMAND_CREATE_FAILED";

    if (!ERROR_STATUS[code]) {
      console.error("Device command error:", error);
    }

    return NextResponse.json(
      {
        error: ERROR_STATUS[code] ? code : "COMMAND_CREATE_FAILED",
      },
      { status: ERROR_STATUS[code] ?? 500 },
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const { deviceId } = await params;
  const commandId = new URL(request.url).searchParams.get("command_id");

  if (!commandId) {
    return NextResponse.json({ error: "COMMAND_ID_REQUIRED" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { data: command, error } = await supabase
    .from("device_commands")
    .select(
      "id, device_id, command_type, status, created_at, dispatched_at, acknowledged_at, started_at, completed_at, expires_at, result, error_code, error_message",
    )
    .eq("id", commandId)
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error || !command) {
    return NextResponse.json({ error: "COMMAND_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json(command);
}
