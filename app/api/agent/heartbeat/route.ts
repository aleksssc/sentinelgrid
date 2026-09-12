import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const headers = { "Cache-Control": "no-store" };
const metricNames = ["cpu_usage", "ram_usage", "ram_total_bytes", "ram_used_bytes", "disk_usage", "disk_total_bytes", "disk_used_bytes", "uptime_seconds"];
const inventoryNames = ["hostname", "os", "os_version", "os_build", "arch", "device_type", "local_ip", "mac_address", "manufacturer", "model", "serial_number", "cpu_name", "agent_version"];
const capabilityNames = ["agent_update", "commands", "terminal", "force_inventory", "restart_agent", "services", "software", "security", "tcp_tunnel", "rdp"];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Invalid heartbeat JSON." }, { status: 400, headers }); }
    if (!record(body)) return NextResponse.json({ error: "Invalid heartbeat." }, { status: 400, headers });
    const authorization = request.headers.get("authorization") ?? "";
    const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] || text(body.agent_token) || text(body.token);
    if (!token || token.length > 512) return NextResponse.json({ error: "Missing or invalid agent token." }, { status: 401, headers });
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status: "online", last_seen: now };
    const publicIP = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim();
    if (publicIP) update.public_ip = publicIP;
    for (const name of metricNames) {
      if (typeof body[name] === "number" && Number.isFinite(body[name])) update[name] = body[name];
    }
    if (record(body.inventory)) {
      const inventory = body.inventory;
      for (const name of inventoryNames) {
        const value = text(inventory[name]);
        if (value) update[name] = value;
      }
      if (typeof inventory.ram_total_bytes === "number" && Number.isFinite(inventory.ram_total_bytes)) update.ram_total_bytes = inventory.ram_total_bytes;
      if (record(inventory.capabilities)) {
        const capabilities = inventory.capabilities;
        update.capabilities = Object.fromEntries(capabilityNames.map((name) => [name, capabilities[name] === true]));
      }
      update.last_inventory_at = now;
    }
    // Token authentication and telemetry update share one database statement, including token revocation races.
    const { data: device, error } = await admin.from("devices").update(update)
      .eq("agent_token_hash", createHash("sha256").update(token).digest("hex"))
      .select("id, capabilities").maybeSingle();
    if (error) {
      console.error("[Heartbeat] DEVICE_UPDATE_FAILED", error.code);
      return NextResponse.json({ error: "Could not update device." }, { status: 503, headers });
    }
    if (!device) return NextResponse.json({ error: "Invalid agent token." }, { status: 401, headers });
    let rdpPending: boolean | undefined;
    if (body.rdp_control === true) {
      rdpPending = false;
      if (process.env.SENTINELGRID_RELAY_URL && device.capabilities?.rdp === true) {
        const { data: session, error: sessionError } = await admin.from("rdp_sessions").select("id")
          .eq("device_id", device.id).eq("status", "requested")
          .gt("created_at", new Date(Date.now() - 60000).toISOString()).limit(1).maybeSingle();
        if (sessionError) {
          // Preserve liveness/health and explicitly withdraw negotiation: the Agent resumes its legacy fallback.
          console.error("[Heartbeat] RDP_DISCOVERY_FAILED", sessionError.code);
          rdpPending = undefined;
        } else { rdpPending = !!session; }
      }
    }
    return NextResponse.json({ ok: true, device_id: device.id, rdp_pending: rdpPending }, { headers });
  } catch {
    console.error("[Heartbeat] HEARTBEAT_FAILED");
    return NextResponse.json({ error: "Internal server error." }, { status: 500, headers });
  }
}
