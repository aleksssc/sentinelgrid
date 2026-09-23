import { RoleBadge } from "@/components/dashboard/dashboard-badges";
import { PageHeader, CompactSummary, SectionHeader } from "@/components/dashboard/dashboard-primitives";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrganizationContext } from "@/lib/organization-context";
import OrganizationClients from "./organization-clients";
import { Building2, Plus, Settings, Server, MapPin } from "lucide-react";

type Client = { id: string; name: string; description: string | null; status: "active" | "inactive" };
type Device = { client_id: string; status: string | null; last_seen: string | null };
type Site = { client_id: string };

export default async function OrganizationDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getOrganizationContext();
  if (!context.user) return null;

  const organization = context.organizations.find((item) => item.id === id);
  const role = context.organizationRoles[id];
  if (!organization || !role) notFound();

  const isOwner = role === "owner";
  const isAdmin = role === "admin";
  const isMember = role === "member";
  const canManageOrganization = isOwner;
  const canManageInfrastructure = isOwner || isAdmin;

  const supabase = await createClient();
  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, name, description, status")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .returns<Client[]>();

  if (clientsError) console.error("Organization clients error:", clientsError);
  const clientList = clients ?? [];
  const clientIds = clientList.map((client) => client.id);

  let sites: Site[] = [];
  let devices: Device[] = [];

  if (clientIds.length) {
    const [sitesResult, devicesResult] = await Promise.all([
      supabase.from("sites").select("client_id").in("client_id", clientIds).returns<Site[]>(),
      supabase.from("devices").select("client_id, status, last_seen").in("client_id", clientIds).returns<Device[]>(),
    ]);

    if (sitesResult.error) console.error("Sites count error:", sitesResult.error);
    else sites = sitesResult.data ?? [];

    if (devicesResult.error) console.error("Devices count error:", devicesResult.error);
    else devices = devicesResult.data ?? [];
  }

  const now = Date.now();
  const deviceBuckets = new Map<string, Device[]>();
  const siteCounts = new Map<string, number>();

  for (const device of devices) {
    const bucket = deviceBuckets.get(device.client_id);
    if (bucket) bucket.push(device);
    else deviceBuckets.set(device.client_id, [device]);
  }

  for (const site of sites) {
    siteCounts.set(site.client_id, (siteCounts.get(site.client_id) ?? 0) + 1);
  }

  const clientsWithContext = clientList.map((client) => {
    const clientDevices = deviceBuckets.get(client.id) ?? [];
    const online = clientDevices.filter((device) => {
      const lastSeen = Date.parse(device.last_seen ?? "");
      return device.status === "online" && Number.isFinite(lastSeen) && now - lastSeen <= 90_000;
    }).length;
    const issues = clientDevices.length - online;
    const siteCount = siteCounts.get(client.id) ?? 0;

    return {
      ...client,
      operationalSummary: `${siteCount} site${siteCount === 1 ? "" : "s"} · ${clientDevices.length} device${clientDevices.length === 1 ? "" : "s"} · ${online} online${issues ? ` · ${issues} with issues` : ""}`,
    };
  });

  return <div className="sg-page-shell"><div className="sg-page">
    <PageHeader title={organization.name} icon={<Building2 size={22} />} badge={(isOwner || isAdmin || isMember) && <RoleBadge role={role} />} description={organization.description || "Manage your clients, sites and devices."} actions={<>{canManageOrganization && <Link href={`/dashboard/organizations/${organization.id}/settings`} className="sg-button sg-button-secondary"><Settings size={15} />Settings</Link>}{canManageInfrastructure && <Link href={`/dashboard/organizations/${organization.id}/clients/new`} className="sg-button sg-button-primary"><Plus size={15} />Add client</Link>}</>} />
    <CompactSummary label="Organization infrastructure summary" items={[{ label: "Clients", value: clientList.length, icon: <Building2 size={14} /> }, { label: "Sites", value: sites.length, icon: <MapPin size={14} /> }, { label: "Devices", value: devices.length, icon: <Server size={14} /> }]} />
    <section className="sg-surface sg-clients-panel"><SectionHeader title="Clients" description="Your managed workspaces" /><div className="sg-panel-body">{clientList.length === 0 ? <div className="sg-empty flex flex-col items-center text-center"><div className="flex h-12 w-12 items-center justify-center rounded-xl border border-surface-edge bg-surface-inset text-surface-muted"><Building2 size={21} /></div><h3 className="mt-5 font-semibold">No clients configured</h3><p className="mt-2 max-w-md text-sm leading-6 text-surface-muted">{canManageInfrastructure ? "Create your first client to start managing sites, devices and security monitoring." : "This organization does not have any clients configured yet."}</p>{canManageInfrastructure && <Link href={`/dashboard/organizations/${organization.id}/clients/new`} className="sg-button sg-button-primary mt-6"><Plus size={16} />Create first client</Link>}</div> : <OrganizationClients organizationId={organization.id} clients={clientsWithContext} />}</div></section>
  </div></div>;
}
