import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationAccess } from "@/lib/organization-access";
import { getPlanLimit, RESOURCES } from "@/lib/plans";
import type { PlanResource } from "@/lib/plans";

export type BillingSubscription = {
  payment_issue: boolean;
  organization_id: string; plan: string; status: string; provider: string;
  provider_customer_id: string | null; provider_subscription_id: string | null; provider_price_id: string | null;
  current_period_start: string | null; current_period_end: string | null; cancel_at_period_end: boolean;
  provider_schedule_id: string | null; pending_plan: string | null; pending_plan_at: string | null;
  checkout_session_id: string | null; checkout_attempt_id: string | null; checkout_attempt_at: string | null;
};
export async function loadBillingSubscription(organizationId: string): Promise<BillingSubscription> {
  const { data, error } = await createAdminClient().from("organization_subscriptions").select("*").eq("organization_id", organizationId).single<BillingSubscription>();
  if (error || !data) throw new Error("Billing state unavailable", { cause: error });
  return data;
}
export async function getOrganizationEntitlements(organizationId: string) {
  const access = await getOrganizationAccess(organizationId);
  if (!access) throw new Error("Organization access denied");
  const admin = createAdminClient();
  const [{ data: usage, error }, subscription] = await Promise.all([
    admin.rpc("organization_billing_usage", { p_organization_id: organizationId }),
    loadBillingSubscription(organizationId),
  ]);
  if (error || !usage) throw new Error("Organization usage unavailable", { cause: error });
  const limits = {} as Record<PlanResource, number>;
  const counts = {} as Record<PlanResource, number>;
  for (const resource of RESOURCES) {
    if (!Number.isSafeInteger(usage[resource]) || usage[resource] < 0) throw new Error("Invalid organization usage");
    counts[resource] = usage[resource];
    limits[resource] = getPlanLimit(access.subscription.plan, resource, access.subscription.customLimits);
  }
  return { plan: access.subscription.plan, status: access.subscription.status, limits, usage: counts, pendingInvites: Number(usage.pending_invites), subscription, role: access.role };
}
