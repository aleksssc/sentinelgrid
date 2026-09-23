import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, CheckCircle2, Download, ExternalLink, Server, TriangleAlert } from "lucide-react";
import { getOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
import { compareVersions } from "@/lib/agent/update-policy";
import { isExpectedUpdateResult } from "@/lib/agent/update-status";
import { StatusBadge, type StatusTone } from "@/components/dashboard/dashboard-badges";
import { CompactSummary, EmptyState, PageHeader, SectionHeader, Surface } from "@/components/dashboard/dashboard-primitives";

type AgentDevice = { id: string; hostname: string | null; display_name: string | null; status: string | null; last_seen: string | null; agent_version: string | null; capabilities: { agent_update?: boolean } | null; clients: { id: string; name: string; organization_id: string } };
type UpdateCommand = { device_id: string; status: string | null; created_at: string; error_code: string | null; error_message: string | null };
type AgentRelease = { version: string; is_active: boolean | null };

const heartbeatWindow = 90_000;
const legacyBefore = "0.1.8";

function operationalStatus(device: AgentDevice, now: number): { label: string; tone: StatusTone } {
  const lastSeen = Date.parse(device.last_seen ?? "");
  if (!Number.isFinite(lastSeen) || now - lastSeen > heartbeatWindow || device.status === "offline") return { label: "Offline", tone: "danger" };
  if (device.status === "warning") return { label: "Warning", tone: "warning" };
  return { label: "Healthy", tone: "success" };
}

function updateStatus(device: AgentDevice, latestVersion: string | null, failed: boolean): { label: string; tone: StatusTone } {
  if (!device.agent_version?.trim()) return { label: "Bootstrap required", tone: "warning" };
  try {
    if (compareVersions(device.agent_version, legacyBefore) < 0) return { label: "Legacy", tone: "warning" };
    if (device.capabilities?.agent_update !== true) return { label: "Bootstrap required", tone: "warning" };
    if (latestVersion && compareVersions(device.agent_version, latestVersion) >= 0) return { label: "Up to date", tone: "success" };
    if (failed) return { label: "Update failed", tone: "danger" };
    if (latestVersion) return { label: "Outdated", tone: "warning" };
    return { label: "Not checked", tone: "neutral" };
  } catch { return { label: "Not checked", tone: "neutral" }; }
}

function formatLastCommunication(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

export default async function AgentsPage() {
  const { user, organization } = await getOrganizationContext();
  if (!user) redirect("/auth/login");
  if (!organization) redirect("/onboarding");
  const supabase = await createClient();
  const now = Date.now();
  const [{ data: devices, error: devicesError }, { data: updateCommands, error: updatesError }, { data: releases, error: releasesError }] = await Promise.all([
    supabase.from("devices").select("id, hostname, display_name, status, last_seen, agent_version, capabilities, clients!inner(id, name, organization_id)").eq("clients.organization_id", organization.id).order("last_seen", { ascending: false, nullsFirst: true }).returns<AgentDevice[]>(),
    supabase.from("device_commands").select("device_id, status, created_at, error_code, error_message").eq("organization_id", organization.id).eq("command_type", "update_agent").eq("status", "failed").order("created_at", { ascending: false }).limit(200).returns<UpdateCommand[]>(),
    supabase.from("agent_releases").select("version, is_active").eq("platform", "windows").eq("architecture", "amd64").eq("is_active", true).limit(100).returns<AgentRelease[]>(),
  ]);
  if (devicesError) console.error("[Agents] Device inventory query failed:", devicesError);
  if (updatesError) console.error("[Agents] Update command query failed:", updatesError);
  if (releasesError) console.error("[Agents] Release query failed:", releasesError);
  const latestVersion = (releases ?? []).reduce<string | null>((latest, release) => { try { return !latest || compareVersions(release.version, latest) > 0 ? release.version : latest; } catch { return latest; } }, null);
  const fleet = devices ?? [];
  const latestFailures = new Map<string, UpdateCommand>();
  for (const command of updateCommands ?? []) if (!isExpectedUpdateResult(command.error_code) && !latestFailures.has(command.device_id)) latestFailures.set(command.device_id, command);
  const installed = fleet.filter((device) => Boolean(device.agent_version?.trim()));
  const healthy = fleet.filter((device) => operationalStatus(device, now).label === "Healthy");
  const outdated = fleet.filter((device) => updateStatus(device, latestVersion, latestFailures.has(device.id)).label === "Outdated");
  const versions = new Map<string, number>();
  for (const device of installed) versions.set(device.agent_version!, (versions.get(device.agent_version!) ?? 0) + 1);

  return <div className="sg-page-shell"><div className="sg-page">
    <PageHeader title="Agents" eyebrow="Fleet management" icon={<Bot size={22} />} description="Manage Agent health, versions, updates and deployment status across your organization." />
    <CompactSummary label="Agent fleet summary" items={[
      { label: "Installed", value: installed.length, icon: <Bot size={14} /> },
      { label: "Healthy", value: healthy.length, icon: <CheckCircle2 size={14} />, tone: healthy.length ? "success" : "neutral" },
      { label: "Outdated", value: releasesError ? "--" : outdated.length, icon: <Download size={14} />, tone: outdated.length ? "warning" : "neutral" },
      { label: "Update failures", value: updatesError ? "--" : latestFailures.size, icon: <TriangleAlert size={14} />, tone: latestFailures.size ? "danger" : "neutral" },
    ]} />
    <div className="sg-agent-layout">
      <Surface className="overflow-hidden" aria-labelledby="agent-fleet-title">
        <SectionHeader title="Agent fleet" description={latestVersion ? `Operational health and update compatibility. Latest release: v${latestVersion}.` : "Operational health and update compatibility from reported telemetry."} icon={<Server size={17} />} />
        {devicesError ? <div role="alert" className="sg-inline-notice">The Agent fleet could not be loaded. Refresh to retry.</div> : !fleet.length ? <EmptyState title="No Agents installed" description="Devices appear here after a SentinelGrid Agent reports its inventory." icon={<Bot size={22} />} /> : <div className="divide-y divide-surface-edge">
          <div className="sg-table-heading hidden gap-4 px-5 py-3 lg:grid lg:grid-cols-[minmax(0,1.35fr)_0.7fr_0.75fr_0.9fr_0.8fr_0.55fr_auto]"><span>Device</span><span>Agent version</span><span>Status</span><span>Update status</span><span>Last communication</span><span>Channel</span><span>Actions</span></div>
          {fleet.map((device) => {
            const status = operationalStatus(device, now); const failed = latestFailures.get(device.id); const update = updateStatus(device, latestVersion, Boolean(failed)); const href = `/dashboard/organizations/${organization.id}/clients/${device.clients.id}`;
            return <div key={device.id} className="sg-row grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1.35fr)_0.7fr_0.75fr_0.9fr_0.8fr_0.55fr_auto] lg:items-center">
              <div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-100">{device.display_name || device.hostname || "Unnamed device"}</p><p className="mt-1 truncate text-xs text-surface-muted">{device.clients.name}</p></div>
              <AgentField label="Agent version" value={device.agent_version ? `v${device.agent_version}` : "Not reported"} mono />
              <AgentField label="Status" value={<StatusBadge status={status.label} tone={status.tone}>{status.label}</StatusBadge>} />
              <AgentField label="Update status" value={<StatusBadge title={update.label === "Update failed" ? failed?.error_message || failed?.error_code || undefined : undefined} status={update.label} tone={update.tone}>{update.label}</StatusBadge>} />
              <AgentField label="Last communication" value={formatLastCommunication(device.last_seen)} />
              <AgentField label="Channel" value="Unknown" />
              <Link aria-label={`View ${device.display_name || device.hostname || "device"}`} href={href} className="sg-button sg-button-secondary sg-button-sm justify-self-start lg:justify-self-end"><ExternalLink size={14} /><span className="lg:sr-only">View device</span></Link>
            </div>;
          })}
        </div>}
      </Surface>
      <Surface aria-labelledby="version-distribution-title">
        <SectionHeader title="Version distribution" description="Versions reported by installed Agents." icon={<Bot size={17} />} />
        {versions.size ? <dl className="sg-version-list">{[...versions.entries()].sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true })).map(([version, count]) => { const state = updateStatus({ agent_version: version, capabilities: { agent_update: version !== "0.1.8" }, id: "", hostname: null, display_name: null, status: null, last_seen: null, clients: { id: "", name: "", organization_id: "" } }, latestVersion, false); return <div key={version}><dt>v{version}</dt><dd>{count} device{count === 1 ? "" : "s"}</dd><StatusBadge status={state.label} tone={state.tone}>{state.label}</StatusBadge></div>; })}</dl> : <p className="p-5 text-sm text-surface-muted">No Agent versions have been reported yet.</p>}
      </Surface>
    </div>
  </div></div>;
}
function AgentField({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) { return <div className="flex items-center justify-between gap-3 lg:block"><p className="sg-meta lg:hidden">{label}</p><div className={mono ? "font-mono text-xs text-zinc-300" : "text-xs text-zinc-300"}>{value}</div></div>; }
