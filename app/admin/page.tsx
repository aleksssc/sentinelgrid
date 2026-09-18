import {
  Activity,
  Bot,
  Building2,
  Server,
  TriangleAlert,
  Users,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isExpectedUpdateResult } from "@/lib/agent/update-status";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import {
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
} from "@/components/admin/admin-primitives";

type UpdateResult = { error_code: string | null };
type AuditRow = {
  id: string;
  action: string;
  actor_email: string | null;
  created_at: string;
  status: string | null;
};

async function count(table: string) {
  const { count, error } = await createAdminClient()
    .from(table)
    .select("*", { count: "exact", head: true });

  return error ? null : count ?? 0;
}

export default async function AdminOverviewPage() {
  const admin = createAdminClient();

  const [
    organizations,
    users,
    devices,
    monitors,
    updateResults,
    onlineAgents,
    auditResult,
  ] = await Promise.all([
    count("organizations"),
    admin.auth.admin
      .listUsers({ page: 1, perPage: 1 })
      .then(({ data, error }) => (error ? null : data.total)),
    count("devices"),
    count("monitors"),
    admin
      .from("device_commands")
      .select("error_code")
      .eq("command_type", "update_agent")
      .eq("status", "failed")
      .limit(1000)
      .returns<UpdateResult[]>(),
    admin
      .from("devices")
      .select("*", { count: "exact", head: true })
      .eq("status", "online")
      .then(({ count, error }) => (error ? null : count ?? 0)),
    admin
      .from("audit_logs")
      .select("id, action, actor_email, created_at, status")
      .order("created_at", { ascending: false })
      .limit(8)
      .returns<AuditRow[]>(),
  ]);

  const failedUpdates = updateResults.data
    ? updateResults.data.filter((command) => !isExpectedUpdateResult(command.error_code)).length
    : null;

  const offlineDevices =
    devices !== null && onlineAgents !== null ? Math.max(devices - onlineAgents, 0) : null;

  const services = [
    {
      name: "SentinelGrid",
      detail: "Administration request is being served.",
      status: "Available",
      tone: "success" as const,
    },
    {
      name: "Supabase",
      detail: organizations === null ? "Connectivity was not verified." : "Server-side query succeeded.",
      status: organizations === null ? "Not checked" : "Connected",
      tone: organizations === null ? ("neutral" as const) : ("success" as const),
    },
    {
      name: "Railway relay",
      detail: "No health endpoint is connected to Admin.",
      status: "Not checked",
      tone: "neutral" as const,
    },
    {
      name: "Redis",
      detail: "No health endpoint is connected to Admin.",
      status: "Not checked",
      tone: "neutral" as const,
    },
  ];

  const attention = [
    ...(failedUpdates && failedUpdates > 0
      ? [{ title: "Agent update failures", detail: `${failedUpdates} unexpected failed update command${failedUpdates === 1 ? "" : "s"}.` }]
      : []),
    ...(offlineDevices && offlineDevices > 0
      ? [{ title: "Devices offline", detail: `${offlineDevices} device${offlineDevices === 1 ? "" : "s"} currently not reported as online.` }]
      : []),
  ];

  return (
    <>
      <AdminPageHeader
        eyebrow="Platform"
        title="Overview"
        description="The operational state of SentinelGrid at a glance."
      />

      <AdminMetricStrip
        label="Platform overview"
        items={[
          { label: "Organizations", value: organizations ?? "—", meta: "Total tenants" },
          { label: "Users", value: users ?? "—", meta: "Authentication accounts" },
          { label: "Devices", value: devices ?? "—", meta: "Managed endpoints" },
          {
            label: "Agents online",
            value: onlineAgents ?? "—",
            meta: devices !== null ? `of ${devices} devices` : undefined,
            tone: "success",
          },
          { label: "Monitors", value: monitors ?? "—", meta: "Configured monitors" },
          {
            label: "Update failures",
            value: failedUpdates ?? "—",
            meta: "Unexpected results",
            tone: failedUpdates ? "danger" : "neutral",
          },
        ]}
      />

      <div className="sg-admin-overview-grid">
        <AdminSection title="Platform health" description="Only verified signals are marked healthy.">
          <div className="sg-admin-health-list">
            {services.map((service) => (
              <div key={service.name} className="sg-admin-health-row">
                <div className="min-w-0">
                  <strong>{service.name}</strong>
                  <p>{service.detail}</p>
                </div>
                <StatusBadge status={service.status} tone={service.tone}>
                  {service.status}
                </StatusBadge>
              </div>
            ))}
          </div>
        </AdminSection>

        <AdminSection title="Needs attention" description="Items that may require platform action.">
          {attention.length ? (
            <div>
              {attention.map((item) => (
                <div key={item.title} className="sg-admin-attention-row">
                  <TriangleAlert size={16} />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="sg-admin-attention-empty">Nothing currently requires attention.</p>
          )}
        </AdminSection>
      </div>

      <AdminSection title="Recent activity" description="Latest recorded platform events.">
        {auditResult.data?.length ? (
          <div className="sg-admin-activity-list">
            {auditResult.data.map((entry) => (
              <div key={entry.id} className="sg-admin-activity-row">
                <div className="min-w-0">
                  <strong>{entry.action}</strong>
                  <p>
                    {entry.actor_email ?? "System"} ·{" "}
                    {new Intl.DateTimeFormat("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(entry.created_at))}
                  </p>
                </div>
                <StatusBadge status={entry.status ?? "unknown"}>{entry.status ?? "Unknown"}</StatusBadge>
              </div>
            ))}
          </div>
        ) : (
          <p className="sg-admin-attention-empty">No recent audit activity.</p>
        )}
      </AdminSection>
    </>
  );
}
