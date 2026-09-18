import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AdminDefinitionGrid,
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
} from "@/components/admin/admin-primitives";

type Organization = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string | null;
};

type Client = { id: string };
type Member = { user_id: string; role: string | null };

export default async function AdminOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: organization } = await admin
    .from("organizations")
    .select("id, name, owner_id, created_at")
    .eq("id", id)
    .maybeSingle<Organization>();

  if (!organization) notFound();

  const [
    { data: allUsers },
    { data: members },
    { data: clients },
    { count: devices },
    { data: policy },
  ] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", id)
      .returns<Member[]>(),
    admin.from("clients").select("id").eq("organization_id", id).returns<Client[]>(),
    admin
      .from("devices")
      .select("id, clients!inner(organization_id)", { count: "exact", head: true })
      .eq("clients.organization_id", id),
    admin
      .from("organization_agent_update_settings")
      .select("channel, automatic_updates, update_delay_hours")
      .eq("organization_id", id)
      .maybeSingle(),
  ]);

  const clientIds = (clients ?? []).map((client) => client.id);

  const [{ count: sites }, { count: monitors }] = await Promise.all([
    clientIds.length
      ? admin
          .from("sites")
          .select("id", { count: "exact", head: true })
          .in("client_id", clientIds)
      : Promise.resolve({ count: 0 }),
    admin
      .from("monitors")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", id),
  ]);

  const users = new Map((allUsers?.users ?? []).map((user) => [user.id, user]));
  const owner = users.get(organization.owner_id);

  const memberMap = new Map<string, { userId: string; role: string }>();
  memberMap.set(organization.owner_id, {
    userId: organization.owner_id,
    role: "owner",
  });

  for (const member of members ?? []) {
    if (member.user_id === organization.owner_id) continue;
    memberMap.set(member.user_id, {
      userId: member.user_id,
      role: member.role ?? "member",
    });
  }

  const displayMembers = Array.from(memberMap.values());

  const created = organization.created_at
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
        new Date(organization.created_at),
      )
    : "Not available";

  return (
    <>
      <AdminPageHeader
        eyebrow="Organization"
        title={organization.name}
        description={<span className="font-mono">{organization.id}</span>}
        backHref="/admin/organizations"
        backLabel="Organizations"
      />

      <AdminMetricStrip
        label="Organization usage"
        items={[
          { label: "Members", value: displayMembers.length },
          { label: "Clients", value: clients?.length ?? 0 },
          { label: "Sites", value: sites ?? "—" },
          { label: "Devices", value: devices ?? "—" },
          { label: "Monitors", value: monitors ?? "—" },
        ]}
      />

      <AdminSection title="Organization" description="Ownership and Agent update policy.">
        <div className="sg-admin-two-column">
          <div>
            <p className="sg-admin-subsection-title">Account</p>
            <AdminDefinitionGrid
              columns={1}
              items={[
                {
                  label: "Owner",
                  value: owner ? (
                    <Link
                      href={`/admin/users/${owner.id}`}
                      className="text-surface-accent hover:underline"
                    >
                      {owner.email ?? owner.id}
                    </Link>
                  ) : (
                    "Unknown user"
                  ),
                },
                { label: "Created", value: created },
                { label: "Organization ID", value: organization.id, mono: true },
              ]}
            />
          </div>

          <div>
            <p className="sg-admin-subsection-title">Agent policy</p>
            <AdminDefinitionGrid
              columns={1}
              items={[
                { label: "Release channel", value: policy?.channel ?? "Unknown" },
                {
                  label: "Automatic updates",
                  value:
                    typeof policy?.automatic_updates === "boolean"
                      ? policy.automatic_updates
                        ? "Enabled"
                        : "Disabled"
                      : "Unknown",
                },
                {
                  label: "Update delay",
                  value:
                    typeof policy?.update_delay_hours === "number"
                      ? `${policy.update_delay_hours} hours`
                      : "Unknown",
                },
              ]}
            />
          </div>
        </div>
      </AdminSection>

      <AdminSection
        title="Members"
        description={`${displayMembers.length} account${displayMembers.length === 1 ? "" : "s"} with organization access.`}
      >
        <div className="sg-admin-member-list">
          {displayMembers.map((member) => {
            const user = users.get(member.userId);

            return (
              <Link
                key={member.userId}
                href={`/admin/users/${member.userId}`}
                className="sg-admin-member-row"
              >
                <div className="min-w-0">
                  <strong>{user?.email ?? member.userId}</strong>
                  <p className="font-mono">{member.userId}</p>
                </div>
                <span className="sg-admin-member-role">{member.role}</span>
              </Link>
            );
          })}
        </div>
      </AdminSection>
    </>
  );
}
