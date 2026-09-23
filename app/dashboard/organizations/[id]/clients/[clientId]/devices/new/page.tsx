import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MonitorUp } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getOrganizationContext } from "@/lib/organization-context";
import DeviceEnrollment from "./device-enrollment";

export default async function AddDevicePage({
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

  const [clientResult, sitesResult] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name")
      .eq("id", clientId)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    supabase
      .from("sites")
      .select("id, name")
      .eq("client_id", clientId)
      .order("name", { ascending: true }),
  ]);

  if (clientResult.error || !clientResult.data) {
    notFound();
  }

  if (sitesResult.error) {
    console.error("Sites error:", sitesResult.error);
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
          Back to client
        </Link>

        <div className="mb-8 flex items-start gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-surface-edge bg-surface text-zinc-400">
            <MonitorUp size={24} />
          </div>

          <div>
            <h1 className="sg-page-title">Add device</h1>
            <p className="mt-2 text-surface-muted">
              Enroll a new device into <span className="text-zinc-300">{client.name}</span>.
            </p>
            <p className="mt-1 text-xs text-surface-muted">{organization.name}</p>
          </div>
        </div>

        <DeviceEnrollment
          organizationId={organization.id}
          clientId={client.id}
          clientName={client.name}
          sites={sitesResult.data ?? []}
        />
      </div>
    </div>
  );
}
