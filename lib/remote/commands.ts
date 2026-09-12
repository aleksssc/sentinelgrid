import "server-only";

import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuditLog } from "@/lib/audit/create-audit-log";
import { agentCommandChannel, publishRealtimeMessage } from "@/lib/realtime/pubsub";
import { getRedis } from "@/lib/realtime/redis";
import { recoverTypedCommands } from "@/lib/realtime/typed-commands";
import { enforceRemoteRateLimit } from "@/lib/remote/rate-limit";
import { DEVICE_ACTIONS, ACTIVE_COMMAND_STATUSES, commandLifetime, type ActionAvailability, type QuickAction } from "./action-definitions";

export type { QuickAction } from "./action-definitions";
export const QUICK_ACTIONS = DEVICE_ACTIONS.map((action) => action.type);

type CommandPayload = { delay_seconds?: number; force?: boolean };
export function validatePayload(commandType: QuickAction, payload: unknown): CommandPayload {
  if (payload === undefined) return {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("INVALID_PAYLOAD");
  const input = payload as Record<string, unknown>;
  const power = commandType === "reboot" || commandType === "shutdown";
  if (Object.keys(input).some((key) => !power || (key !== "delay_seconds" && key !== "force"))) throw new Error("INVALID_PAYLOAD");
  const result: CommandPayload = {};
  if ("delay_seconds" in input) {
    if (typeof input.delay_seconds !== "number" || !Number.isInteger(input.delay_seconds) || input.delay_seconds < 0 || input.delay_seconds > 3600) throw new Error("INVALID_PAYLOAD");
    result.delay_seconds = input.delay_seconds;
  }
  if ("force" in input) {
    if (typeof input.force !== "boolean") throw new Error("INVALID_PAYLOAD");
    result.force = input.force;
  }
  return result;
}

export async function commandContext(deviceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHORIZED");
  const { data: device, error: deviceError } = await supabase.from("devices")
    .select("id, hostname, display_name, status, last_seen, client_id, capabilities, agent_version")
    .eq("id", deviceId).maybeSingle();
  if (deviceError) throw new Error("COMMAND_LOOKUP_FAILED");
  if (!device) throw new Error("DEVICE_NOT_FOUND");
  const { data: client, error: clientError } = await supabase.from("clients").select("organization_id").eq("id", device.client_id).maybeSingle();
  if (clientError) throw new Error("COMMAND_LOOKUP_FAILED");
  if (!client) throw new Error("DEVICE_NOT_FOUND");
  const { data: organization, error: orgError } = await supabase.from("organizations").select("id, owner_id").eq("id", client.organization_id).maybeSingle();
  if (orgError) throw new Error("COMMAND_LOOKUP_FAILED");
  if (!organization) throw new Error("DEVICE_NOT_FOUND");
  let canManage = organization.owner_id === user.id;
  if (!canManage) {
    const { data: membership, error } = await supabase.from("organization_members").select("role")
      .eq("organization_id", organization.id).eq("user_id", user.id).maybeSingle();
    if (error) throw new Error("COMMAND_LOOKUP_FAILED");
    canManage = membership?.role === "admin";
  }
  if (!canManage) throw new Error("FORBIDDEN");
  return { supabase, user, device, organization };
}

async function availability(context: Awaited<ReturnType<typeof commandContext>>): Promise<ActionAvailability> {
  const { supabase, device, organization } = context;
  const admin = createAdminClient();
  await recoverTypedCommands(admin, device.id);
  const [{ data: settings, error: settingsError }, { data: pending, error: pendingError }] = await Promise.all([
    supabase.from("organization_remote_access_settings").select("remote_access_enabled").eq("organization_id", organization.id).maybeSingle(),
    supabase.from("device_commands").select("id").eq("device_id", device.id).eq("organization_id", organization.id).in("status", ACTIVE_COMMAND_STATUSES).limit(1),
  ]);
  if (settingsError || pendingError) throw new Error("COMMAND_LOOKUP_FAILED");
  const seen = Date.parse(device.last_seen ?? "");
  const common = !Number.isFinite(seen) || Date.now() - seen > 90_000 ? "Device is offline" :
    settings?.remote_access_enabled === false ? "Remote actions are disabled by organization policy" :
    pending?.length ? "Another device command is already running" : null;
  const reasons = Object.fromEntries(QUICK_ACTIONS.map((action) => [action, common])) as ActionAvailability;
  if (common) return reasons;
  const { data: activeUpdate, error: activeUpdateError } = await admin.from("agent_update_transactions")
    .select("id").eq("device_id", device.id).in("status", ["downloading", "verifying", "staged", "installing", "restarting"]).limit(1);
  if (activeUpdateError) console.error("[Device actions] UPDATE_BUSY_LOOKUP_FAILED", activeUpdateError.code);
  if (activeUpdateError || activeUpdate?.length) {
    for (const type of ["restart_agent", "update_agent", "reboot", "shutdown"] as const) {
      reasons[type] = activeUpdateError ? "Could not verify whether an Agent update is running" : "Another device command is already running";
    }
  }
  // Availability authorizes a request, not its outcome. The Agent checks live support;
  // update/check and the secure updater remain authoritative for release eligibility.
  return reasons;
}

export async function quickActionAvailability(deviceId: string) {
  return availability(await commandContext(deviceId));
}

export async function createQuickAction({ deviceId, commandType, payload, idempotencyKey }: {
  deviceId: string; commandType: unknown; payload?: unknown; idempotencyKey?: unknown;
}) {
  if (typeof commandType !== "string" || !QUICK_ACTIONS.includes(commandType as QuickAction)) throw new Error("INVALID_COMMAND_TYPE");
  const type = commandType as QuickAction;
  const safePayload = validatePayload(type, payload);
  const context = await commandContext(deviceId);
  const { supabase, user, device, organization } = context;
  await enforceRemoteRateLimit(user.id, "commands");
  const key = typeof idempotencyKey === "string" && /^[a-zA-Z0-9_-]{8,120}$/.test(idempotencyKey) ? idempotencyKey : randomUUID();
  const redis = getRedis(), lock = `sentinelgrid:device:${device.id}:command-submission`, owner = randomUUID();
  if (!await redis.set(lock, owner, { nx: true, ex: 30 })) throw new Error("COMMAND_BUSY");
  try {
    const { data: existing, error: existingError } = await supabase.from("device_commands").select("id, status, expires_at")
      .eq("organization_id", organization.id).eq("device_id", device.id).eq("idempotency_key", key).maybeSingle();
    if (existingError) throw new Error("COMMAND_LOOKUP_FAILED");
    if (existing) return { commandId: existing.id, status: existing.status, expiresAt: existing.expires_at };
    const reasons = await availability(context);
    if (reasons[type]) {
      if (reasons[type] === "Device is offline") throw new Error("DEVICE_OFFLINE");
      if (reasons[type] === "Another device command is already running") throw new Error("COMMAND_BUSY");
      if (reasons[type] === "Remote actions are disabled by organization policy") throw new Error("REMOTE_ACCESS_DISABLED");
      throw new Error("COMMAND_LOOKUP_FAILED");
    }
    const expiresAt = new Date(Date.now() + commandLifetime(type, safePayload.delay_seconds)).toISOString();
    const { data: command, error } = await supabase.from("device_commands").insert({
      organization_id: organization.id, device_id: device.id, requested_by: user.id,
      command_type: type, payload: safePayload, idempotency_key: key, expires_at: expiresAt,
    }).select("id, status, expires_at").single();
    if (error || !command) throw new Error("COMMAND_CREATE_FAILED");
    await createAuditLog({ organizationId: organization.id, action: "device.command.requested", targetType: "device",
      targetId: device.id, targetName: device.display_name || device.hostname,
      metadata: { commandId: command.id, commandType: type, expiresAt },
    });
    const { error: dispatchError } = await supabase.from("device_commands").update({ status: "dispatched", dispatched_at: new Date().toISOString() })
      .eq("id", command.id).eq("status", "queued");
    if (dispatchError) throw new Error("COMMAND_DISPATCH_FAILED");
    await publishRealtimeMessage(agentCommandChannel(device.id), { type: "typed_command", command_id: command.id, command_type: type,
      payload: safePayload, idempotency_key: key, created_at: new Date().toISOString(), expires_at: expiresAt });
    return { commandId: command.id, status: "dispatched", expiresAt };
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [lock], [owner]);
  }
}
