import { Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, SectionHeader, Surface } from "@/components/dashboard/dashboard-primitives";
import { isPlatformRole } from "@/lib/platform-access";
import { AdminUsersInventory, type AdminUserRow } from "@/components/admin/admin-inventories";

type Membership = { user_id: string };
export default async function AdminUsersPage() {
  const admin = createAdminClient();
  const [{ data: memberships }, result] = await Promise.all([admin.from("organization_members").select("user_id").returns<Membership[]>(), admin.auth.admin.listUsers({ page: 1, perPage: 1000 })]);
  const membershipCounts = new Map<string, number>();
  for (const membership of memberships ?? []) membershipCounts.set(membership.user_id, (membershipCounts.get(membership.user_id) ?? 0) + 1);
  const users: AdminUserRow[] = (result.data.users ?? []).map((user) => ({ id: user.id, email: user.email ?? "Email unavailable", memberships: membershipCounts.get(user.id) ?? 0, platformRole: isPlatformRole(user.app_metadata.platform_role) ? user.app_metadata.platform_role : null, suspended: Boolean(user.banned_until), lastSignIn: user.last_sign_in_at ?? null }));
  return <><PageHeader title="Users" eyebrow="Platform administration" icon={<Users size={22} />} description="Authenticated users, platform access and organization memberships." /><Surface className="mt-5 overflow-hidden"><SectionHeader title="Users" description="Results update as you search or change a filter. No credentials, tokens or authentication secrets are exposed." icon={<Users size={17} />} /><AdminUsersInventory users={users} /></Surface></>;
}
