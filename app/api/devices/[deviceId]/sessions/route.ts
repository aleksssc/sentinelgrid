import { NextResponse } from "next/server";

import { createRemoteSession } from "@/lib/remote/sessions";

const ERROR_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  DEVICE_NOT_FOUND: 404,
  DEVICE_OFFLINE: 409,
  REMOTE_ACCESS_DISABLED: 403,
  TERMINAL_DISABLED: 403,
  SESSION_LIMIT_REACHED: 409,
  INVALID_SESSION_TYPE: 400,
  SESSION_CREATE_FAILED: 500,
  RATE_LIMITED: 429,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  try {
    const { deviceId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      session_type?: unknown;
      reason?: unknown;
    };

    const result = await createRemoteSession({
      deviceId,
      sessionType: body.session_type,
      reason: body.reason,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SESSION_CREATE_FAILED";

    if (!ERROR_STATUS[code]) {
      console.error("Remote session error:", error);
    }

    return NextResponse.json(
      { error: ERROR_STATUS[code] ? code : "SESSION_CREATE_FAILED" },
      { status: ERROR_STATUS[code] ?? 500 },
    );
  }
}
