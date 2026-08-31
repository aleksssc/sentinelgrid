import Link from "next/link";

import { connection } from "next/server";
import { notFound } from "next/navigation";

import {
  ArrowLeft,
  MonitorUp,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";

import DeviceEnrollment from "./device-enrollment";

export default async function AddDevicePage({
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
  } =
    await supabase
      .from("organizations")
      .select(`
        id,
        name,
        owner_id
      `)
      .eq(
        "id",
        id
      )
      .maybeSingle();

  if (
    organizationError ||
    !organization
  ) {
    notFound();
  }

  /* =========================
     PERMISSIONS
     OWNER + ADMIN
  ========================= */

  const isOwner =
    organization.owner_id ===
    user.id;

  let isAdmin = false;

  if (!isOwner) {
    const {
      data: membership,
      error: membershipError,
    } =
      await supabase
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

    isAdmin =
      membership?.role ===
      "admin";
  }

  if (
    !isOwner &&
    !isAdmin
  ) {
    notFound();
  }

  /* =========================
     CLIENT
  ========================= */

  const {
    data: client,
    error: clientError,
  } =
    await supabase
      .from("clients")
      .select(`
        id,
        name
      `)
      .eq(
        "id",
        clientId
      )
      .eq(
        "organization_id",
        organization.id
      )
      .maybeSingle();

  if (
    clientError ||
    !client
  ) {
    notFound();
  }

  /* =========================
     SITES
  ========================= */

  const {
    data: sites,
    error: sitesError,
  } =
    await supabase
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

  return (
    <main className="relative z-10 p-8">

      <div className="mx-auto max-w-4xl">

        {/* =========================
            BACK
        ========================= */}

        <Link
          href={`/dashboard/organizations/${organization.id}/clients/${client.id}`}
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"
        >
          <ArrowLeft
            size={16}
          />

          Back to client
        </Link>

        {/* =========================
            HEADER
        ========================= */}

        <div className="mb-8 flex items-start gap-5">

          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-[#0d0f12] text-zinc-400">
            <MonitorUp
              size={24}
            />
          </div>

          <div>

            <h1 className="text-3xl font-bold tracking-tight text-white">
              Add device
            </h1>

            <p className="mt-2 text-zinc-500">
              Enroll a new device into{" "}
              <span className="text-zinc-300">
                {client.name}
              </span>
              .
            </p>

            <p className="mt-1 text-xs text-zinc-600">
              {organization.name}
            </p>

          </div>

        </div>

        {/* =========================
            ENROLLMENT
        ========================= */}

        <DeviceEnrollment
          organizationId={
            organization.id
          }
          clientId={
            client.id
          }
          sites={
            sites ?? []
          }
        />

      </div>

    </main>
  );
}