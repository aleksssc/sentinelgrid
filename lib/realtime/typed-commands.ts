import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_COMMAND_STATUSES } from "../remote/action-definitions";

export type TypedResult = {
  command_id?: string;
  type?: string;
  status?: string;
  result?: Record<string, unknown>;
  error_code?: string;
  error_message?: string;
};
const columns = "id, device_id, organization_id, requested_by, command_type, status, result, expires_at, started_at, completed_at, error_code, error_message, update_transaction_id";

async function finish(admin: SupabaseClient, command: Record<string, unknown>, status: "succeeded" | "failed", result: Record<string, unknown>, code?: string, message?: string) {
  const completedAt = new Date().toISOString();
  const { data: changed, error } = await admin.from("device_commands").update({
    status, completed_at: completedAt, result,
    error_code: status === "failed" ? code || "COMMAND_FAILED" : null,
    error_message: status === "failed" ? message || "The device command failed." : null,
  }).eq("id", command.id).eq("device_id", command.device_id).in("status", ACTIVE_COMMAND_STATUSES).select("id").maybeSingle();
  if (error) throw new Error("COMMAND_RESULT_SAVE_FAILED");
  if (!changed) {
    const { data: current, error: currentError } = await admin.from("device_commands").select("status")
      .eq("id", command.id).eq("device_id", command.device_id).maybeSingle();
    if (currentError || !current) throw new Error("COMMAND_RESULT_LOOKUP_FAILED");
    return current.status as string;
  }
  await auditTerminal(admin, { ...command, completed_at: completedAt }, status, result, code, message);
  return status;
}

async function auditTerminal(admin: SupabaseClient, command: Record<string, unknown>, status: string, result: Record<string, unknown>, code?: string, message?: string) {
  const { error: auditError } = await admin.from("audit_logs").upsert({
    id: command.id, created_at: command.completed_at ?? new Date().toISOString(),
    organization_id: command.organization_id, user_id: command.requested_by,
    action: `device.command.${status}`, target_type: "device", target_id: command.device_id,
    status: status === "succeeded" ? "success" : "failed",
    metadata: { commandId: command.id, commandType: command.command_type, result,
      errorCode: code ?? null, errorMessage: message ?? null },
  }, { onConflict: "id", ignoreDuplicates: true });
  if (auditError) throw new Error("COMMAND_AUDIT_SAVE_FAILED");
}

export async function acceptTypedResult(admin: SupabaseClient, deviceId: string, message: TypedResult) {
  if (typeof message.command_id !== "string" || !message.command_id) return;
  const { data: command, error } = await admin.from("device_commands").select(columns)
    .eq("id", message.command_id).eq("device_id", deviceId).maybeSingle();
  if (error) throw new Error("COMMAND_LOOKUP_FAILED");
  if (!command) return;
  // Update transactions remain authoritative; their existing report endpoint owns completion.
  if (command.command_type === "update_agent" && command.update_transaction_id) return;
  if (!ACTIVE_COMMAND_STATUSES.includes(command.status)) {
    if (command.status === "succeeded" || command.status === "failed") await auditTerminal(admin, command, command.status, command.result ?? {}, command.error_code, command.error_message);
    return command.status as string;
  }
  if (message.type === "typed_command_ack" || message.type === "typed_command_running") {
    if (command.command_type !== "update_agent" && Date.parse(command.expires_at) <= Date.now()) {
      return finish(admin, command, "failed", command.result ?? {}, "COMMAND_EXPIRED", "The command expired before execution was confirmed.");
    }
    const acknowledged = message.type === "typed_command_ack";
    const now = new Date().toISOString();
    const changes = acknowledged ? { status: "acknowledged", acknowledged_at: now } : {
      status: "running", started_at: command.started_at ?? now,
      ...(message.result ? { result: message.result } : {}),
    };
    const { data: saved, error: saveError } = await admin.from("device_commands").update(changes)
      .eq("id", command.id).eq("device_id", deviceId)
      .in("status", acknowledged ? ["queued", "dispatched"] : ACTIVE_COMMAND_STATUSES).select("status").maybeSingle();
    if (saveError) throw new Error("COMMAND_PROGRESS_SAVE_FAILED");
    if (saved) return saved.status as string;
    const { data: current, error: currentError } = await admin.from("device_commands").select("status")
      .eq("id", command.id).eq("device_id", deviceId).maybeSingle();
    if (currentError || !current) throw new Error("COMMAND_PROGRESS_LOOKUP_FAILED");
    return current.status as string;
  }
  if (message.status !== "succeeded" && message.status !== "failed") return;
  const result = message.result && typeof message.result === "object" && !Array.isArray(message.result) ? message.result : {};
  if (JSON.stringify(result).length > 32768) throw new Error("COMMAND_RESULT_TOO_LARGE");
  return finish(admin, command, message.status, result, message.error_code?.slice(0, 128), message.error_message?.slice(0, 512));
}

export async function recoverTypedCommands(admin: SupabaseClient, deviceId?: string) {
  let query = admin.from("device_commands").select(columns).is("update_transaction_id", null)
    .in("status", ACTIVE_COMMAND_STATUSES).order("expires_at").limit(500);
  if (deviceId) query = query.eq("device_id", deviceId);
  const { data: commands, error } = await query;
  if (error) throw new Error("COMMAND_RECOVERY_LOOKUP_FAILED");
  for (const command of commands ?? []) {
    if (command.command_type === "update_agent") {
      if (command.update_transaction_id) continue;
      // Never time out the validated transaction flow. Bound only commands that never established one.
      const stagingGrace = ["acknowledged", "running"].includes(command.status) ? 15 * 60_000 : 0;
      if (Date.now() < Date.parse(command.expires_at) + stagingGrace) continue;
    }
    const result = command.result ?? {};
    const scheduled = Date.parse(result.scheduled_at);
    if (command.command_type === "shutdown" && result.power_accepted === true && result.exit_code === 0 &&
        Number.isFinite(scheduled) && Date.now() > scheduled + 90_000) {
      const { data: device, error: deviceError } = await admin.from("devices").select("last_seen").eq("id", command.device_id).maybeSingle();
      if (deviceError) throw new Error("COMMAND_RECOVERY_DEVICE_FAILED");
      if (device?.last_seen && Date.parse(device.last_seen) < scheduled + 30_000) {
        await finish(admin, command, "succeeded", { ...result, confirmation: "windows_accepted_and_device_offline" });
        continue;
      }
    }
    if (Date.parse(command.expires_at) <= Date.now()) {
      await finish(admin, command, "failed", result, "COMMAND_TIMEOUT", "The operation was not confirmed before its deadline. It will not be executed again.");
    }
  }
}

export async function pendingTypedCommands(admin: SupabaseClient, deviceId: string) {
  const { data, error } = await admin.from("device_commands")
    .select("id, status, command_type, payload, idempotency_key, created_at, expires_at")
    .eq("device_id", deviceId).in("status", ["queued", "dispatched"])
    .gt("expires_at", new Date().toISOString()).order("created_at").limit(20);
  if (error) throw new Error("COMMAND_REDELIVERY_FAILED");
  const deliverable = [];
  for (const command of data ?? []) {
    if (command.status === "queued") {
      const { data: changed, error: dispatchError } = await admin.from("device_commands")
        .update({ status: "dispatched", dispatched_at: new Date().toISOString() })
        .eq("id", command.id).eq("device_id", deviceId).eq("status", "queued").select("id").maybeSingle();
      if (dispatchError) throw new Error("COMMAND_REDELIVERY_FAILED");
      if (!changed) continue;
    }
    deliverable.push(command);
  }
  return deliverable.map((command) => ({ type: "typed_command" as const, command_id: command.id as string,
    command_type: command.command_type as string, payload: command.payload as Record<string, unknown>,
    idempotency_key: command.idempotency_key as string, created_at: command.created_at as string, expires_at: command.expires_at as string,
  }));
}
