import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformRole, requirePlatformActor } from "@/lib/platform-access";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { UserActions } from "@/components/admin/user-actions";
import {
  AdminDefinitionGrid,
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
} from "@/components/admin/admin-primitives";

type Membership = {
  organization_id: string;
  role: string | null;
  organizations: { name: string } | null;
};

type Audit = {
  id: string;
  action: string;
  status: string | null;
  created_at: string;
  target_name: string | null;
};

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  const [actor, admin] = await Promise.all([
    requirePlatformActor(),
    Promise.resolve(createAdminClient()),
  ]);

  const [{ data, error }, { data: memberships }, { data: ownedOrganizations }, { data: audit }] =
    await Promise.all([
      admin.auth.admin.getUserById(userId),
      admin
        .from("organization_members")
        .select("organization_id, role, organizations(name)")
        .eq("user_id", userId)
        .returns<Membership[]>(),
      admin.from("organizations").select("id, name").eq("owner_id", userId),
      admin
        .from("audit_logs")
        .select("id, action, status, created_at, target_name")
        .eq("target_id", userId)
        .order("created_at", { ascending: false })
        .limit(20)
        .returns<Audit[]>(),
    ]);

  const user = data.user;
  if (error || !user) notFound();

  const platformRole = isPlatformRole(user.app_metadata.platform_role)
    ? user.app_metadata.platform_role
    : null;

  const suspended = Boolean(user.banned_until);

  const membershipMap = new Map<string, { organization_id: string; role: string; name: string }>();

  for (const organization of ownedOrganizations ?? []) {
    membershipMap.set(organization.id, {
      organization_id: organization.id,
      role: "owner",
      name: organization.name,
    });
  }

  for (const membership of memberships ?? []) {
    if (membershipMap.has(membership.organization_id)) continue;
    membershipMap.set(membership.organization_id, {
      organization_id: membership.organization_id,
      role: membership.role ?? "member",
      name: membership.organizations?.name ?? membership.organization_id,
    });
  }

  const allMemberships = Array.from(membershipMap.values());
  const roleLabel =
    platformRole === "developer"
      ? "Developer"
      : platformRole === "platform_admin"
        ? "Platform Admin"
        : "No platform access";

  return (
    <>
      <AdminPageHeader
        eyebrow="User"
        title={user.email ?? "Email unavailable"}
        description={<span className="font-mono">{user.id}</span>}
        backHref="/admin/users"
        backLabel="Users"
        badges={
          <>
            <StatusBadge
              status={suspended ? "Suspended" : "Active"}
              tone={suspended ? "warning" : "success"}
            />
            {platformRole && (
              <StatusBadge status={platformRole} tone="info">
                {roleLabel}
              </StatusBadge>
            )}
          </>
        }
      />

      <AdminMetricStrip
        label="User summary"
        items={[
          {
            label: "Account",
            value: suspended ? "Suspended" : "Active",
            tone: suspended ? "warning" : "success",
          },
          { label: "Organizations", value: allMemberships.length },
          { label: "Platform access", value: platformRole ? roleLabel : "None" },
          {
            label: "Last sign in",
            value: user.last_sign_in_at ? format(user.last_sign_in_at, false) : "Never",
          },
        ]}
      />

      <AdminSection title="Account & access">
        <div className="sg-admin-two-column">
          <div>
            <p className="sg-admin-subsection-title">Account</p>
            <AdminDefinitionGrid
              columns={1}
              items={[
                { label: "User ID", value: user.id, mono: true },
                { label: "Email", value: user.email ?? "Not available" },
                { label: "Created", value: format(user.created_at, true) },
                {
                  label: "Email confirmed",
                  value: user.email_confirmed_at
                    ? format(user.email_confirmed_at, true)
                    : "Not confirmed",
                },
                {
                  label: "Account status",
                  value: suspended
                    ? `Suspended until ${format(user.banned_until, true)}`
                    : "Active",
                },
              ]}
            />
          </div>

          <div>
            <p className="sg-admin-subsection-title">Access & security</p>
            <AdminDefinitionGrid
              columns={1}
              items={[
                { label: "Platform role", value: roleLabel },
                { label: "Organizations", value: allMemberships.length },
                { label: "Last sign in", value: format(user.last_sign_in_at, true) },
              ]}
            />
            <div className="sg-admin-security-actions">
              <UserActions
                userId={user.id}
                email={user.email ?? null}
                suspended={suspended}
                platformRole={platformRole}
                self={actor.id === user.id}
              />
            </div>
          </div>
        </div>
      </AdminSection>

      <AdminSection
        title="Memberships"
        description={`${allMemberships.length} organization${allMemberships.length === 1 ? "" : "s"} linked to this account.`}
      >
        {allMemberships.length ? (
          <div className="sg-admin-member-list">
            {allMemberships.map((membership) => (
              <Link
                key={membership.organization_id}
                href={`/admin/organizations/${membership.organization_id}`}
                className="sg-admin-member-row"
              >
                <div className="min-w-0">
                  <strong>{membership.name}</strong>
                  <p className="font-mono">{membership.organization_id}</p>
                </div>
                <span className="sg-admin-member-role">{membership.role}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="sg-admin-attention-empty">No organization memberships.</p>
        )}
      </AdminSection>

      <AdminSection title="Recent activity" description="Latest audit entries targeting this user.">
        {audit?.length ? (
          <div className="sg-admin-activity-list">
            {audit.map((entry) => (
              <div key={entry.id} className="sg-admin-activity-row">
                <div className="min-w-0">
                  <strong>{entry.action}</strong>
                  <p>
                    {format(entry.created_at, true)}
                    {entry.target_name ? ` · ${entry.target_name}` : ""}
                  </p>
                </div>
                <StatusBadge status={entry.status ?? "unknown"}>
                  {entry.status ?? "Unknown"}
                </StatusBadge>
              </div>
            ))}
          </div>
        ) : (
          <p className="sg-admin-attention-empty">No user-specific audit activity.</p>
        )}
      </AdminSection>
    </>
  );
}

function format(value: string | null | undefined, withTime = true) {
  if (!value) return "Not available";

  return new Intl.DateTimeFormat(
    "en-GB",
    withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" },
  ).format(new Date(value));
}
