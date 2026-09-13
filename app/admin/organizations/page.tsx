import { Building2 } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyState, PageHeader, SectionHeader, Surface } from "@/components/dashboard/dashboard-primitives";
import { AdminOrganizationsInventory, type AdminOrganizationRow } from "@/components/admin/admin-inventories";

type Organization = { id: string; name: string; owner_id: string; created_at: string | null };
type Member = { organization_id: string; user_id: string };
type Client = { organization_id: string };
type Device = { clients: { organization_id: string } | null };

export default async function AdminOrganizationsPage() {
  const admin = createAdminClient();
  const [{ data: organizations, error }, { data: members }, { data: clients }, { data: devices }, users] = await Promise.all([
    admin.from("organizations").select("id, name, owner_id, created_at").order("created_at", { ascending: false }).returns<Organization[]>(),
    admin.from("organization_members").select("organization_id, user_id").returns<Member[]>(),
    admin.from("clients").select("organization_id").returns<Client[]>(),
    admin.from("devices").select("clients!inner(organization_id)").returns<Device[]>(),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const emails = new Map((users.data.users ?? []).map((user) => [user.id, user.email ?? "Unknown user"]));
  const memberCounts = countsBy(members ?? [], (row) => row.organization_id);
  const clientCounts = countsBy(clients ?? [], (row) => row.organization_id);
  const deviceCounts = countsBy((devices ?? []).flatMap((row) => row.clients ? [row.clients] : []), (row) => row.organization_id);
  const inventory: AdminOrganizationRow[] = (organizations ?? []).map((organization) => ({
    id: organization.id,
    name: organization.name,
    ownerEmail: emails.get(organization.owner_id) ?? "Unknown user",
    members: memberCounts.get(organization.id) ?? 0,
    clients: clientCounts.get(organization.id) ?? 0,
    devices: deviceCounts.get(organization.id) ?? 0,
  }));

  return <><PageHeader title="Organizations" eyebrow="Platform administration" icon={<Building2 size={22} />} description="Read-only organization inventory across SentinelGrid." /><Surface className="mt-5 overflow-hidden"><SectionHeader title="Organizations" description="Search and filters update the current inventory instantly." icon={<Building2 size={17} />} />{error ? <div role="alert" className="sg-inline-notice">Organizations could not be loaded. Refresh to retry.</div> : !inventory.length ? <EmptyState title="No organizations" description="Organizations will appear here when they are created." icon={<Building2 size={22} />} /> : <AdminOrganizationsInventory organizations={inventory} />}</Surface></>;
}

function countsBy<T>(rows: T[], getKey: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = getKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
