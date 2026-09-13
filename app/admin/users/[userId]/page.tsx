import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Shield, UserRound } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformActor, isPlatformRole } from "@/lib/platform-access";
import { PageHeader, SectionHeader, Surface } from "@/components/dashboard/dashboard-primitives";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { UserActions } from "@/components/admin/user-actions";

type Membership = { organization_id: string; role: string | null; organizations: { name: string } | null };
type Audit = { id: string; action: string; status: string | null; created_at: string; target_name: string | null };

export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const [actor, admin] = await Promise.all([requirePlatformActor(), Promise.resolve(createAdminClient())]);
  const [{ data, error }, { data: memberships }, { data: audit }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("organization_members").select("organization_id, role, organizations(name)").eq("user_id", userId).returns<Membership[]>(),
    admin.from("audit_logs").select("id, action, status, created_at, target_name").eq("target_id", userId).order("created_at", { ascending: false }).limit(20).returns<Audit[]>(),
  ]);

  const user = data.user;
  if (error || !user) notFound();

  const platformRole = isPlatformRole(user.app_metadata.platform_role) ? user.app_metadata.platform_role : null;
  const suspended = Boolean(user.banned_until);
  const format = (value: string | null | undefined, time = false) => value
    ? new Intl.DateTimeFormat("en-GB", time ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(value))
    : "Not available";

  return <>
    <Link href="/admin/users" className="sg-admin-back-link"><ArrowLeft size={15} />Users</Link>
    <PageHeader
      title={user.email ?? "Email unavailable"}
      eyebrow="Platform administration / user"
      icon={<UserRound size={22} />}
      description={user.id}
      actions={<div className="flex gap-2"><StatusBadge status={suspended ? "Suspended" : "Active"} tone={suspended ? "warning" : "success"}>{suspended ? "Suspended" : "Active"}</StatusBadge>{platformRole && <StatusBadge status={platformRole} tone="info">{platformRole === "developer" ? "Developer" : "Platform Admin"}</StatusBadge>}</div>}
    />
    <div className="sg-admin-detail-grid sg-admin-user-detail-grid">
      <div className="grid gap-4">
        <Surface className="sg-admin-detail-panel">
          <SectionHeader title="Account" description="Authentication account information." icon={<UserRound size={17} />} />
          <dl className="sg-version-list sg-admin-detail-list">
            <div><dt>User ID</dt><dd className="font-mono text-xs">{user.id}</dd></div>
            <div><dt>Email</dt><dd>{user.email ?? "Not available"}</dd></div>
            <div><dt>Created</dt><dd>{format(user.created_at, true)}</dd></div>
            <div><dt>Last sign in</dt><dd>{format(user.last_sign_in_at, true)}</dd></div>
            <div><dt>Email confirmed</dt><dd>{user.email_confirmed_at ? format(user.email_confirmed_at, true) : "Not confirmed"}</dd></div>
            <div><dt>Account status</dt><dd>{suspended ? `Suspended until ${format(user.banned_until, true)}` : "Active"}</dd></div>
          </dl>
        </Surface>
        <Surface className="sg-admin-detail-panel">
          <SectionHeader title="Memberships" description="Organization roles remain separate from platform access." icon={<Shield size={17} />} />
          {memberships?.length ? <div className="divide-y divide-surface-edge">{memberships.map((membership) => <Link key={membership.organization_id} href={`/admin/organizations/${membership.organization_id}`} className="sg-admin-membership-row justify-between"><span>{membership.organizations?.name ?? membership.organization_id}</span><span className="text-xs text-surface-muted">{membership.role ?? "member"}</span></Link>)}</div> : <p className="sg-admin-empty-row">No organization memberships.</p>}
        </Surface>
        <Surface className="sg-admin-detail-panel">
          <SectionHeader title="Audit" description="Recent recorded actions for this user." icon={<Shield size={17} />} />
          {audit?.length ? <div className="divide-y divide-surface-edge">{audit.map((entry) => <div key={entry.id} className="sg-admin-membership-row sg-admin-interactive-row justify-between"><div><p className="text-sm text-zinc-100">{entry.action}</p><p className="mt-1 text-xs text-surface-muted">{format(entry.created_at, true)}</p></div><StatusBadge status={entry.status ?? "unknown"}>{entry.status ?? "Unknown"}</StatusBadge></div>)}</div> : <p className="sg-admin-empty-row">No user-specific audit entries recorded.</p>}
        </Surface>
      </div>
      <aside className="grid content-start gap-4">
        <Surface className="sg-admin-detail-panel sg-admin-access-panel">
          <SectionHeader title="Platform access" description="Global platform role, independent of organization memberships." icon={<Shield size={17} />} />
          <div className="sg-admin-access-value"><span className="sg-badge-dot" aria-hidden="true" /><p>{platformRole === "developer" ? "Developer" : platformRole === "platform_admin" ? "Platform Admin" : "No platform access"}</p></div>
        </Surface>
        <Surface className="sg-admin-detail-panel sg-admin-security-panel">
          <SectionHeader title="Security" description="Actions are confirmed and recorded in the audit log." icon={<Shield size={17} />} />
          <div className="sg-admin-security-actions"><UserActions userId={user.id} email={user.email ?? null} suspended={suspended} platformRole={platformRole} self={actor.id === user.id} /></div>
        </Surface>
      </aside>
    </div>
  </>;
}
