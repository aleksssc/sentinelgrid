import "server-only";

import { createClient } from "@/lib/supabase/server";
import { humanizeActivity, normalizeDeviceActivity, type DeviceActivityCommand } from "@/lib/activity/device-activity";
import { completionNotice } from "@/lib/remote/action-feedback";
import {
  PAGE_SIZE, pageRows, searchPattern, formatOperationsTime,
  type OperationsFilters, type OperationsResult, type OperationRow,
} from "@/lib/operations/filters";

type DeviceContext = {
  id: string;
  display_name: string | null;
  hostname: string | null;
  clients: { id: string; name: string; organization_id: string };
  sites: { name: string } | null;
};
type AuditFailure = {
  id: string;
  action: string;
  target_id: string | null;
  target_type: string | null;
  target_name: string | null;
  actor_email: string | null;
  created_at: string;
  error_code: string | null;
  error_message: string | null;
};

export async function loadIncidents(organizationId: string, filters: OperationsFilters, now: number): Promise<OperationsResult> {
  const supabase = await createClient();
  const since = new Date(now - filters.days * 86_400_000).toISOString();
  const offset = (filters.page - 1) * PAGE_SIZE;
  const queryText = searchPattern(filters.query);
  let commands: DeviceActivityCommand[] = [];
  let audits: AuditFailure[] = [];
  let hasNext = false;

  if (filters.source === "commands") {
    let query = supabase.from("device_commands")
      .select("id, device_id, command_type, status, created_at, requested_by, dispatched_at, acknowledged_at, started_at, completed_at, error_code, error_message, result, update_transaction_id")
      .eq("organization_id", organizationId)
      .in("status", filters.status === "all" ? ["failed", "expired"] : [filters.status])
      .or("error_code.is.null,error_code.not.in.(NO_NEWER_AGENT_VERSION,NO_ELIGIBLE_AGENT_RELEASE)")
      .gte("created_at", since)
      .lte("created_at", new Date(now).toISOString());
    if (filters.query) query = query.or(`command_type.ilike.${queryText},error_code.ilike.${queryText},error_message.ilike.${queryText}`);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE).abortSignal(AbortSignal.timeout(8_000)).returns<DeviceActivityCommand[]>();
    if (error) {
      console.error("[Incidents] Command query failed:", error);
      return { rows: [], hasNext: false, error: "Command failures could not be loaded. Refresh to retry; audit exceptions remain available in their tab." };
    }
    const page = pageRows(data ?? [], filters.page);
    commands = page.rows;
    hasNext = page.hasNext;
  } else {
    let query = supabase.from("audit_logs")
      .select("id, action, target_id, target_type, target_name, actor_email, created_at, error_code:metadata->>error_code, error_message:metadata->>error_message")
      .eq("organization_id", organizationId).eq("status", "failed")
      .not("action", "like", "device.command.%")
      .is("metadata->>commandId", null).is("metadata->>command_id", null)
      .is("metadata->>transactionId", null).is("metadata->>transaction_id", null)
      .gte("created_at", since).lte("created_at", new Date(now).toISOString());
    if (filters.query) query = query.or(`action.ilike.${queryText},target_name.ilike.${queryText},actor_email.ilike.${queryText}`);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE).abortSignal(AbortSignal.timeout(8_000)).returns<AuditFailure[]>();
    if (error) {
      console.error("[Incidents] Audit query failed:", error);
      return { rows: [], hasNext: false, error: "Audit exceptions could not be loaded. Refresh to retry; command failures remain available in their tab." };
    }
    const page = pageRows(data ?? [], filters.page);
    audits = page.rows;
    hasNext = page.hasNext;
  }

  const deviceIds = [...new Set([
    ...commands.map((command) => command.device_id),
    ...audits.filter((event) => event.target_type === "device").map((event) => event.target_id),
  ].filter((id): id is string => Boolean(id && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))))];
  let devices: DeviceContext[] = [];
  let contextError: string | null = null;
  if (deviceIds.length) {
    const { data, error } = await supabase.from("devices")
      .select("id, display_name, hostname, clients!inner(id, name, organization_id), sites(name)")
      .eq("clients.organization_id", organizationId).in("id", deviceIds)
      .limit(PAGE_SIZE).abortSignal(AbortSignal.timeout(8_000)).returns<DeviceContext[]>();
    if (error) {
      console.error("[Incidents] Device context query failed:", error);
      contextError = "Device names and links could not be loaded. Recorded failures are still shown; refresh to retry.";
    } else devices = data ?? [];
  }
  const byId = new Map(devices.map((device) => [device.id, device]));
  const deviceFields = (deviceId: string | null) => {
    const device = deviceId ? byId.get(deviceId) : undefined;
    if (!device || device.clients.organization_id !== organizationId) return undefined;
    return {
      target: device.display_name || device.hostname || "Unnamed device",
      context: [device.clients.name, device.sites?.name].filter(Boolean).join(" / "),
      href: `/dashboard/organizations/${organizationId}/clients/${device.clients.id}`,
      linkLabel: "Open client devices",
    };
  };

  const rows: OperationRow[] = filters.source === "commands" ? commands.map((command) => {
    const [entry] = normalizeDeviceActivity([], [command], command.device_id);
    const notice = completionNotice(command.command_type, { ...command });
    const informational = notice.tone === "info";
    const details = [
      { label: "Command ID", value: command.id },
      { label: "Device ID", value: command.device_id },
      { label: "Recorded status", value: command.status },
      { label: "Requested (UTC)", value: formatOperationsTime(command.created_at) },
      { label: "Completed (UTC)", value: formatOperationsTime(command.completed_at) },
    ];
    if (command.requested_by) details.push({ label: "Requested by (user ID)", value: command.requested_by });
    if (entry.errorCode) details.push({ label: "Error code", value: entry.errorCode });
    if (entry.errorMessage) details.push({ label: "Recorded error", value: entry.errorMessage.slice(0, 2048) });
    if (entry.transactionId) details.push({ label: "Update transaction ID", value: entry.transactionId });
    if (entry.targetVersion) details.push({ label: "Recorded update version", value: entry.fromVersion ? `${entry.fromVersion} -> ${entry.targetVersion}` : entry.targetVersion });
    if (entry.duration) details.push({ label: "Duration", value: entry.duration });
    return {
      id: command.id, title: notice.title, description: notice.message,
      status: informational ? "Information" : humanizeActivity(command.status), tone: informational ? "info" : "error",
      target: "Device unavailable", context: "The device may have been removed or is not visible to your account.",
      ...deviceFields(command.device_id), timestamp: command.created_at, timeLabel: "Requested", details,
    };
  }) : audits.map((event) => ({
    id: event.id, title: humanizeActivity(event.action),
    description: event.error_message?.slice(0, 512) || "A failed operation was recorded in the organization audit log.",
    status: "Failed", tone: "error", target: event.target_name || "Organization event",
    context: event.actor_email || "Actor not recorded", ...deviceFields(event.target_type === "device" ? event.target_id : null),
    timestamp: event.created_at, timeLabel: "Recorded",
    details: [
      { label: "Audit ID", value: event.id }, { label: "Action", value: event.action },
      { label: "Actor", value: event.actor_email || "Not recorded" },
      { label: "Target type", value: event.target_type || "Not recorded" },
      { label: "Target ID", value: event.target_id || "Not recorded" },
      ...(event.error_code ? [{ label: "Error code", value: event.error_code }] : []),
    ],
  }));
  return { rows, hasNext, error: contextError };
}
