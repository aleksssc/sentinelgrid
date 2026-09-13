import Link from "next/link";
import { Activity, Bot, Building2, ClipboardList, MonitorDot, RadioTower, Server, TriangleAlert, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isExpectedUpdateResult } from "@/lib/agent/update-status";
import { CompactSummary, PageHeader, SectionHeader, Surface } from "@/components/dashboard/dashboard-primitives";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";

type UpdateResult = { error_code: string | null };
async function count(table: string) { const { count, error } = await createAdminClient().from(table).select("*", { count: "exact", head: true }); return error ? null : count ?? 0; }

export default async function AdminOverviewPage() {
  const admin = createAdminClient();
  const [organizations, users, clients, devices, monitors, updateResults, onlineAgents] = await Promise.all([
    count("organizations"), admin.auth.admin.listUsers({ page: 1, perPage: 1 }).then(({ data, error }) => error ? null : data.total), count("clients"), count("devices"), count("monitors"),
    admin.from("device_commands").select("error_code").eq("command_type", "update_agent").eq("status", "failed").limit(1000).returns<UpdateResult[]>(),
    admin.from("devices").select("*", { count: "exact", head: true }).eq("status", "online").then(({ count, error }) => error ? null : count ?? 0),
  ]);
  const failedUpdates = updateResults.data ? updateResults.data.filter((command) => !isExpectedUpdateResult(command.error_code)).length : null;
  const services = [
    { name: "Supabase", detail: organizations === null ? "Connection has not been verified" : "Verified through an administration query", status: organizations === null ? "Not checked" : "Connected", tone: organizations === null ? "neutral" as const : "success" as const },
    { name: "SentinelGrid application", detail: "Serving this administration request", status: "Available", tone: "success" as const },
    { name: "Railway relay", detail: "No health check is connected", status: "Not checked", tone: "neutral" as const },
    { name: "Redis", detail: "No health check is connected", status: "Not checked", tone: "neutral" as const },
  ];

  return <>
    <PageHeader title="SentinelGrid Admin" eyebrow="Platform administration" icon={<Activity size={22} />} description="Organizations, users, releases and platform activity." />
    <CompactSummary label="Platform overview" items={[
      { label: "Organizations", value: organizations ?? "--", icon: <Building2 size={14} /> }, { label: "Users", value: users ?? "--", icon: <Users size={14} /> }, { label: "Clients", value: clients ?? "--", icon: <MonitorDot size={14} /> }, { label: "Devices", value: devices ?? "--", icon: <Server size={14} /> }, { label: "Agents online", value: onlineAgents ?? "--", icon: <Bot size={14} />, tone: "success" }, { label: "Monitors", value: monitors ?? "--", icon: <Activity size={14} /> }, { label: "Update failures", value: failedUpdates ?? "--", icon: <TriangleAlert size={14} />, tone: failedUpdates ? "danger" : "neutral" },
    ]} />
    <div className="sg-admin-overview-grid">
      <Surface><SectionHeader title="Platform status" description="Only verified services are shown as connected." icon={<Activity size={17} />} /><dl className="sg-admin-status-list">{services.map((service) => <div key={service.name}><div><dt>{service.name}</dt><dd>{service.detail}</dd></div><StatusBadge status={service.status} tone={service.tone}>{service.status}</StatusBadge></div>)}</dl></Surface>
      <Surface><SectionHeader title="Administration" description="Review platform inventory and operational records." icon={<ClipboardList size={17} />} /><nav className="sg-admin-quick-links" aria-label="Administration shortcuts"><Link href="/admin/organizations"><Building2 size={16} />Organizations</Link><Link href="/admin/users"><Users size={16} />Users</Link><Link href="/admin/agent-releases"><RadioTower size={16} />Agent releases</Link><Link href="/admin/audit"><ClipboardList size={16} />Audit log</Link></nav></Surface>
    </div>
  </>;
}
