import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Settings } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getOrganizationContext } from "@/lib/organization-context";
import ClientSettingsForm from "./client-settings-form";

export default async function ClientSettingsPage({
  params,
}: {
  params: Promise<{
    id: string;
    clientId: string;
  }>;
}) {
  const { id, clientId } = await params;
  const context = await getOrganizationContext();

  if (!context.user) {
    return null;
  }

  const organization = context.organizations.find((item) => item.id === id);
  const role = context.organizationRoles[id];

  if (!organization || !role || (role !== "owner" && role !== "admin")) {
    notFound();
  }

  const supabase = await createClient();

  const [clientResult, sitesResult, devicesResult] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, description, status")
      .eq("id", clientId)
      .eq("organization_id", organization.id)
      .single(),
    supabase
      .from("sites")
      .select("id, name, location, description, client_id")
      .eq("client_id", clientId)
      .order("name", { ascending: true }),
    supabase
      .from("devices")
      .select("id, hostname, display_name, site_id, status")
      .eq("client_id", clientId)
      .order("hostname", { ascending: true }),
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

  return (
    <div className="sg-page-shell">
      <div className="sg-page">
        <Link
          href={`/dashboard/organizations/${organization.id}/clients/${client.id}`}
          className="mb-6 inline-flex items-center gap-2 text-sm text-surface-muted transition hover:text-white"
        >
          <ArrowLeft size={16} />
          Back to {client.name}
        </Link>

        <div className="mb-8">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-surface-edge bg-surface text-zinc-400">
            <Settings size={22} />
          </div>

          <h1 className="sg-page-title">Client settings</h1>

          <p className="mt-2 text-zinc-400">
            Manage settings for <span className="text-zinc-200">{client.name}</span>.
          </p>
        </div>

        <ClientSettingsForm
          organizationId={organization.id}
          client={client}
          initialSites={sitesResult.data ?? []}
          initialDevices={devicesResult.data ?? []}
        />
      </div>
    </div>
  );
}
