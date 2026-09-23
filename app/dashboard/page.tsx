import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { PageHeader } from "@/components/dashboard/dashboard-primitives";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getOrganizationContext } from "@/lib/organization-context";

import {
  Activity,
  ArrowUpRight,
  Bell,
  Bot,
  Building2,
  CircleCheck,
  Clock3,
  Globe2,
  MapPin,
  MonitorCog,
  Plus,
  Server,
  ShieldAlert,
  TriangleAlert,
  UsersRound,
  WifiOff,
} from "lucide-react";

type Organization = {
  id: string;
  name?: string | null;
  description?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
};

type Client = {
  id: string;
  organization_id: string;
  name?: string | null;
  city?: string | null;
  country?: string | null;
  created_at?: string | null;
};

type Site = {
  id: string;
  client_id: string;
  name?: string | null;
  city?: string | null;
  country?: string | null;
  created_at?: string | null;
};

type Device = {
  id: string;
  client_id: string;
  site_id?: string | null;

  name?: string | null;
  hostname?: string | null;
  display_name?: string | null;

  status?: string | null;

  ip?: string | null;
  ip_address?: string | null;

  last_seen?: string | null;
  created_at?: string | null;

  type?: string | null;
  model?: string | null;
  device_model?: string | null;

  os?: string | null;
  os_name?: string | null;
  operating_system?: string | null;
  platform?: string | null;
  agent_version?: string | null;

  [key: string]: unknown;
};
type Monitor = {
  id: string;
  name?: string | null;
  status?: string | null;
  last_checked_at?: string | null;
};

type OperationFailure = {
  id: string;
  status?: string | null;
  action?: string | null;
  command_type?: string | null;
  created_at?: string | null;
};
// ============================================================
// HELPERS
// ============================================================

function getDeviceName(device: Device) {
  return (
    device.display_name ||
    device.hostname ||
    device.name ||
    "Unnamed device"
  );
}

function getDeviceIp(device: Device) {
  return device.ip || device.ip_address || "No IP";
}

function getDeviceOs(device: Device) {
  return (
    device.os_name ||
    device.operating_system ||
    device.os ||
    device.platform ||
    "Unknown OS"
  );
}

function getDeviceModel(device: Device) {
  return device.model || device.device_model || null;
}

const HEARTBEAT_OFFLINE_MS = 90_000;

type DeviceStatus = "online" | "offline" | "warning" | "unknown";

function getTimestamp(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getDeviceStatus(device: Device, now = Date.now()): DeviceStatus {
  const lastSeen = getTimestamp(device.last_seen);

  if (!lastSeen || now - lastSeen > HEARTBEAT_OFFLINE_MS) {
    return "offline";
  }

  const status = String(device.status || "").toLowerCase();

  if (status === "online") return "online";
  if (status === "offline") return "offline";
  if (status === "warning") return "warning";

  return "unknown";
}

function formatLastSeen(value?: string | null) {
  if (!value) {
    return "Never seen";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const difference = Date.now() - date.getTime();

  if (difference < 60_000) {
    return "Just now";
  }

  const minutes = Math.floor(difference / 60_000);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 30) {
    return `${days}d ago`;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getStatusClasses(status: string) {
  if (status === "online") {
    return {
      dot: "bg-emerald-400",
      badge: "bg-emerald-500/[0.09] text-emerald-400",
      icon: "border-emerald-500/15 bg-emerald-500/[0.07]",
      iconText: "text-emerald-400",
    };
  }

  if (status === "offline") {
    return {
      dot: "bg-red-400",
      badge: "bg-red-500/[0.09] text-red-400",
      icon: "border-red-500/15 bg-red-500/[0.07]",
      iconText: "text-red-400",
    };
  }

  if (status === "warning") {
    return {
      dot: "bg-amber-400",
      badge: "bg-amber-500/[0.09] text-amber-400",
      icon: "border-amber-500/15 bg-amber-500/[0.07]",
      iconText: "text-amber-400",
    };
  }

  return {
    dot: "bg-zinc-500",
    badge: "bg-white/[0.05] text-zinc-500",
    icon: "border-white/[0.07] bg-white/[0.035]",
    iconText: "text-zinc-500",
  };
}

// ============================================================
// DASHBOARD
// ============================================================

export default async function DashboardPage() {
  const context = await getOrganizationContext();

  if (!context.user) {
    return null;
  }

  const organizations = context.organizations as Organization[];
  const organizationIds = organizations.map((organization) => organization.id);
  const dashboardNow = Date.now();
  const sevenDaysAgo = new Date(
    dashboardNow - 7 * 86_400_000
  ).toISOString();

  const supabase = await createClient();

  let clients: Client[] = [];

  if (organizationIds.length > 0) {
    const { data: clientsData, error: clientsError } = await supabase
      .from("clients")
      .select("*")
      .in("organization_id", organizationIds);

    if (clientsError) {
      console.error("Dashboard clients error:", clientsError);
    }

    clients = (clientsData ?? []) as Client[];
  }

  const clientIds = clients.map((client) => client.id);

  let sites: Site[] = [];
  let devices: Device[] = [];
  let monitors: Monitor[] = [];
  let commandFailures: OperationFailure[] = [];
  let auditFailures: OperationFailure[] = [];

  const emptyResult = Promise.resolve({ data: [], error: null });

  const [
    sitesResult,
    devicesResult,
    monitorsResult,
    commandFailuresResult,
    auditFailuresResult,
  ] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("sites").select("*").in("client_id", clientIds)
      : emptyResult,
    clientIds.length > 0
      ? supabase.from("devices").select("*").in("client_id", clientIds)
      : emptyResult,
    organizationIds.length > 0
      ? supabase
          .from("monitors")
          .select("id, name, status, last_checked_at")
          .in("organization_id", organizationIds)
      : emptyResult,
    organizationIds.length > 0
      ? supabase
          .from("device_commands")
          .select("id, command_type, status, created_at")
          .in("organization_id", organizationIds)
          .in("status", ["failed", "expired"])
          .gte("created_at", sevenDaysAgo)
          .limit(50)
      : emptyResult,
    organizationIds.length > 0
      ? supabase
          .from("audit_logs")
          .select("id, action, status, created_at")
          .in("organization_id", organizationIds)
          .eq("status", "failed")
          .gte("created_at", sevenDaysAgo)
          .limit(50)
      : emptyResult,
  ]);

  if (sitesResult.error) {
    console.error("Dashboard sites error:", sitesResult.error);
  } else {
    sites = (sitesResult.data ?? []) as Site[];
  }

  if (devicesResult.error) {
    console.error("Dashboard devices error:", devicesResult.error);
  } else {
    devices = (devicesResult.data ?? []) as Device[];
  }

  if (monitorsResult.error) {
    console.error("Dashboard monitors error:", monitorsResult.error);
  } else {
    monitors = (monitorsResult.data ?? []) as Monitor[];
  }

  if (commandFailuresResult.error) {
    console.error("Dashboard command failures error:", commandFailuresResult.error);
  } else {
    commandFailures = (commandFailuresResult.data ?? []) as OperationFailure[];
  }

  if (auditFailuresResult.error) {
    console.error("Dashboard audit failures error:", auditFailuresResult.error);
  } else {
    auditFailures = (auditFailuresResult.data ?? []) as OperationFailure[];
  }

  // ============================================================
  // DEVICE STATS
  // ============================================================

  const totalOrganizations =
    organizations.length;

  const totalClients = clients.length;
  const totalSites = sites.length;
  const totalDevices = devices.length;

  const onlineDevices = devices.filter(
    (device) =>
      getDeviceStatus(device) === "online"
  ).length;

  const offlineDevices = devices.filter(
    (device) =>
      getDeviceStatus(device) === "offline"
  ).length;

  const warningDevices = devices.filter(
    (device) =>
      getDeviceStatus(device) === "warning"
  ).length;

  const unknownDevices = devices.filter(
    (device) =>
      getDeviceStatus(device) === "unknown"
  ).length;

  const issues =
    offlineDevices + warningDevices;

  const health =
    totalDevices > 0
      ? Math.round(
          (onlineDevices / totalDevices) * 100
        )
      : 0;
  const offlineMonitors = monitors.filter(
    (monitor) =>
      String(monitor.status || "").toLowerCase() === "offline"
  ).length;

  const uncheckedMonitors = monitors.filter(
    (monitor) => !monitor.last_checked_at
  ).length;

  const monitorIssues =
    offlineMonitors + uncheckedMonitors;

  const incidentCount =
    commandFailures.length + auditFailures.length;

  const alertCount =
    issues + monitorIssues;

  const devicesWithAgentVersion = devices.filter(
    (device) =>
      typeof device.agent_version === "string" &&
      device.agent_version.trim().length > 0
  ).length;

  const agentCoverage =
    totalDevices > 0
      ? Math.round(
          (devicesWithAgentVersion / totalDevices) * 100
        )
      : 0;

  // ============================================================
  // LOOKUPS
  // ============================================================

  const clientMap = new Map(
    clients.map((client) => [
      client.id,
      client,
    ])
  );

  const organizationByClientMap = new Map(
    clients.map((client) => [
      client.id,
      client.organization_id,
    ])
  );

  const siteMap = new Map(
    sites.map((site) => [
      site.id,
      site,
    ])
  );

  // ============================================================
  // RECENT DEVICES
  // ============================================================

  const recentDevices = [...devices]
    .sort((a, b) => {
      const aDate =
        a.last_seen ||
        a.created_at ||
        "";

      const bDate =
        b.last_seen ||
        b.created_at ||
        "";

      return (
        new Date(bDate).getTime() -
        new Date(aDate).getTime()
      );
    })
    .slice(0, 7);

  // ============================================================
  // ATTENTION DEVICES
  // ============================================================

  const attentionDevices = devices
    .filter((device) => {
      const status =
        getDeviceStatus(device);

      return (
        status === "offline" ||
        status === "warning"
      );
    })
    .sort((a, b) => {
      const aStatus =
        getDeviceStatus(a);

      const bStatus =
        getDeviceStatus(b);

      if (
        aStatus === "offline" &&
        bStatus !== "offline"
      ) {
        return -1;
      }

      if (
        bStatus === "offline" &&
        aStatus !== "offline"
      ) {
        return 1;
      }

      return 0;
    })
    .slice(0, 5);

  // ============================================================
  // CLIENT DEVICE DISTRIBUTION
  // ============================================================

  const clientDistribution = clients
    .map((client) => {
      const clientDevices =
        devices.filter(
          (device) =>
            device.client_id === client.id
        );

      const online =
        clientDevices.filter(
          (device) =>
            getDeviceStatus(device) ===
            "online"
        ).length;

      return {
        client,
        devices: clientDevices.length,
        online,
      };
    })
    .sort(
      (a, b) =>
        b.devices - a.devices
    )
    .slice(0, 5);

  // ============================================================
  // SMART QUICK ACTION LINKS
  // ============================================================

  const singleOrganization =
    organizations.length === 1
      ? organizations[0]
      : null;

  const singleClient =
    clients.length === 1
      ? clients[0]
      : null;

  const addClientHref =
    singleOrganization
      ? `/dashboard/organizations/${singleOrganization.id}/clients/new`
      : "/dashboard/organizations";

  const enrollDeviceHref =
    singleOrganization &&
    singleClient
      ? `/dashboard/organizations/${singleOrganization.id}/clients/${singleClient.id}/devices/new`
      : "/dashboard/organizations";

  return (
    <div className="sg-page-shell">
      <div className="sg-page">

        {/* ======================================================
            HEADER
        ====================================================== */}

        <PageHeader
          title="Dashboard"
          eyebrow="Infrastructure overview"
          description="Monitor devices, agents, alerts, incidents and service monitors from one place. Devices are marked offline after 90 seconds without a heartbeat."
        />

                <section
          className="sg-surface mb-5 overflow-hidden"
        >
          <div className="grid lg:grid-cols-[1.3fr_0.7fr]">

            {/* HEALTH */}

            <div className="border-b border-surface-edge p-6 lg:border-b-0 lg:border-r">

              <div className="flex items-start justify-between gap-5">

                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.13em] text-surface-muted">
                    Device health
                  </p>

                  <div className="mt-4 flex items-end gap-3">

                    <span className="text-5xl font-semibold tracking-[-0.04em] text-white">
                      {totalDevices > 0
                        ? `${health}%`
                        : "--"}
                    </span>

                    <span className="mb-1.5 text-sm text-surface-muted">
                      operational
                    </span>

                  </div>
                </div>

                <div
                  className={`
                    flex h-11 w-11 items-center justify-center
                    rounded-xl border
                    ${
                      issues > 0
                        ? "border-amber-500/15 bg-amber-500/[0.08]"
                        : "border-emerald-500/15 bg-emerald-500/[0.08]"
                    }
                  `}
                >
                  {issues > 0 ? (
                    <TriangleAlert
                      size={20}
                      className="text-amber-400"
                    />
                  ) : (
                    <Activity
                      size={20}
                      className="text-emerald-400"
                    />
                  )}
                </div>

              </div>

              <div className="mt-7">

                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">

                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all duration-700"
                    style={{
                      width: `${health}%`,
                    }}
                  />

                </div>

                <div className="mt-3 flex items-center justify-between gap-4">

                  <span className="text-xs text-surface-muted">
                    {totalDevices > 0
                      ? `${onlineDevices} of ${totalDevices} devices online`
                      : "No devices enrolled"}
                  </span>

                  <span
                    className={`
                      flex items-center gap-1.5 text-xs
                      ${
                        issues > 0
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }
                    `}
                  >
                    {issues > 0 ? (
                      <>
                        <TriangleAlert size={13} />
                        {issues} requiring attention
                      </>
                    ) : (
                      <>
                        <CircleCheck size={13} />
                        All systems operational
                      </>
                    )}
                  </span>

                </div>

              </div>

            </div>

            {/* STATUS */}

            <div className="grid grid-cols-3 divide-x divide-surface-edge">

              <div className="flex flex-col justify-center px-5 py-6">
                <span className="mb-3 h-2 w-2 rounded-full bg-emerald-400" />

                <span className="text-2xl font-semibold tracking-tight text-white">
                  {onlineDevices}
                </span>

                <span className="mt-1 text-xs text-surface-muted">
                  Online
                </span>
              </div>

              <div className="flex flex-col justify-center px-5 py-6">
                <span className="mb-3 h-2 w-2 rounded-full bg-amber-400" />

                <span className="text-2xl font-semibold tracking-tight text-white">
                  {warningDevices}
                </span>

                <span className="mt-1 text-xs text-surface-muted">
                  Warning
                </span>
              </div>

              <div className="flex flex-col justify-center px-5 py-6">
                <span className="mb-3 h-2 w-2 rounded-full bg-red-400" />

                <span className="text-2xl font-semibold tracking-tight text-white">
                  {offlineDevices}
                </span>

                <span className="mt-1 text-xs text-surface-muted">
                  Offline
                </span>
              </div>

            </div>

          </div>
        </section>

        {/* ======================================================
            MAIN METRICS
        ====================================================== */}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

          {/* ORGANIZATIONS */}

          <Link
            href="/dashboard/organizations"
            className="sg-surface group p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-surface-accent-edge hover:bg-surface-hover sg-interactive"
          >

            <div className="flex items-center justify-between">

              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-surface-edge bg-white/[0.035]"
              >
                <Building2
                  size={17}
                  className="text-zinc-400 transition-colors group-hover:text-white"
                />
              </div>

              <ArrowUpRight
                size={14}
                className="text-zinc-700 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-zinc-300"
              />

            </div>

            <p className="mt-5 text-3xl font-semibold tracking-tight text-white">
              {totalOrganizations}
            </p>

            <p className="mt-1 text-xs text-surface-muted">
              Organizations
            </p>

          </Link>

          {/* CLIENTS */}

          <Link
            href="/dashboard/organizations"
            className="sg-surface group p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-surface-accent-edge hover:bg-surface-hover sg-interactive"
          >

            <div className="flex items-center justify-between">

              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-surface-edge bg-white/[0.035]"
              >
                <UsersRound
                  size={17}
                  className="text-zinc-400 transition-colors group-hover:text-white"
                />
              </div>

              <ArrowUpRight
                size={14}
                className="text-zinc-700 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-zinc-300"
              />

            </div>

            <p className="mt-5 text-3xl font-semibold tracking-tight text-white">
              {totalClients}
            </p>

            <p className="mt-1 text-xs text-surface-muted">
              Clients managed
            </p>

          </Link>

          {/* SITES */}

          <div
            className="sg-surface group p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-surface-accent-edge hover:bg-surface-hover"
          >

            <div className="flex items-center justify-between">

              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-surface-edge bg-white/[0.035]"
              >
                <MapPin
                  size={17}
                  className="text-zinc-400 transition-colors group-hover:text-white"
                />
              </div>

              <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-700">
                Infrastructure
              </span>

            </div>

            <p className="mt-5 text-3xl font-semibold tracking-tight text-white">
              {totalSites}
            </p>

            <p className="mt-1 text-xs text-surface-muted">
              Sites
            </p>

          </div>

          {/* DEVICES */}

          <div
            className="sg-surface group p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-surface-accent-edge hover:bg-surface-hover"
          >

            <div className="flex items-center justify-between">

              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-surface-edge bg-white/[0.035]"
              >
                <MonitorCog
                  size={17}
                  className="text-zinc-400 transition-colors group-hover:text-white"
                />
              </div>

              <div className="flex items-center gap-1.5">

                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />

                <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-surface-muted">
                  {onlineDevices} active
                </span>

              </div>

            </div>

            <p className="mt-5 text-3xl font-semibold tracking-tight text-white">
              {totalDevices}
            </p>

            <p className="mt-1 text-xs text-surface-muted">
              Managed devices
            </p>

          </div>

        </section>

        {/* ======================================================
            OPERATIONS
        ====================================================== */}

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Alerts",
              value: alertCount,
              description: `${issues} device signals, ${monitorIssues} monitor signals`,
              href: "/dashboard/alerts?source=devices",
              icon: Bell,
              tone: alertCount > 0 ? "text-amber-400" : "text-emerald-400",
            },
            {
              label: "Recent failures",
              value: incidentCount,
              description: "Command and audit failures recorded in the last 7 days",
              href: "/dashboard/incidents?source=commands&days=7",
              icon: ShieldAlert,
              tone: incidentCount > 0 ? "text-red-400" : "text-emerald-400",
            },
            {
              label: "Monitors",
              value: monitors.length,
              description: `${offlineMonitors} offline, ${uncheckedMonitors} not checked`,
              href: "/dashboard/monitors",
              icon: Globe2,
              tone: monitorIssues > 0 ? "text-amber-400" : "text-sky-400",
            },
            {
              label: "Agents",
              value: `${agentCoverage}%`,
              description: `${devicesWithAgentVersion}/${totalDevices} devices reporting an agent version`,
              href: "/dashboard/agents",
              icon: Bot,
              tone: agentCoverage === 100 || totalDevices === 0 ? "text-emerald-400" : "text-amber-400",
            },
          ].map(({ label, value, description, href, icon: Icon, tone }) => (
            <Link
              key={label}
              href={href}
              className="sg-surface group p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-surface-accent-edge hover:bg-surface-hover sg-interactive"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-surface-edge bg-white/[0.035]">
                  <Icon
                    size={17}
                    className={tone}
                  />
                </div>

                <ArrowUpRight
                  size={14}
                  className="text-zinc-700 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-zinc-300"
                />
              </div>

              <p className="mt-5 text-3xl font-semibold tracking-tight text-white">
                {value}
              </p>

              <p className="mt-1 text-xs text-surface-muted">
                {label}
              </p>

              <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-zinc-500">
                {description}
              </p>
            </Link>
          ))}
        </section>
        {/* ======================================================
            CONTENT
        ====================================================== */}

        <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">

          {/* ====================================================
              RECENT DEVICES
          ==================================================== */}

          <div
            className="sg-surface overflow-hidden"
          >

            <div className="flex items-center justify-between border-b border-surface-edge px-5 py-4">

              <div>
                <h2 className="sg-section-title font-medium text-zinc-200">
                  Recent devices
                </h2>

                <p className="mt-1 text-xs text-surface-muted">
                  Latest devices reporting to SentinelGrid, using effective heartbeat status.
                </p>
              </div>

              <Link
                href="/dashboard/organizations"
                className="flex items-center gap-1.5 text-xs font-medium text-surface-muted transition-colors duration-200 hover:text-white"
              >
                View infrastructure

                <ArrowUpRight size={13} />
              </Link>

            </div>

            {recentDevices.length === 0 ? (

              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">

                <div
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-surface-edge bg-white/[0.035]"
                >
                  <MonitorCog
                    size={19}
                    className="text-surface-muted"
                  />
                </div>

                <p className="mt-4 text-sm font-medium text-zinc-300">
                  No devices enrolled
                </p>

                <p className="mt-1 max-w-sm text-xs leading-5 text-surface-muted">
                  Install the SentinelGrid Agent on a device to start receiving
                  inventory, status and health information.
                </p>

                <Link
                  href={enrollDeviceHref}
                  className="sg-button sg-button-secondary sg-button-sm mt-5 duration-200"
                >
                  <Plus size={13} />

                  Enroll device
                </Link>

              </div>

            ) : (

              <div>

                {recentDevices.map(
                  (device, index) => {
                    const status =
                      getDeviceStatus(device);

                    const classes =
                      getStatusClasses(status);

                    const client =
                      clientMap.get(
                        device.client_id
                      );

                    const organizationId =
                      organizationByClientMap.get(
                        device.client_id
                      );

                    const site =
                      device.site_id
                        ? siteMap.get(
                            device.site_id
                          )
                        : null;

                    const model =
                      getDeviceModel(device);

                    const href =
                      organizationId
                        ? `/dashboard/organizations/${organizationId}/clients/${device.client_id}`
                        : "/dashboard/organizations";

                    return (
                      <Link
                        key={device.id}
                        href={href}
                        className={`
                          group flex items-center gap-4
                          px-5 py-4
                          transition-colors duration-150
                          hover:bg-surface-hover
                          ${
                            index !==
                            recentDevices.length - 1
                              ? "border-b border-white/[0.05]"
                              : ""
                          }
                        `}
                      >

                        <div
                          className={`
                            flex h-10 w-10 shrink-0
                            items-center justify-center
                            rounded-xl border
                            ${classes.icon}
                          `}
                        >
                          {status ===
                          "offline" ? (
                            <WifiOff
                              size={16}
                              className={
                                classes.iconText
                              }
                            />
                          ) : (
                            <MonitorCog
                              size={16}
                              className={
                                classes.iconText
                              }
                            />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">

                          <div className="flex items-center gap-2">

                            <p className="truncate text-sm font-medium text-zinc-200">
                              {getDeviceName(
                                device
                              )}
                            </p>

                            {model && (
                              <span className="hidden truncate text-[10px] text-surface-muted md:inline">
                                {model}
                              </span>
                            )}

                          </div>

                          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-surface-muted">

                            <span className="truncate">
                              {client?.name ||
                                "Unknown client"}
                            </span>

                            <span className="text-zinc-700">
                              •
                            </span>

                            <span className="truncate">
                              {site?.name ||
                                getDeviceIp(
                                  device
                                )}
                            </span>

                          </div>

                        </div>

                        <div className="hidden min-w-[130px] md:block">

                          <p className="truncate text-xs text-zinc-400">
                            {getDeviceOs(
                              device
                            )}
                          </p>

                          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-surface-muted">
                            Operating system
                          </p>

                        </div>

                        <div className="hidden min-w-[80px] text-right sm:block">

                          <p className="text-xs text-zinc-400">
                            {formatLastSeen(
                              device.last_seen
                            )}
                          </p>

                          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-surface-muted">
                            Last seen
                          </p>

                        </div>

                        <div className="flex min-w-[80px] justify-end">

                          <StatusBadge status={status} />

                        </div>

                      </Link>
                    );
                  }
                )}

              </div>

            )}

          </div>

          {/* ====================================================
              NEEDS ATTENTION
          ==================================================== */}

          <div
            className="sg-surface overflow-hidden"
          >

            <div className="border-b border-surface-edge px-5 py-4">

              <div className="flex items-center justify-between gap-4">

                <div>
                  <h2 className="sg-section-title font-medium text-zinc-200">
                    Needs attention
                  </h2>

                  <p className="mt-1 text-xs text-surface-muted">
                    Devices offline, warning or missing a current heartbeat.
                  </p>
                </div>

                {issues > 0 && (
                  <div
                    className="flex h-8 min-w-8 items-center justify-center rounded-lg border border-amber-500/15 bg-amber-500/[0.07] px-2 text-xs font-medium text-amber-400"
                  >
                    {issues}
                  </div>
                )}

              </div>

            </div>

            {attentionDevices.length ===
            0 ? (

              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">

                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/15 bg-emerald-500/[0.07]"
                >
                  <CircleCheck
                    size={17}
                    className="text-emerald-400"
                  />
                </div>

                <p className="mt-4 text-sm font-medium text-zinc-300">
                  Everything looks good
                </p>

                <p className="mt-1 text-xs leading-5 text-surface-muted">
                  No devices currently require attention.
                </p>

              </div>

            ) : (

              <div>

                {attentionDevices.map(
                  (device, index) => {
                    const status =
                      getDeviceStatus(device);

                    const client =
                      clientMap.get(
                        device.client_id
                      );

                    const organizationId =
                      organizationByClientMap.get(
                        device.client_id
                      );

                    const href =
                      organizationId
                        ? `/dashboard/organizations/${organizationId}/clients/${device.client_id}`
                        : "/dashboard/organizations";

                    return (
                      <Link
                        key={device.id}
                        href={href}
                        className={`
                          group flex items-center gap-3
                          px-5 py-4
                          transition-colors
                          hover:bg-surface-hover
                          ${
                            index !==
                            attentionDevices.length -
                              1
                              ? "border-b border-white/[0.05]"
                              : ""
                          }
                        `}
                      >

                        <div
                          className={`
                            flex h-8 w-8 shrink-0
                            items-center justify-center
                            rounded-lg border
                            ${
                              status ===
                              "offline"
                                ? "border-red-500/15 bg-red-500/[0.07]"
                                : "border-amber-500/15 bg-amber-500/[0.07]"
                            }
                          `}
                        >
                          {status ===
                          "offline" ? (
                            <WifiOff
                              size={14}
                              className="text-red-400"
                            />
                          ) : (
                            <TriangleAlert
                              size={14}
                              className="text-amber-400"
                            />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">

                          <p className="truncate text-xs font-medium text-zinc-300">
                            {getDeviceName(
                              device
                            )}
                          </p>

                          <p className="mt-0.5 truncate text-[11px] text-surface-muted">
                            {client?.name ||
                              "Unknown client"}
                          </p>

                        </div>

                        <div className="text-right">

                          <p
                            className={`
                              text-[11px] font-medium
                              ${
                                status ===
                                "offline"
                                  ? "text-red-400"
                                  : "text-amber-400"
                              }
                            `}
                          >
                            {status ===
                            "offline"
                              ? "Offline"
                              : "Warning"}
                          </p>

                          <p className="mt-0.5 text-[10px] text-surface-muted">
                            {formatLastSeen(
                              device.last_seen
                            )}
                          </p>

                        </div>

                      </Link>
                    );
                  }
                )}

              </div>

            )}

          </div>

        </section>

        {/* ======================================================
            LOWER GRID
        ====================================================== */}

        <section className="mt-5 grid gap-5 lg:grid-cols-2">

          {/* ====================================================
              CLIENT DISTRIBUTION
          ==================================================== */}

          <div
            className="sg-surface p-5"
          >

            <div className="flex items-center justify-between">

              <div>
                <h2 className="sg-section-title font-medium text-zinc-200">
                  Client infrastructure
                </h2>

                <p className="mt-1 text-xs text-surface-muted">
                  Device distribution across your clients.
                </p>
              </div>

              <Server
                size={17}
                className="text-surface-muted"
              />

            </div>

            {clientDistribution.length ===
            0 ? (

              <div className="flex min-h-[190px] items-center justify-center">

                <div className="text-center">

                  <UsersRound
                    size={20}
                    className="mx-auto text-zinc-700"
                  />

                  <p className="mt-3 text-xs text-surface-muted">
                    No clients available yet.
                  </p>

                </div>

              </div>

            ) : (

              <div className="mt-5 space-y-4">

                {clientDistribution.map(
                  ({
                    client,
                    devices:
                      deviceCount,
                    online,
                  }) => {
                    const percentage =
                      deviceCount > 0
                        ? Math.round(
                            (online /
                              deviceCount) *
                              100
                          )
                        : 0;

                    return (
                      <div
                        key={client.id}
                      >

                        <div className="mb-2 flex items-center justify-between gap-4">

                          <div className="min-w-0">

                            <p className="truncate text-xs font-medium text-zinc-300">
                              {client.name ||
                                "Unnamed client"}
                            </p>

                          </div>

                          <div className="flex shrink-0 items-center gap-3">

                            <span className="text-[11px] text-surface-muted">
                              {online}/
                              {deviceCount} online
                            </span>

                            <span className="w-8 text-right text-[11px] font-medium text-zinc-400">
                              {deviceCount}
                            </span>

                          </div>

                        </div>

                        <div className="h-1 overflow-hidden rounded-full bg-white/[0.05]">

                          <div
                            className="h-full rounded-full bg-emerald-400/80 transition-all duration-500"
                            style={{
                              width: `${percentage}%`,
                            }}
                          />

                        </div>

                      </div>
                    );
                  }
                )}

              </div>

            )}

          </div>

          {/* ====================================================
              QUICK ACTIONS
          ==================================================== */}

          <div
            className="sg-surface p-5"
          >

            <div>
              <h2 className="sg-section-title font-medium text-zinc-200">
                Quick actions
              </h2>

              <p className="mt-1 text-xs text-surface-muted">
                Common SentinelGrid management and operations tasks.
              </p>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">

              {/* ORGANIZATION */}

              <Link
                href="/dashboard/organizations"
                className="sg-button sg-button-secondary group duration-200"
              >

                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-surface-edge bg-white/[0.035]"
                >
                  <Building2
                    size={15}
                    className="text-surface-muted transition-colors group-hover:text-white"
                  />
                </div>

                <div className="min-w-0 flex-1">

                  <p className="text-xs font-medium text-zinc-300">
                    Organizations
                  </p>

                  <p className="mt-0.5 text-[11px] text-surface-muted">
                    Manage infrastructure
                  </p>

                </div>

                <ArrowUpRight
                  size={13}
                  className="text-zinc-700 transition-colors group-hover:text-zinc-300"
                />

              </Link>

              {/* ADD CLIENT */}

              <Link
                href={addClientHref}
                className="sg-button sg-button-secondary group duration-200"
              >

                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-surface-edge bg-white/[0.035]"
                >
                  <UsersRound
                    size={15}
                    className="text-surface-muted transition-colors group-hover:text-white"
                  />
                </div>

                <div className="min-w-0 flex-1">

                  <p className="text-xs font-medium text-zinc-300">
                    Add client
                  </p>

                  <p className="mt-0.5 text-[11px] text-surface-muted">
                    Create managed client
                  </p>

                </div>

                <ArrowUpRight
                  size={13}
                  className="text-zinc-700 transition-colors group-hover:text-zinc-300"
                />

              </Link>

              {/* ENROLL DEVICE */}

              <Link
                href={enrollDeviceHref}
                className="sg-button sg-button-secondary group duration-200"
              >

                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-surface-edge bg-white/[0.035]"
                >
                  <MonitorCog
                    size={15}
                    className="text-surface-muted transition-colors group-hover:text-white"
                  />
                </div>

                <div className="min-w-0 flex-1">

                  <p className="text-xs font-medium text-zinc-300">
                    Enroll device
                  </p>

                  <p className="mt-0.5 text-[11px] text-surface-muted">
                    Install SentinelGrid Agent
                  </p>

                </div>

                <ArrowUpRight
                  size={13}
                  className="text-zinc-700 transition-colors group-hover:text-zinc-300"
                />

              </Link>

              {/* ALERTS */}

              <Link
                href="/dashboard/alerts?source=devices"
                className="sg-button sg-button-secondary group duration-200"
              >

                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-surface-edge bg-white/[0.035]"
                >
                  <Bell
                    size={15}
                    className="text-surface-muted transition-colors group-hover:text-white"
                  />
                </div>

                <div className="min-w-0 flex-1">

                  <p className="text-xs font-medium text-zinc-300">
                    Review alerts
                  </p>

                  <p className="mt-0.5 text-[11px] text-surface-muted">
                    Devices and monitors
                  </p>

                </div>

                <ArrowUpRight
                  size={13}
                  className="text-zinc-700 transition-colors group-hover:text-zinc-300"
                />

              </Link>

              {/* INCIDENTS */}

              <Link
                href="/dashboard/incidents?source=commands&days=7"
                className="sg-button sg-button-secondary group duration-200"
              >

                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-surface-edge bg-white/[0.035]"
                >
                  <ShieldAlert
                    size={15}
                    className="text-surface-muted transition-colors group-hover:text-white"
                  />
                </div>

                <div className="min-w-0 flex-1">

                  <p className="text-xs font-medium text-zinc-300">
                    Review failure evidence
                  </p>

                  <p className="mt-0.5 text-[11px] text-surface-muted">
                    Recorded command and audit history
                  </p>

                </div>

                <ArrowUpRight
                  size={13}
                  className="text-zinc-700 transition-colors group-hover:text-zinc-300"
                />

              </Link>
              {/* MONITORS */}

              <Link
                href="/dashboard/monitors"
                className="sg-button sg-button-secondary group duration-200"
              >

                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-surface-edge bg-white/[0.035]"
                >
                  <Globe2
                    size={15}
                    className="text-surface-muted transition-colors group-hover:text-white"
                  />
                </div>

                <div className="min-w-0 flex-1">

                  <p className="text-xs font-medium text-zinc-300">
                    Service monitors
                  </p>

                  <p className="mt-0.5 text-[11px] text-surface-muted">
                    Website monitoring
                  </p>

                </div>

                <ArrowUpRight
                  size={13}
                  className="text-zinc-700 transition-colors group-hover:text-zinc-300"
                />

              </Link>

            </div>

          </div>

        </section>

        {/* ======================================================
            FOOTER STATUS
        ====================================================== */}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 px-2">

          <div className="flex items-center gap-2 text-[11px] text-surface-muted">

            <Clock3 size={12} />

            Live infrastructure data from SentinelGrid Agents

          </div>

          <div className="flex items-center gap-4 text-[11px] text-surface-muted">

            {unknownDevices > 0 && (
              <span>
                {unknownDevices} unknown
              </span>
            )}

            <span>
              {totalDevices} managed{" "}
              {totalDevices === 1
                ? "device"
                : "devices"}
            </span>

          </div>

        </div>

      </div>
    </div>
  );
}