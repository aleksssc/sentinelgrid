import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { PageHeader, SectionHeader, CompactSummary } from "@/components/dashboard/dashboard-primitives";
import Link from "next/link";

import { connection } from "next/server";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import DeviceDashboard from "./device-dashboard";
import {
  activityCorrelation, enrichActivityUpdateCommands,
  type DeviceActivity, type DeviceActivityCommand,
} from "@/lib/activity/device-activity";

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
  await connection();

  const {
    id,
    clientId,
  } = await params;

  const supabase =
    await createClient();

  /* =========================
     USER
  ========================= */

  const {
    data: { user },
  } =
    await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  /* =========================
     ORGANIZATION
  ========================= */

  const {
    data: organization,
    error: organizationError,
  } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .single();

  if (
    organizationError ||
    !organization
  ) {
    console.error(
      "Organization error:",
      organizationError
    );

    notFound();
  }

  /* =========================
     ACCESS / ROLE
  ========================= */

  const isOwner =
    organization.owner_id ===
    user.id;

  let memberRole:
    | string
    | null = null;

  if (!isOwner) {
    const {
      data: membership,
      error: membershipError,
    } = await supabase
      .from(
        "organization_members"
      )
      .select("role")
      .eq(
        "organization_id",
        organization.id
      )
      .eq(
        "user_id",
        user.id
      )
      .maybeSingle();

    if (membershipError) {
      console.error(
        "Membership error:",
        membershipError
      );
    }

    memberRole =
      membershipError ? null :
      membership?.role ?? null;
  }

  const isAdmin =
    memberRole === "admin";

  const canManageInfrastructure =
    isOwner ||
    isAdmin;

  /* =========================
     CLIENT
  ========================= */

  const {
    data: client,
    error: clientError,
  } = await supabase
    .from("clients")
    .select("*")
    .eq(
      "id",
      clientId
    )
    .eq(
      "organization_id",
      organization.id
    )
    .single();

  if (clientError) {
    console.error(
      "Client error:",
      clientError
    );
  }

  if (!client) {
    notFound();
  }

  /* =========================
     SITES
  ========================= */

  const {
    data: sites,
    error: sitesError,
  } = await supabase
    .from("sites")
    .select(`
      id,
      name
    `)
    .eq(
      "client_id",
      client.id
    )
    .order(
      "name",
      {
        ascending: true,
      }
    );

  if (sitesError) {
    console.error(
      "Sites error:",
      sitesError
    );
  }

  const siteList =
    sites ?? [];

  /* =========================
     DEVICES
  ========================= */

  const {
    data: devices,
    error: devicesError,
  } = await supabase
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
    .eq(
      "client_id",
      client.id
    )
    .order(
      "created_at",
      {
        ascending: false,
      }
    );

  if (devicesError) {
    console.error(
      "Devices error:",
      devicesError
    );
  }

  const deviceList =
    devices ?? [];

  const deviceIds = deviceList.map((device) => device.id);
  let deviceActivity: DeviceActivity[] = [];
  let activityCommands: DeviceActivityCommand[] = [];
  const activityErrors: string[] = [];
  const commandColumns = "id, device_id, command_type, status, created_at, requested_by, dispatched_at, acknowledged_at, started_at, completed_at, result, payload, error_code, error_message, update_transaction_id";

  if (deviceIds.length > 0) {
    const [auditResult, commandResult] = await Promise.all([
      supabase.from("audit_logs")
        .select("id, action, status, target_id, created_at, metadata, actor_email, user_id")
        .in("target_id", deviceIds)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("device_commands")
        .select(commandColumns)
        .in("device_id", deviceIds)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (auditResult.error) {
      console.error("Device activity audit query failed:", auditResult.error);
      activityErrors.push("Audit events could not be loaded.");
    }
    if (commandResult.error) {
      console.error("Device activity command query failed:", commandResult.error);
      activityErrors.push("Command details could not be loaded.");
    }
    deviceActivity = auditResult.data ?? [];
    activityCommands = commandResult.data ?? [];

    // A recent completion can refer to a request outside the recent-command window.
    const loadedIds = new Set(activityCommands.map((command) => command.id));
    const loadedTransactions = new Set(activityCommands.map((command) => command.update_transaction_id));
    const correlations = deviceActivity.map((event) => activityCorrelation(event.metadata));
    const isId = (id: string | undefined): id is string => Boolean(id && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id));
    const missingIds = [...new Set(correlations.map(({ commandId }) => commandId).filter(isId).filter((id) => !loadedIds.has(id)))];
    const missingTransactions = [...new Set(correlations.map(({ transactionId }) => transactionId).filter(isId).filter((id) => !loadedTransactions.has(id)))];
    const correlationFilters = [
      missingIds.length ? `id.in.(${missingIds.join(",")})` : null,
      missingTransactions.length ? `update_transaction_id.in.(${missingTransactions.join(",")})` : null,
    ].filter((value): value is string => value !== null);
    if (correlationFilters.length > 0 && !commandResult.error) {
      const { data: correlated, error } = await supabase.from("device_commands")
        .select(commandColumns)
        .in("device_id", deviceIds)
        .or(correlationFilters.join(","));
      if (error) {
        console.error("Device activity correlation query failed:", error);
        activityErrors.push("Some related command details could not be loaded.");
      } else {
        activityCommands.push(...(correlated ?? []).filter((command) => !loadedIds.has(command.id)));
      }
    }
    const transactionIds = [...new Set(activityCommands
      .filter((command) => command.command_type === "update_agent")
      .map((command) => command.update_transaction_id ?? undefined).filter(isId))];
    if (transactionIds.length > 0 && (isOwner || memberRole)) {
      try {
        // Transactions are server-only. Scope to RLS-visible devices and verified org membership.
        const { data: transactions, error } = await createAdminClient().from("agent_update_transactions")
          .select("id, device_id, target_version, devices!inner(clients!inner(organization_id))")
          .eq("devices.clients.organization_id", organization.id)
          .in("device_id", deviceIds)
          .in("id", transactionIds)
          .abortSignal(AbortSignal.timeout(3_000));
        if (error) throw error;
        activityCommands = enrichActivityUpdateCommands(activityCommands, transactions ?? []);
      } catch (error) {
        // Optional enrichment must not affect the audit/command timeline or its refresh.
        console.error("Device activity update transaction enrichment failed:",
          error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error));
      }
    }
  }

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
            activityCommands={activityCommands}
            activityError={activityErrors.length ? activityErrors.join(" ") : undefined}
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
            activity={
              deviceActivity
            }
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