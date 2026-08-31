import Link from "next/link";

import { connection } from "next/server";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
  await connection();

  const { id, clientId } = await params;

  const supabase = await createClient();

  /* =========================
     USER
  ========================= */

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    organization.owner_id === user.id;

  let memberRole: string | null = null;

  if (!isOwner) {
    const {
      data: membership,
      error: membershipError,
    } = await supabase
      .from("organization_members")
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
      membership?.role ?? null;
  }

  const isAdmin =
    memberRole === "admin";

  /*
    Owner + Admin
    = infrastructure management

    Member
    = read-only
  */

  const canManageInfrastructure =
    isOwner || isAdmin;

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
      local_ip,
      public_ip,
      mac_address,
      status,
      agent_id,
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

  /* =========================
     STATS
  ========================= */

  const devicesCount =
    deviceList.length;

  const onlineCount =
    deviceList.filter(
      (device) =>
        device.status ===
        "online"
    ).length;

  const offlineCount =
    deviceList.filter(
      (device) =>
        device.status ===
        "offline"
    ).length;

  const warningCount =
    deviceList.filter(
      (device) =>
        device.status ===
        "warning"
    ).length;

  const alertsCount =
    warningCount;

  return (
    <main className="p-8">
      <div className="mx-auto max-w-7xl">

        {/* =========================
            BACK
        ========================= */}

        <Link
          href={`/dashboard/organizations/${organization.id}`}
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"
        >
          <ArrowLeft size={16} />

          Back to organization
        </Link>

        {/* =========================
            HEADER
        ========================= */}

        <div className="mb-8 flex flex-wrap items-start justify-between gap-6">

          {/* LEFT */}

          <div className="flex items-start gap-5">

            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-400">
              <Building2 size={24} />
            </div>

            <div>

              <div className="flex flex-wrap items-center gap-3">

                <h1 className="text-3xl font-bold">
                  {client.name}
                </h1>

                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    client.status ===
                    "active"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {client.status ===
                  "active"
                    ? "Active"
                    : "Inactive"}
                </span>

              </div>

              <p className="mt-2 max-w-2xl text-zinc-400">
                {client.description ||
                  "No description provided."}
              </p>

              <p className="mt-2 text-xs text-zinc-600">
                {organization.name}
              </p>

            </div>

          </div>

          {/* RIGHT */}

          <div className="flex flex-wrap items-center justify-end gap-4">

            {/* =========================
                STATS
            ========================= */}

            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-[#0d0f12] px-4 py-2.5">

              {/* DEVICES */}

              <div className="flex items-center gap-2">

                <Monitor
                  size={15}
                  className="text-zinc-600"
                />

                <span className="text-sm text-zinc-500">
                  Devices
                </span>

                <span className="text-sm font-semibold text-white">
                  {devicesCount}
                </span>

              </div>

              <div className="hidden h-4 w-px bg-zinc-800 sm:block" />

              {/* ONLINE */}

              <div className="flex items-center gap-2">

                <Wifi
                  size={15}
                  className="text-emerald-500/70"
                />

                <span className="text-sm text-zinc-500">
                  Online
                </span>

                <span className="text-sm font-semibold text-white">
                  {onlineCount}
                </span>

              </div>

              <div className="hidden h-4 w-px bg-zinc-800 sm:block" />

              {/* OFFLINE */}

              <div className="flex items-center gap-2">

                <WifiOff
                  size={15}
                  className="text-zinc-600"
                />

                <span className="text-sm text-zinc-500">
                  Offline
                </span>

                <span className="text-sm font-semibold text-white">
                  {offlineCount}
                </span>

              </div>

              <div className="hidden h-4 w-px bg-zinc-800 sm:block" />

              {/* ALERTS */}

              <div className="flex items-center gap-2">

                <ShieldAlert
                  size={15}
                  className={
                    alertsCount > 0
                      ? "text-amber-500/80"
                      : "text-zinc-600"
                  }
                />

                <span className="text-sm text-zinc-500">
                  Alerts
                </span>

                <span className="text-sm font-semibold text-white">
                  {alertsCount}
                </span>

              </div>

            </div>

            {/* =========================
                ACTIONS
                OWNER + ADMIN
            ========================= */}

            {canManageInfrastructure && (
              <div className="flex items-center gap-3">

                {/* SETTINGS */}

                <Link
                  href={`/dashboard/organizations/${organization.id}/clients/${client.id}/settings`}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                >
                  <Settings size={17} />

                  Settings
                </Link>

                {/* ADD DEVICE */}

                <Link
                  href={`/dashboard/organizations/${organization.id}/clients/${client.id}/devices/new`}
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
                >
                  <Plus size={17} />

                  Add device
                </Link>

              </div>
            )}

          </div>

        </div>

        {/* =========================
            DEVICES AREA
        ========================= */}

        <section className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-6">

          <div className="mb-6">

            <h2 className="text-lg font-semibold">
              Devices
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              {canManageInfrastructure
                ? "Monitor and manage the devices registered for this client."
                : "View, search and filter the devices registered for this client."}
            </p>

          </div>

          <DeviceDashboard
            devices={deviceList}
            sites={siteList}
            canManage={
              canManageInfrastructure
            }
          />

        </section>

      </div>
    </main>
  );
}