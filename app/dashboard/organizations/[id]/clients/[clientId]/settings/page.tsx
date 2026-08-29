import Link from "next/link";

import { connection } from "next/server";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  ArrowLeft,
  Settings,
} from "lucide-react";

import ClientSettingsForm from "./client-settings-form";

export default async function ClientSettingsPage({
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
    .eq("owner_id", user.id)
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
     CLIENT
  ========================= */

  const {
    data: client,
    error: clientError,
  } = await supabase
    .from("clients")
    .select(`
      id,
      name,
      description,
      status
    `)
    .eq("id", clientId)
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
      name,
      location,
      description,
      client_id
    `)
    .eq("client_id", client.id)
    .order("name", {
      ascending: true,
    });

  if (sitesError) {
    console.error(
      "Sites error:",
      sitesError
    );
  }

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
      site_id,
      status
    `)
    .eq("client_id", client.id)
    .order("hostname", {
      ascending: true,
    });

  if (devicesError) {
    console.error(
      "Devices error:",
      devicesError
    );
  }

  return (
    <main className="p-8">
      <div className="mx-auto max-w-4xl">

        {/* BACK */}

        <Link
          href={`/dashboard/organizations/${organization.id}/clients/${client.id}`}
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"
        >
          <ArrowLeft size={16} />
          Back to client
        </Link>

        {/* HEADER */}

        <div className="mb-8 flex items-start gap-4">

          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400">
            <Settings size={21} />
          </div>

          <div>
            <h1 className="text-3xl font-bold">
              Client settings
            </h1>

            <p className="mt-2 text-zinc-400">
              Manage settings for{" "}
              <span className="text-zinc-200">
                {client.name}
              </span>
              .
            </p>
          </div>

        </div>

        <ClientSettingsForm
          organizationId={
            organization.id
          }
          client={client}
          initialSites={
            sites ?? []
          }
          initialDevices={
            devices ?? []
          }
        />

      </div>
    </main>
  );
}