import { NextResponse } from "next/server";
import { commandContext, createQuickAction, quickActionAvailability } from "@/lib/remote/commands";
import { createAdminClient } from "@/lib/supabase/admin";
import { recoverTypedCommands } from "@/lib/realtime/typed-commands";
import { updateCommandFeedback } from "@/lib/remote/update-command-feedback";

const ERROR_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401, FORBIDDEN: 403, DEVICE_NOT_FOUND: 404, DEVICE_OFFLINE: 409,
  REMOTE_ACCESS_DISABLED: 403, INVALID_COMMAND_TYPE: 400, INVALID_PAYLOAD: 400,
  COMMAND_CREATE_FAILED: 500, RATE_LIMITED: 429, AGENT_UNSUPPORTED: 409,
  COMMAND_BUSY: 409, NO_NEWER_AGENT_VERSION: 409, COMMAND_DISPATCH_FAILED: 503,
  COMMAND_LOOKUP_FAILED: 503,
};
function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "COMMAND_CREATE_FAILED";
  if (!ERROR_STATUS[code] || ERROR_STATUS[code] >= 500) console.error("Device command error:", error);
  return NextResponse.json({ error: ERROR_STATUS[code] ? code : "COMMAND_CREATE_FAILED" },
    { status: ERROR_STATUS[code] ?? 500, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  try {
    const { deviceId } = await params;
    let body: unknown;
    try { body = await request.json(); } catch { throw new Error("INVALID_PAYLOAD"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_PAYLOAD");
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some((key) => !["command_type", "payload", "idempotency_key"].includes(key))) throw new Error("INVALID_PAYLOAD");
    const result = await createQuickAction({ deviceId, commandType: input.command_type, payload: input.payload, idempotencyKey: input.idempotency_key });
    return NextResponse.json(result, { status: 202 });
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  try {
    const { deviceId } = await params;
    const commandId = new URL(request.url).searchParams.get("command_id");
    if (!commandId) return NextResponse.json({ actions: await quickActionAvailability(deviceId) }, { headers: { "Cache-Control": "no-store" } });
    const { supabase, organization, device } = await commandContext(deviceId);
    const admin = createAdminClient();
    await recoverTypedCommands(admin, deviceId);
    const { data: command, error } = await supabase.from("device_commands")
      .select("id, device_id, command_type, status, created_at, dispatched_at, acknowledged_at, started_at, completed_at, expires_at, result, error_code, error_message")
      .eq("id", commandId).eq("device_id", deviceId).eq("organization_id", organization.id).maybeSingle();
    if (error) throw new Error("COMMAND_LOOKUP_FAILED");
    if (!command) return NextResponse.json({ error: "COMMAND_NOT_FOUND" }, { status: 404 });
    const feedback = await updateCommandFeedback(admin, device, command);
    return NextResponse.json({ ...command, ...feedback }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
