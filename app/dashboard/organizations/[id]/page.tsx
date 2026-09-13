import { RoleBadge } from "@/components/dashboard/dashboard-badges";
import { PageHeader, CompactSummary, SectionHeader } from "@/components/dashboard/dashboard-primitives";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OrganizationClients from "./organization-clients";
import { Building2, Plus, Settings, Server, MapPin } from "lucide-react";

type Client = { id: string; name: string; description: string | null; status: "active" | "inactive" };
type Device = { client_id: string; status: string | null; last_seen: string | null };
type Site = { client_id: string };

export default async function OrganizationDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: organization, error: organizationError } = await supabase.from("organizations").select("*").eq("id", id).single();
  if (organizationError) console.error("Organization error:", organizationError);
  if (!organization) notFound();

  let memberRole: string | null = null;
  if (organization.owner_id !== user.id) {
    const { data: membership, error } = await supabase.from("organization_members").select("role").eq("organization_id", organization.id).eq("user_id", user.id).maybeSingle();
    if (error) console.error("Membership error:", error);
    memberRole = membership?.role ?? null;
  }
  const isOwner = organization.owner_id === user.id;
  const isAdmin = memberRole === "admin";
  const isMember = memberRole === "member";
  const canManageOrganization = isOwner;
  const canManageInfrastructure = isOwner || isAdmin;

  const { data: clients, error: clientsError } = await supabase.from("clients").select("id, name, description, status").eq("organization_id", organization.id).order("created_at", { ascending: false }).returns<Client[]>();
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
    if (sitesResult.error) console.error("Sites count error:", sitesResult.error); else sites = sitesResult.data ?? [];
    if (devicesResult.error) console.error("Devices count error:", devicesResult.error); else devices = devicesResult.data ?? [];
  }
  const now = Date.now();
  const clientsWithContext = clientList.map((client) => {
    const clientDevices = devices.filter((device) => device.client_id === client.id);
    const online = clientDevices.filter((device) => device.status === "online" && Number.isFinite(Date.parse(device.last_seen ?? "")) && now - Date.parse(device.last_seen!) <= 90_000).length;
    const issues = clientDevices.filter((device) => device.status === "warning" || device.status === "offline" || !Number.isFinite(Date.parse(device.last_seen ?? "")) || now - Date.parse(device.last_seen!) > 90_000).length;
    const siteCount = sites.filter((site) => site.client_id === client.id).length;
    return { ...client, operationalSummary: `${siteCount} site${siteCount === 1 ? "" : "s"} · ${clientDevices.length} device${clientDevices.length === 1 ? "" : "s"} · ${online} online${issues ? ` · ${issues} with issues` : ""}` };
  });

  return <div className="sg-page-shell"><div className="sg-page">
    <PageHeader title={organization.name} icon={<Building2 size={22} />} badge={(isOwner || isAdmin || isMember) && <RoleBadge role={isOwner ? "owner" : isAdmin ? "admin" : "member"} />} description={organization.description || "Manage your clients, sites and devices."} actions={<>{canManageOrganization && <Link href={`/dashboard/organizations/${organization.id}/settings`} className="sg-button sg-button-secondary"><Settings size={15} />Settings</Link>}{canManageInfrastructure && <Link href={`/dashboard/organizations/${organization.id}/clients/new`} className="sg-button sg-button-primary"><Plus size={15} />Add client</Link>}</>} />
    <CompactSummary label="Organization infrastructure summary" items={[{ label: "Clients", value: clientList.length, icon: <Building2 size={14} /> }, { label: "Sites", value: sites.length, icon: <MapPin size={14} /> }, { label: "Devices", value: devices.length, icon: <Server size={14} /> }]} />
    <section className="sg-surface sg-clients-panel"><SectionHeader title="Clients" description="Your managed workspaces" /><div className="sg-panel-body">{clientList.length === 0 ? <div className="sg-empty flex flex-col items-center text-center"><div className="flex h-12 w-12 items-center justify-center rounded-xl border border-surface-edge bg-surface-inset text-surface-muted"><Building2 size={21} /></div><h3 className="mt-5 font-semibold">No clients configured</h3><p className="mt-2 max-w-md text-sm leading-6 text-surface-muted">{canManageInfrastructure ? "Create your first client to start managing sites, devices and security monitoring." : "This organization does not have any clients configured yet."}</p>{canManageInfrastructure && <Link href={`/dashboard/organizations/${organization.id}/clients/new`} className="sg-button sg-button-primary mt-6"><Plus size={16} />Create first client</Link>}</div> : <OrganizationClients organizationId={organization.id} clients={clientsWithContext} />}</div></section>
  </div></div>;
}
