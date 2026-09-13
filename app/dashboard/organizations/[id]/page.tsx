import { RoleBadge } from "@/components/dashboard/dashboard-badges";
import { PageHeader, CompactSummary, SectionHeader } from "@/components/dashboard/dashboard-primitives";
import Link from "next/link";

import { connection } from "next/server";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import OrganizationClients from "./organization-clients";

import {
  Building2,
  Plus,
  Settings,
  Server,
  MapPin,
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
    <div className="sg-page-shell">

      <div className="sg-page">

        {/* =========================
            HEADER
        ========================= */}

        <PageHeader compact
          title={organization.name}
          icon={<Building2 size={19} />}
          badge={(isOwner || isAdmin || isMember) && <RoleBadge role={isOwner ? "owner" : isAdmin ? "admin" : "member"} />}
          description={organization.description || "Manage your clients, sites and devices."}
          actions={<>
            {canManageOrganization && <Link href={`/dashboard/organizations/${organization.id}/settings`} className="sg-button sg-button-secondary sg-button-sm"><Settings size={15} />Settings</Link>}
            {canManageInfrastructure && <Link href={`/dashboard/organizations/${organization.id}/clients/new`} className="sg-button sg-button-primary sg-button-sm"><Plus size={15} />Add client</Link>}
          </>}
        />
        <CompactSummary label="Organization infrastructure summary" items={[
          { label: "Clients", value: clientsCount, icon: <Building2 size={14} /> },
          { label: "Sites", value: sitesCount, icon: <MapPin size={14} /> },
          { label: "Devices", value: devicesCount, icon: <Server size={14} /> },
        ]} />

        <section className="sg-surface sg-clients-panel">

          {/* HEADER */}

          <SectionHeader title="Clients" description="Your managed workspaces" />
          <div className="sg-panel-body">

          {/* EMPTY */}

          {clientList.length === 0 ? (

            <div className="sg-empty flex flex-col items-center text-center">

              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-surface-edge bg-surface-inset text-surface-muted">
                <Building2 size={21} />
              </div>

              <h3 className="mt-5 font-semibold">
                No clients configured
              </h3>

              <p className="mt-2 max-w-md text-sm leading-6 text-surface-muted">
                {canManageInfrastructure
                  ? "Create your first client to start managing sites, devices and security monitoring."
                  : "This organization does not have any clients configured yet."}
              </p>

              {canManageInfrastructure && (
                <Link
                  href={`/dashboard/organizations/${organization.id}/clients/new`}
                  className="sg-button sg-button-primary mt-6"
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

          </div>
        </section>

      </div>

    </div>
  );
}