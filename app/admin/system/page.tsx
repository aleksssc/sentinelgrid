import { connection } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import {
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
} from "@/components/admin/admin-primitives";

const heartbeatWindow = 90_000;

export default async function AdminSystemPage() {
  await connection();

  const admin = createAdminClient();

  const [
    { error: supabaseError },
    { data: agents, error: heartbeatError },
    { count: updateActivity, error: updateError },
  ] = await Promise.all([
    admin.from("organizations").select("id", { head: true }).limit(1),
    admin.from("devices").select("last_seen").order("last_seen", { ascending: false }).limit(1),
    admin
      .from("device_commands")
      .select("*", { count: "exact", head: true })
      .eq("command_type", "update_agent")
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
  ]);

  const heartbeat = agents?.[0]?.last_seen;
  const recentHeartbeat =
    heartbeat && Date.now() - Date.parse(heartbeat) <= heartbeatWindow;

  const checks = [
    {
      name: "SentinelGrid application",
      detail: "This administration request is being served.",
      status: "Healthy",
      tone: "success" as const,
    },
    {
      name: "Supabase",
      detail: supabaseError ? "Server-side query failed." : "Server-side query succeeded.",
      status: supabaseError ? "Degraded" : "Healthy",
      tone: supabaseError ? ("warning" as const) : ("success" as const),
    },
    {
      name: "Agent activity",
      detail: heartbeatError
        ? "Heartbeat state could not be loaded."
        : recentHeartbeat
          ? "A device heartbeat was recorded within the last 90 seconds."
          : "No device heartbeat was recorded within the last 90 seconds.",
      status: heartbeatError ? "Not checked" : recentHeartbeat ? "Healthy" : "No recent activity",
      tone: heartbeatError
        ? ("neutral" as const)
        : recentHeartbeat
          ? ("success" as const)
          : ("warning" as const),
    },
    {
      name: "Update activity",
      detail: updateError
        ? "Update command activity could not be loaded."
        : `${updateActivity ?? 0} update command${updateActivity === 1 ? "" : "s"} in the last 24 hours.`,
      status: updateError ? "Not checked" : "Observed",
      tone: updateError ? ("neutral" as const) : ("info" as const),
    },
    {
      name: "Railway relay",
      detail: "No Admin health endpoint is configured.",
      status: "Not checked",
      tone: "neutral" as const,
    },
    {
      name: "Redis",
      detail: "No Admin health endpoint is configured.",
      status: "Not checked",
      tone: "neutral" as const,
    },
  ];

  const healthy = checks.filter((check) => check.status === "Healthy").length;
  const checked = checks.filter((check) => check.status !== "Not checked").length;

  return (
    <>
      <AdminPageHeader
        eyebrow="Operations"
        title="System Health"
        description="Verified platform signals only. Unconfigured checks stay explicitly unverified."
      />

      <AdminMetricStrip
        label="System health summary"
        items={[
          { label: "Healthy", value: healthy, tone: "success" },
          { label: "Checked", value: `${checked}/${checks.length}` },
          {
            label: "Latest heartbeat",
            value: heartbeat
              ? new Intl.DateTimeFormat("en-GB", { timeStyle: "short" }).format(new Date(heartbeat))
              : "None",
          },
          { label: "Updates · 24h", value: updateError ? "—" : updateActivity ?? 0 },
        ]}
      />

      <AdminSection title="Service checks">
        <div className="sg-admin-health-list">
          {checks.map((check) => (
            <div key={check.name} className="sg-admin-health-row">
              <div className="min-w-0">
                <strong>{check.name}</strong>
                <p>{check.detail}</p>
              </div>
              <StatusBadge status={check.status} tone={check.tone}>
                {check.status}
              </StatusBadge>
            </div>
          ))}
        </div>
      </AdminSection>
    </>
  );
}
