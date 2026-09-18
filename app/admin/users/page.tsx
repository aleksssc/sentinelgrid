import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformRole } from "@/lib/platform-access";
import {
  AdminUsersInventory,
  type AdminUserRow,
} from "@/components/admin/admin-inventories";
import { AdminPageHeader, AdminSection } from "@/components/admin/admin-primitives";

type Membership = { user_id: string; organization_id: string };
type Organization = { id: string; owner_id: string };

export default async function AdminUsersPage() {
  const admin = createAdminClient();

  const [{ data: memberships }, { data: organizations }, result] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id, organization_id")
      .returns<Membership[]>(),
    admin.from("organizations").select("id, owner_id").returns<Organization[]>(),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const organizationSets = new Map<string, Set<string>>();

  for (const membership of memberships ?? []) {
    const set = organizationSets.get(membership.user_id) ?? new Set<string>();
    set.add(membership.organization_id);
    organizationSets.set(membership.user_id, set);
  }

  for (const organization of organizations ?? []) {
    const set = organizationSets.get(organization.owner_id) ?? new Set<string>();
    set.add(organization.id);
    organizationSets.set(organization.owner_id, set);
  }

  const users: AdminUserRow[] = (result.data.users ?? []).map((user) => ({
    id: user.id,
    email: user.email ?? "Email unavailable",
    memberships: organizationSets.get(user.id)?.size ?? 0,
    platformRole: isPlatformRole(user.app_metadata.platform_role)
      ? user.app_metadata.platform_role
      : null,
    suspended: Boolean(user.banned_until),
    lastSignIn: user.last_sign_in_at ?? null,
  }));

  return (
    <>
      <AdminPageHeader
        eyebrow="Management"
        title="Users"
        description={`${users.length} authentication account${users.length === 1 ? "" : "s"} with organization and platform access.`}
      />

      <AdminSection
        className="sg-admin-inventory"
        title="User inventory"
        description="Select an account to inspect access, memberships and security actions."
      >
        <AdminUsersInventory users={users} />
      </AdminSection>
    </>
  );
}
