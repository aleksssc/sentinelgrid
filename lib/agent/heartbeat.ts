import "server-only";

import { createHash } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";

export async function processHeartbeat(
  agentToken: string
) {
  if (!agentToken) {
    throw new Error("INVALID_AGENT");
  }

  const admin =
    createAdminClient();

  const tokenHash =
    createHash("sha256")
      .update(agentToken)
      .digest("hex");

  const now =
    new Date().toISOString();

  const {
    data,
    error,
  } = await admin
    .from("devices")
    .update({
      last_seen: now,
      status: "online",
    })
    .eq(
      "agent_token_hash",
      tokenHash
    )
    .select(`
      id,
      hostname,
      last_seen,
      status
    `)
    .maybeSingle();

  if (error) {
    console.error(
      "Heartbeat database error:",
      error
    );

    throw new Error(
      "HEARTBEAT_FAILED"
    );
  }

  if (!data) {
    throw new Error(
      "INVALID_AGENT"
    );
  }

  return {
    deviceId: data.id,
    hostname: data.hostname,
    lastSeen: data.last_seen,
    status: data.status,
  };
}