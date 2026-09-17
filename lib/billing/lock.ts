import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingSubscription } from "./entitlements";
export class BillingError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); }
}
export async function withBillingLock<T>(organizationId: string, run: (token: string) => Promise<T>) {
  const admin = createAdminClient();
  const token = randomUUID();
  const { data, error } = await admin.rpc("acquire_billing_lock", { p_organization_id: organizationId, p_token: token });
  if (error) throw new Error("Could not lock billing", { cause: error });
  if (!data) throw new BillingError("Billing is being updated. Please retry shortly.");
  try { return await run(token); }
  finally {
    const { error: releaseError } = await admin.rpc("release_billing_lock", { p_organization_id: organizationId, p_token: token });
    if (releaseError) console.error("Billing lock release failed", releaseError);
  }
}
export async function saveBillingReferences(organizationId: string, token: string, changes: Partial<Pick<BillingSubscription, "provider_customer_id" | "provider_schedule_id" | "pending_plan" | "pending_plan_at" | "checkout_session_id" | "checkout_attempt_id" | "checkout_attempt_at">>) {
  const { data, error } = await createAdminClient().from("organization_subscriptions").update({ ...changes, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId).eq("billing_lock_token", token).gt("billing_lock_until", new Date().toISOString()).select("organization_id").single();
  if (error || !data) throw new Error("Billing state update failed", { cause: error });
}
