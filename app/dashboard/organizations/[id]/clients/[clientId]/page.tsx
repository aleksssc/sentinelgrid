import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { PageHeader, SectionHeader, CompactSummary } from "@/components/dashboard/dashboard-primitives";
import Link from "next/link";

import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrganizationSubscription } from "@/lib/organization-access";
import { getOrganizationContext } from "@/lib/organization-context";
import { getRemoteFeatureAccess } from "@/lib/remote-feature-access";

import DeviceDashboard from "./device-dashboard";
import {
  ArrowLeft,
  Building2,
  Monitor,
  Plus,
  Settings,
  ShieldAlert,
  Wifi,
  WifiOff,
} from "lucide-react";

export default async function ClientDetailsPage({
  params,
}: {
  params: Promise<{
    id: string;
    clientId: string;
  }>;
}) {

  const {
    id,
    clientId,
  } = await params;

  const context = await getOrganizationContext();
  if (!context.user) {
    return null;
  }

  const organization = context.organizations.find((item) => item.id === id);
  const role = context.organizationRoles[id];

  if (!organization || !role || !organization.owner_id) {
    notFound();
  }

  const canManageInfrastructure =
    role === "owner" ||
    role === "admin";

  const supabase = await createClient();

  const clientQuery = supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .eq("organization_id", organization.id)
    .single();

  const sitesQuery = supabase
    .from("sites")
    .select(`
      id,
      name
    `)
    .eq("client_id", clientId)
    .order("name", { ascending: true });

  const devicesQuery = supabase
    .from("devices")
    .select(`
      id,
      hostname,
      display_name,
      os,
      os_version,
      os_build,
      arch,
      device_type,
      manufacturer,
      model,
      serial_number,
      cpu_name,
      cpu_usage,
      ram_usage,
      ram_total_bytes,
      ram_used_bytes,
      disk_usage,
      disk_total_bytes,
      disk_used_bytes,
      uptime_seconds,
      local_ip,
      public_ip,
      mac_address,
      status,
      agent_id,
      agent_version,
      capabilities,
      last_inventory_at,
      last_seen,
      site_id,
      created_at,
      sites (
        id,
        name
      )
    `)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  const [
    clientResult,
    sitesResult,
    devicesResult,
    subscription,
  ] = await Promise.all([
    clientQuery,
    sitesQuery,
    devicesQuery,
    getOrganizationSubscription(organization.id),
  ]);

  if (clientResult.error) {
    console.error("Client error:", clientResult.error);
  }

  if (!clientResult.data) {
    notFound();
  }

  if (sitesResult.error) {
    console.error("Sites error:", sitesResult.error);
  }

  if (devicesResult.error) {
    console.error("Devices error:", devicesResult.error);
  }

  const client = clientResult.data;
  const siteList = sitesResult.data ?? [];
  const deviceList = devicesResult.data ?? [];

  const organizationAccess = {
    organizationId: organization.id,
    ownerId: organization.owner_id,
    userId: context.user.id,
    role,
    subscription,
  };

  const remoteAccess = {
    actions: getRemoteFeatureAccess(organizationAccess, "devices.actions", "deviceActions"),
    terminal: getRemoteFeatureAccess(organizationAccess, "devices.terminal", "terminal"),
    rdp: getRemoteFeatureAccess(organizationAccess, "devices.rdp", "rdp"),
  };

  /* =========================
     EFFECTIVE STATUS
  ========================= */

  const now =
    Date.now();

  const deviceStatuses =
    deviceList.map(
      (device) =>
        getEffectiveStatus(
          device.status,
          device.last_seen,
          now
        )
    );

  /* =========================
     STATS
  ========================= */

  const devicesCount =
    deviceList.length;

  const onlineCount =
    deviceStatuses.filter(
      (status) =>
        status ===
        "online"
    ).length;

  const offlineCount =
    deviceStatuses.filter(
      (status) =>
        status ===
        "offline"
    ).length;

  const warningCount =
    deviceStatuses.filter(
      (status) =>
        status ===
        "warning"
    ).length;

  const alertsCount =
    warningCount;

  return (
    <div className="sg-page-shell">

      <div className="sg-page">

        {/* =========================
            BACK
        ========================= */}

        <Link
          href={`/dashboard/organizations/${organization.id}`}
          className="mb-6 inline-flex items-center gap-2 text-sm text-surface-muted transition hover:text-white"
        >
          <ArrowLeft
            size={16}
          />

          Back to organization
        </Link>

        {/* =========================
            HEADER
        ========================= */}

        <PageHeader
          title={client.name}
          badge={<StatusBadge status={client.status === "active" ? "active" : "inactive"} />}
          icon={<Building2 size={19} />}
          description={client.description || "Monitor and manage this client's infrastructure."}
          actions={canManageInfrastructure && <>
            <Link href={`/dashboard/organizations/${organization.id}/clients/${client.id}/settings`} className="sg-button sg-button-secondary"><Settings size={15} />Settings</Link>
            <Link href={`/dashboard/organizations/${organization.id}/clients/${client.id}/devices/new`} className="sg-button sg-button-primary"><Plus size={15} />Add device</Link>
          </>}
        />
        <CompactSummary label="Client device summary" items={[
          { label: "Devices", value: devicesCount, icon: <Monitor size={14} /> },
          { label: "Online", value: onlineCount, icon: <Wifi size={14} />, tone: "success" },
          { label: "Offline", value: offlineCount, icon: <WifiOff size={14} />, tone: offlineCount ? "danger" : "neutral" },
          { label: "Alerts", value: alertsCount, icon: <ShieldAlert size={14} />, tone: alertsCount ? "warning" : "neutral" },
        ]} />

        <section className="sg-surface sg-clients-panel">

          <SectionHeader title="Devices" description={canManageInfrastructure
            ? "Monitor and manage the devices registered for this client."
            : "View, search and filter the devices registered for this client."} />
          <div className="sg-panel-body">
          <DeviceDashboard
            rdpConfigured={Boolean(process.env.SENTINELGRID_RELAY_URL && process.env.SENTINELGRID_RDP_RELAY_SECRET)}
            devices={
              deviceList
            }
            sites={
              siteList
            }
            clientName={
              client.name
            }
            canManage={
              canManageInfrastructure
            }
            remoteAccess={remoteAccess}
          />
          </div>
        </section>

      </div>

    </div>
  );
}

/* =========================
   EFFECTIVE DEVICE STATUS
========================= */

function getEffectiveStatus(
  status: string | null,
  lastSeen: string | null,
  now: number
):
  | "online"
  | "offline"
  | "warning" {
  if (!lastSeen) {
    return "offline";
  }

  const lastSeenTime =
    new Date(
      lastSeen
    ).getTime();

  if (
    Number.isNaN(
      lastSeenTime
    )
  ) {
    return "offline";
  }

  const diff =
    now -
    lastSeenTime;

  /*
    Agent heartbeat = 30 seconds.

    After 3 missed heartbeats
    the device is offline.
  */

  if (
    diff >
    90_000
  ) {
    return "offline";
  }

  if (
    status ===
    "warning"
  ) {
    return "warning";
  }

  return "online";
}