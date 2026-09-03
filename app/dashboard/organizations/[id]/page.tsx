import Link from "next/link";

import { connection } from "next/server";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import OrganizationClients from "./organization-clients";

import {
  ArrowLeft,
  Building2,
  Plus,
  Settings,
  Server,
  MapPin,
  ShieldCheck,
} from "lucide-react";

export default async function OrganizationDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const { id } = await params;

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

  if (organizationError) {
    console.error(
      "Organization error:",
      organizationError
    );
  }

  if (!organization) {
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

  const isMember =
    memberRole === "member";

  /* =========================
     PERMISSIONS
  ========================= */

  const canManageOrganization =
    isOwner;

  const canManageInfrastructure =
    isOwner || isAdmin;

  /* =========================
     CLIENTS
  ========================= */

  const {
    data: clients,
    error: clientsError,
  } = await supabase
    .from("clients")
    .select(`
      id,
      name,
      description,
      status
    `)
    .eq(
      "organization_id",
      organization.id
    )
    .order("created_at", {
      ascending: false,
    });

  if (clientsError) {
    console.error(
      "Organization clients error:",
      clientsError
    );
  }

  const clientList =
    clients ?? [];

  const clientsCount =
    clientList.length;

  /* =========================
     CLIENT IDS
  ========================= */

  const clientIds =
    clientList.map(
      (client) =>
        client.id
    );

  /* =========================
     SITES COUNT
  ========================= */

  let sitesCount = 0;

  if (clientIds.length > 0) {
    const {
      count,
      error,
    } = await supabase
      .from("sites")
      .select("id", {
        count: "exact",
        head: true,
      })
      .in(
        "client_id",
        clientIds
      );

    if (error) {
      console.error(
        "Sites count error:",
        error
      );
    }

    sitesCount =
      count ?? 0;
  }

  /* =========================
     DEVICES COUNT
  ========================= */

  let devicesCount = 0;

  if (clientIds.length > 0) {
    const {
      count,
      error,
    } = await supabase
      .from("devices")
      .select("id", {
        count: "exact",
        head: true,
      })
      .in(
        "client_id",
        clientIds
      );

    if (error) {
      console.error(
        "Devices count error:",
        error
      );
    }

    devicesCount =
      count ?? 0;
  }

  return (
    <main className="p-8">

      <div className="mx-auto max-w-7xl">

        {/* =========================
            HEADER
        ========================= */}

        <div className="mb-8 flex flex-wrap items-start justify-between gap-6">

          {/* LEFT */}

          <div className="flex items-start gap-5">

            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-[#0d0f12] text-zinc-400">
              <Building2 size={24} />
            </div>

            <div>

              <div className="flex flex-wrap items-center gap-3">

                <h1 className="text-3xl font-bold">
                  {organization.name}
                </h1>

                {/* =========================
                    ROLE BADGE
                ========================= */}

                {isOwner ? (

                  <div className="flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">
                    <ShieldCheck size={12} />
                    Owner
                  </div>

                ) : isAdmin ? (

                  <div className="flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-400">
                    <ShieldCheck size={12} />
                    Admin
                  </div>

                ) : isMember ? (

                  <div className="flex items-center gap-1.5 rounded-full border border-blue-500/25 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400">
                    <ShieldCheck size={12} />
                    Member
                  </div>

                ) : null}

              </div>

              <p className="mt-2 max-w-2xl text-zinc-400">
                {organization.description ||
                  "No description provided."}
              </p>

            </div>

          </div>

          {/* RIGHT */}

          <div className="flex flex-wrap items-center justify-end gap-4">

            {/* =========================
                STATS
            ========================= */}

            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-[#0d0f12] px-4 py-2.5">

              {/* CLIENTS */}

              <div className="flex items-center gap-2">

                <Building2
                  size={15}
                  className="text-zinc-600"
                />

                <span className="text-sm text-zinc-500">
                  Clients
                </span>

                <span className="text-sm font-semibold text-white">
                  {clientsCount}
                </span>

              </div>

              <div className="hidden h-4 w-px bg-zinc-800 sm:block" />

              {/* SITES */}

              <div className="flex items-center gap-2">

                <MapPin
                  size={15}
                  className="text-zinc-600"
                />

                <span className="text-sm text-zinc-500">
                  Sites
                </span>

                <span className="text-sm font-semibold text-white">
                  {sitesCount}
                </span>

              </div>

              <div className="hidden h-4 w-px bg-zinc-800 sm:block" />

              {/* DEVICES */}

              <div className="flex items-center gap-2">

                <Server
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

            </div>

            {/* =========================
                ACTIONS
            ========================= */}

            <div className="flex items-center gap-3">

              {/* OWNER ONLY */}

              {canManageOrganization && (
                <Link
                  href={`/dashboard/organizations/${organization.id}/settings`}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-[#0d0f12] px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                >
                  <Settings size={17} />

                  Settings
                </Link>
              )}

              {/* OWNER + ADMIN */}

              {canManageInfrastructure && (
                <Link
                  href={`/dashboard/organizations/${organization.id}/clients/new`}
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
                >
                  <Plus size={17} />

                  Add client
                </Link>
              )}

            </div>

          </div>

        </div>

        {/* =========================
            CLIENTS
        ========================= */}

        <section className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-6">

          {/* HEADER */}

          <div className="mb-6">

            <h2 className="text-lg font-semibold">
              Clients
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              {canManageInfrastructure
                ? "Manage and access the clients connected to this organization."
                : "View and access the clients connected to this organization."}
            </p>

          </div>

          {/* EMPTY */}

          {clientList.length === 0 ? (

            <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-800 bg-[#090a0c] px-6 py-14 text-center">

              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-[#070809] text-zinc-500">
                <Building2 size={21} />
              </div>

              <h3 className="mt-5 font-semibold">
                No clients configured
              </h3>

              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
                {canManageInfrastructure
                  ? "Create your first client to start managing sites, devices and security monitoring."
                  : "This organization does not have any clients configured yet."}
              </p>

              {canManageInfrastructure && (
                <Link
                  href={`/dashboard/organizations/${organization.id}/clients/new`}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
                >
                  <Plus size={16} />

                  Create first client
                </Link>
              )}

            </div>

          ) : (

            <OrganizationClients
              organizationId={
                organization.id
              }
              clients={
                clientList
              }
            />

          )}

        </section>

      </div>

    </main>
  );
}