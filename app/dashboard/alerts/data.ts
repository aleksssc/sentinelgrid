import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  PAGE_SIZE, pageRows, searchPattern, deviceAttentionFilter, deviceSignal, formatOperationsTime,
  type OperationsFilters, type OperationsResult, type OperationRow,
} from "@/lib/operations/filters";

type AttentionDevice = {
  id: string;
  hostname: string | null;
  display_name: string | null;
  status: string | null;
  last_seen: string | null;
  agent_version: string | null;
  clients: { id: string; name: string; organization_id: string };
  sites: { name: string } | null;
};
type AttentionMonitor = {
  id: string;
  name: string;
  status: string | null;
  status_code: number | null;
  response_time_ms: number | null;
  last_checked_at: string | null;
};

export async function loadAlerts(organizationId: string, userId: string, filters: OperationsFilters, now: number): Promise<OperationsResult> {
  const supabase = await createClient();
  const offset = (filters.page - 1) * PAGE_SIZE;
  const queryText = searchPattern(filters.query);
  if (filters.source === "devices") {
    let query = supabase.from("devices")
      .select("id, hostname, display_name, status, last_seen, agent_version, clients!inner(id, name, organization_id), sites(name)")
      .eq("clients.organization_id", organizationId)
      .or(deviceAttentionFilter(filters.status, now));
    if (filters.query) query = query.or(`hostname.ilike.${queryText},display_name.ilike.${queryText}`);
    const { data, error } = await query.order("last_seen", { ascending: false, nullsFirst: true }).order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE).abortSignal(AbortSignal.timeout(8_000)).returns<AttentionDevice[]>();
    if (error) {
      console.error("[Alerts] Device query failed:", error);
      return { rows: [], hasNext: false, error: "Device signals could not be loaded. Refresh to retry; personal monitors remain available in their tab." };
    }
    const page = pageRows(data ?? [], filters.page);
    const rows: OperationRow[] = page.rows.map((device) => {
      const signal = deviceSignal(device.status, device.last_seen, now);
      return {
        id: device.id, title: signal === "offline" ? (device.last_seen ? "Device is offline" : "No heartbeat received") : "Device reports a warning",
        description: signal === "warning" ? "The device reported a warning state. Review its inventory and Activity for context." :
          !device.last_seen ? "This device has not sent a heartbeat. Check enrollment and Agent connectivity." :
          "The Agent has stopped heartbeating or the device reports offline. This is a connectivity signal, not proof of an outage.",
        status: signal === "offline" ? "Offline" : "Warning", tone: signal === "offline" ? "error" : "warning",
        target: device.display_name || device.hostname || "Unnamed device",
        context: [device.clients.name, device.sites?.name].filter(Boolean).join(" / "),
        timestamp: device.last_seen, timeLabel: "Last heartbeat",
        href: `/dashboard/organizations/${organizationId}/clients/${device.clients.id}`, linkLabel: "Open client devices",
        details: [
          { label: "Device ID", value: device.id },
          { label: "Hostname", value: device.hostname || "Not recorded" },
          { label: "Client", value: device.clients.name },
          { label: "Site", value: device.sites?.name || "No site assigned" },
          { label: "Agent version", value: device.agent_version || "Not recorded" },
          { label: "Reported status", value: device.status || "Not recorded" },
          { label: "Last heartbeat (UTC)", value: formatOperationsTime(device.last_seen) },
          { label: "Detection", value: "Offline after more than 90 seconds without a heartbeat, or a recorded offline state. A last heartbeat is not an incident start time." },
        ],
      };
    });
    return { rows, hasNext: page.hasNext, error: null };
  }

  // Monitors currently belong to user_id, not an organization. Never infer tenant ownership.
  let query = supabase.from("monitors")
    .select("id, name, status, status_code, response_time_ms, last_checked_at")
    .eq("user_id", userId);
  if (filters.status === "offline") query = query.eq("status", "offline").not("last_checked_at", "is", null);
  else if (filters.status === "unchecked") query = query.is("last_checked_at", null);
  else query = query.or("status.eq.offline,last_checked_at.is.null");
  if (filters.query) query = query.or(`name.ilike.${queryText}`);
  const { data, error } = await query.order("last_checked_at", { ascending: false, nullsFirst: true }).order("id", { ascending: false })
    .range(offset, offset + PAGE_SIZE).abortSignal(AbortSignal.timeout(8_000)).returns<AttentionMonitor[]>();
  if (error) {
    console.error("[Alerts] Monitor query failed:", error);
    return { rows: [], hasNext: false, error: "Personal monitor signals could not be loaded. Refresh to retry; organization devices remain available in their tab." };
  }
  const page = pageRows(data ?? [], filters.page);
  const rows: OperationRow[] = page.rows.map((monitor) => {
    const unchecked = !monitor.last_checked_at;
    return {
      id: monitor.id, title: unchecked ? "Monitor has not been checked" : "Monitor check failed",
      description: unchecked ? "Run a check from Monitors to establish a real availability result." :
        "The last recorded check was unsuccessful. Open the monitor history to investigate; this is not a continuous uptime guarantee.",
      status: unchecked ? "Not checked" : "Offline", tone: unchecked ? "warning" : "error",
      target: monitor.name || "Unnamed monitor", context: "Personal monitor / Only visible to your account",
      timestamp: monitor.last_checked_at, timeLabel: "Last check",
      href: `/dashboard/monitors/${monitor.id}`, linkLabel: "Open monitor history",
      details: [
        { label: "Monitor ID", value: monitor.id },
        { label: "HTTP status", value: monitor.status_code === null ? "Not recorded" : String(monitor.status_code) },
        { label: "Response time", value: monitor.response_time_ms === null ? "Not recorded" : `${monitor.response_time_ms} ms` },
        { label: "Last check (UTC)", value: formatOperationsTime(monitor.last_checked_at) },
        { label: "Scope", value: "Your account. The current monitor backend has no organization relationship." },
      ],
    };
  });
  return { rows, hasNext: page.hasNext, error: null };
}
