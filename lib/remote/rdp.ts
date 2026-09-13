import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { UpdateAPIError } from "@/lib/agent/update-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentCommandChannel, publishRealtimeMessage } from "@/lib/realtime/pubsub";
import { getRedis } from "@/lib/realtime/redis";
import { enforceRemoteRateLimit } from "@/lib/remote/rate-limit";
import { RDP_ACTIVE_STATUSES, RDP_TICKET_SECONDS, UUID, rdpLimits, rdpOnline, relayURL } from "./rdp-policy";

type Admin = ReturnType<typeof createAdminClient>;
export type RDPSession = {
  id: string; organization_id: string; device_id: string; requested_by: string;
  status: string; expires_at: string; created_at: string; relay_seen_at: string | null;
};
type Ticket = { sessionId: string; role: "client" | "agent" };

export class RDPError extends Error {
  constructor(message: string, public status = 403) { super(message); }
}

function rdpLog(event: string, fields: Record<string, string | number | boolean | null | undefined> = {}) {
  console.info("[RDP]", event, fields);
}

function rdpFailure(error: unknown) {
  if (error instanceof RDPError) return { code: error.message, status: error.status };
  if (error instanceof UpdateAPIError) return { code: error.code, status: error.status };
  if (error instanceof Error) return { code: error.message, status: undefined };
  return { code: "UNKNOWN", status: undefined };
}

export function rdpError(error: unknown) {
  const failure = error instanceof RDPError ? error
    : error instanceof UpdateAPIError ? new RDPError(error.code, error.status)
    : error instanceof Error && error.message === "RATE_LIMITED" ? new RDPError("RATE_LIMITED", 429)
    : new RDPError("RDP_SERVICE_FAILED", 503);
  console.error("[RDP] request failed", { ...rdpFailure(error), responseCode: failure.message, responseStatus: failure.status });
  return Response.json({ error: failure.message }, {
    status: failure.status, headers: { "Cache-Control": "no-store" },
  });
}

export function assertRDPBrowserOrigin(request: Request) {
  const value = request.headers.get("origin");
  const host = request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.slice(0, -1);
  let origin: URL;
  try { origin = new URL(value ?? ""); } catch { throw new RDPError("FORBIDDEN"); }
  if (!host || !["http", "https"].includes(protocol) || origin.username || origin.password ||
      value !== origin.origin || origin.host !== host.toLowerCase() || origin.protocol !== protocol + ":") {
    throw new RDPError("FORBIDDEN");
  }
}

export async function readRDPBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new RDPError("INVALID_REQUEST", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); throw new RDPError("INVALID_REQUEST", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new RDPError("INVALID_REQUEST", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RDPError("INVALID_REQUEST", 400);
  return body as Record<string, unknown>;
}

async function mayManage(admin: Admin, organizationId: string, userId: string) {
  const { data: org, error } = await admin.from("organizations").select("owner_id").eq("id", organizationId).maybeSingle();
  if (error) throw new Error("ORGANIZATION_LOOKUP_FAILED");
  if (org?.owner_id === userId) return true;
  const { data: member, error: memberError } = await admin.from("organization_members").select("role")
    .eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
  if (memberError) throw new Error("MEMBERSHIP_LOOKUP_FAILED");
  return !!org && member?.role === "admin";
}

async function devicePolicy(admin: Admin, deviceId: string) {
  const { data: device, error } = await admin.from("devices")
    .select("id, client_id, last_seen, capabilities").eq("id", deviceId).maybeSingle();
  if (error) throw new Error("DEVICE_LOOKUP_FAILED");
  if (!device) throw new RDPError("DEVICE_NOT_FOUND", 404);
  const { data: client, error: clientError } = await admin.from("clients").select("organization_id").eq("id", device.client_id).single();
  if (clientError || !client) throw new Error("CLIENT_LOOKUP_FAILED");
  const { data: settings, error: settingsError } = await admin.from("organization_remote_access_settings")
    .select("remote_access_enabled, rdp_enabled, max_session_minutes, max_concurrent_sessions, idle_timeout_minutes")
    .eq("organization_id", client.organization_id).maybeSingle();
  if (settingsError) throw new Error("POLICY_LOOKUP_FAILED");
  return { device, organizationId: String(client.organization_id), settings };
}

function assertPolicy(policy: Awaited<ReturnType<typeof devicePolicy>>) {
  if (!policy.settings?.remote_access_enabled || !policy.settings.rdp_enabled) throw new RDPError("RDP_DISABLED");
  if (!rdpOnline(policy.device.last_seen)) throw new RDPError("DEVICE_OFFLINE", 409);
  if (policy.device.capabilities?.rdp !== true || policy.device.capabilities?.tcp_tunnel !== true) {
    throw new RDPError("RDP_UNSUPPORTED", 409);
  }
  return rdpLimits(policy.settings);
}

export async function issueRDPTicket(sessionId: string, role: Ticket["role"]) {
  const ticket = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(ticket).digest("hex");
  const result = await getRedis().set(`sentinelgrid:rdp-ticket:${hash}`, { sessionId, role }, { ex: RDP_TICKET_SECONDS, nx: true });
  if (result !== "OK") throw new Error("TICKET_CREATE_FAILED");
  rdpLog("ticket created", { sessionId, role, ttlSeconds: RDP_TICKET_SECONDS });
  return ticket;
}

export async function consumeRDPTicket(ticket: unknown): Promise<Ticket> {
  if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new RDPError("INVALID_TICKET", 401);
  const hash = createHash("sha256").update(ticket).digest("hex");
  const value = await getRedis().getdel<Ticket>(`sentinelgrid:rdp-ticket:${hash}`);
  if (!value || !UUID.test(value.sessionId) || !["agent", "client"].includes(value.role)) throw new RDPError("INVALID_TICKET", 401);
  rdpLog("ticket redeemed", { sessionId: value.sessionId, role: value.role });
  return value;
}

export async function createRDPSession(deviceId: string, reason: unknown) {
  rdpLog("create requested", { deviceId });
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 240) throw new RDPError("SESSION_REASON_REQUIRED", 400);
  if (!UUID.test(deviceId)) throw new RDPError("DEVICE_NOT_FOUND", 404);
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new RDPError("UNAUTHORIZED", 401);
  rdpLog("authentication ok", { deviceId, userId: user.id });
  await enforceRemoteRateLimit(user.id, "sessions");
  const admin = createAdminClient();
  const policy = await devicePolicy(admin, deviceId);
  if (!await mayManage(admin, policy.organizationId, user.id)) throw new RDPError("FORBIDDEN");
  rdpLog("authorization ok", { deviceId, organizationId: policy.organizationId, userId: user.id });
  assertPolicy(policy);
  rdpLog("policy ok", { deviceId, organizationId: policy.organizationId });
  const relay = relayURL(process.env.SENTINELGRID_RELAY_URL);
  if (!/^[a-f0-9]{64}$/i.test(process.env.SENTINELGRID_RDP_RELAY_SECRET ?? "")) throw new Error("RDP_NOT_CONFIGURED");
  const { data: sessionId, error: createError } = await admin.rpc("create_rdp_session", {
    p_device_id: deviceId, p_user_id: user.id, p_reason: reason.trim(),
  });
  if (createError) throw new Error("SESSION_CREATE_FAILED");
  if (typeof sessionId !== "string") throw new RDPError("SESSION_LIMIT_REACHED", 409);
  const session = await loadRDPSession(sessionId);
  rdpLog("session created", { sessionId: session.id, deviceId, organizationId: session.organization_id });
  try {
    await publishRealtimeMessage(agentCommandChannel(deviceId), { type: "rdp_available" });
    rdpLog("realtime published", { sessionId: session.id, deviceId, channel: agentCommandChannel(deviceId) });
    const ticket = await issueRDPTicket(session.id, "client");
    return { sessionId: session.id, expiresAt: session.expires_at, connection: {
      version: 1, relay, ticket, expires_at: new Date(Date.now() + RDP_TICKET_SECONDS * 1000).toISOString(),
    } };
  } catch (error) {
    await finishRDPSession(session, "failed");
    throw error;
  }
}

export async function loadRDPSession(id: string): Promise<RDPSession> {
  if (!UUID.test(id)) throw new RDPError("SESSION_NOT_FOUND", 404);
  const { data, error } = await createAdminClient().from("rdp_sessions")
    .select("id, organization_id, device_id, requested_by, status, expires_at, created_at, relay_seen_at").eq("id", id).maybeSingle();
  if (error) throw new Error("SESSION_LOOKUP_FAILED");
  if (!data) throw new RDPError("SESSION_NOT_FOUND", 404);
  return data;
}

export async function assertLiveRDPSession(session: RDPSession) {
  relayURL(process.env.SENTINELGRID_RELAY_URL);
  if (!Number.isFinite(Date.parse(session.created_at)) || !Number.isFinite(Date.parse(session.expires_at))) throw new RDPError("INVALID_SESSION_STATE", 503);
  if (!RDP_ACTIVE_STATUSES.includes(session.status) || Date.parse(session.expires_at) <= Date.now() ||
      (session.status === "requested" && Date.parse(session.created_at) + 60_000 <= Date.now())) {
    throw new RDPError("SESSION_ENDED", 410);
  }
  const admin = createAdminClient();
  const policy = await devicePolicy(admin, session.device_id);
  const limits = assertPolicy(policy);
  if (Date.parse(session.created_at) + limits.minutes * 60_000 <= Date.now() ||
      (session.status === "active" && (!session.relay_seen_at || Date.parse(session.relay_seen_at) + 30_000 < Date.now()))) throw new RDPError("SESSION_ENDED", 410);
  if (policy.organizationId !== session.organization_id || !await mayManage(admin, session.organization_id, session.requested_by)) {
    throw new RDPError("FORBIDDEN");
  }
  const idleMinutes = policy.settings?.idle_timeout_minutes;
  if (typeof idleMinutes !== "number" || !Number.isInteger(idleMinutes) || idleMinutes < 1 || idleMinutes > 120) throw new Error("RDP_POLICY_INVALID");
  return idleMinutes * 60;
}

export async function finishRDPSession(session: RDPSession, status: "closed" | "failed") {
  const { error } = await createAdminClient().rpc("finish_rdp_session", { p_session_id: session.id, p_status: status });
  if (error) throw new Error("SESSION_CLOSE_FAILED");
  rdpLog("session finished", { sessionId: session.id, deviceId: session.device_id, status });
}

export async function browserRDPSession(deviceId: string, sessionId: string) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new RDPError("UNAUTHORIZED", 401);
  const session = await loadRDPSession(sessionId);
  if (session.device_id !== deviceId || !await mayManage(createAdminClient(), session.organization_id, user.id)) {
    throw new RDPError("FORBIDDEN");
  }
  return session;
}

export function authenticateRDPRelay(request: Request) {
  const expected = process.env.SENTINELGRID_RDP_RELAY_SECRET ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(supplied) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw new RDPError("UNAUTHORIZED", 401);
}
