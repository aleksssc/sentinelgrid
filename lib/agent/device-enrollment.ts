import { createHash, randomBytes, randomUUID } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { ResourceCreationError, requireOrganizationResourceCreation } from "@/lib/resource-creation";

type EnrollAgentInput = {
  token: string;
  hostname: string;
  os: string;
  arch?: string | null;
  localIp?: string | null;
  macAddress?: string | null;
  capabilities?: Record<string, unknown> | null;
};

export async function enrollAgent({ token, hostname, os, arch, localIp, macAddress, capabilities }: EnrollAgentInput) {
  const admin = createAdminClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: enrollmentToken, error: tokenError } = await admin
    .from("agent_enrollment_tokens")
    .select("id, organization_id, client_id, site_id, created_by, expires_at, used_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (tokenError || !enrollmentToken) throw new Error("INVALID_TOKEN");
  if (enrollmentToken.revoked_at) throw new Error("TOKEN_REVOKED");
  if (enrollmentToken.used_at) throw new Error("TOKEN_ALREADY_USED");
  if (new Date(enrollmentToken.expires_at).getTime() < Date.now()) throw new Error("TOKEN_EXPIRED");

  const now = new Date().toISOString();
  const { data: claimedToken, error: claimError } = await admin
    .from("agent_enrollment_tokens")
    .update({ used_at: now })
    .eq("id", enrollmentToken.id)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .select("id")
    .maybeSingle();
  if (claimError || !claimedToken) throw new Error("TOKEN_UNAVAILABLE");

  try {
    // Revalidate at enrollment time because token issuance and consumption can be separated.
    await requireOrganizationResourceCreation(admin, enrollmentToken.organization_id, enrollmentToken.created_by, "devices");
  } catch (error) {
    await admin.from("agent_enrollment_tokens").update({ used_at: null }).eq("id", enrollmentToken.id).eq("used_at", now);
    if (error instanceof ResourceCreationError) throw error;
    console.error("Enrollment resource access check failed:", error);
    throw new Error("ENROLLMENT_ACCESS_CHECK_FAILED");
  }

  const agentId = randomUUID();
  const agentToken = `SG-AGENT-${randomBytes(48).toString("hex")}`;
  const agentTokenHash = createHash("sha256").update(agentToken).digest("hex");
  const { data: device, error: deviceError } = await admin.from("devices").insert({
    client_id: enrollmentToken.client_id,
    site_id: enrollmentToken.site_id,
    hostname,
    display_name: hostname,
    os,
    arch: arch ?? null,
    local_ip: localIp ?? null,
    mac_address: macAddress ?? null,
    capabilities: normalizeCapabilities(capabilities),
    status: "online",
    agent_id: agentId,
    agent_token_hash: agentTokenHash,
    enrolled_at: now,
    last_seen: now,
  }).select("id, agent_id").single();

  if (deviceError || !device) {
    console.error("Device enrollment error:", deviceError);
    await admin.from("agent_enrollment_tokens").update({ used_at: null }).eq("id", enrollmentToken.id);
    if (deviceError?.message?.includes("LIMIT_REACHED")) throw new ResourceCreationError("LIMIT_REACHED");
    throw new Error("DEVICE_CREATION_FAILED");
  }
  return { deviceId: device.id, agentId: device.agent_id, agentToken };
}

function normalizeCapabilities(value?: Record<string, unknown> | null) {
  const names = ["agent_update", "commands", "terminal", "force_inventory", "restart_agent", "services", "software", "security", "tcp_tunnel", "rdp"];
  return Object.fromEntries(names.map((name) => [name, value?.[name] === true]));
}
