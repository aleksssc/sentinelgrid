import { createAdminClient } from "@/lib/supabase/admin";
import {
  AdminAuditInventory,
  type AdminAuditRow,
} from "@/components/admin/admin-inventories";
import { AdminPageHeader, AdminSection } from "@/components/admin/admin-primitives";

type Audit = {
  id: string;
  organization_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_name: string | null;
  status: string | null;
  created_at: string;
};

type Organization = { id: string; name: string };

export default async function AdminAuditPage() {
  const admin = createAdminClient();

  const [{ data: entries, error }, { data: organizations }] = await Promise.all([
    admin
      .from("audit_logs")
      .select(
        "id, organization_id, actor_email, action, target_type, target_name, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<Audit[]>(),
    admin.from("organizations").select("id, name").returns<Organization[]>(),
  ]);

  const names = new Map(
    (organizations ?? []).map((organization) => [organization.id, organization.name]),
  );

  const auditEntries: AdminAuditRow[] = (entries ?? []).map((entry) => ({
    id: entry.id,
    organizationId: entry.organization_id,
    organizationName: entry.organization_id
      ? names.get(entry.organization_id) ?? entry.organization_id
      : "Platform",
    actorEmail: entry.actor_email ?? "System",
    action: entry.action,
    targetType: entry.target_type,
    targetName: entry.target_name,
    status: entry.status,
    createdAt: entry.created_at,
  }));

  return (
    <>
      <AdminPageHeader
        eyebrow="Security"
        title="Audit"
        description={`${auditEntries.length} most recent recorded event${auditEntries.length === 1 ? "" : "s"}.`}
      />

      <AdminSection
        className="sg-admin-inventory"
        title="Audit log"
        description="Filter by actor, organization, event type or result."
      >
        {error ? (
          <div role="alert" className="sg-inline-notice">
            Audit entries could not be loaded: {error.message}
          </div>
        ) : (
          <AdminAuditInventory
            entries={auditEntries}
            organizations={organizations ?? []}
          />
        )}
      </AdminSection>
    </>
  );
}
