import "server-only";
import type Stripe from "stripe";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBillingSubscription } from "./entitlements";
import { withBillingLock } from "./lock";
import { getStripe, planForPrice } from "./stripe";
const handled = new Set(["checkout.session.expired", "checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed", "subscription_schedule.updated", "subscription_schedule.canceled", "subscription_schedule.released"]);
function idOf(value: string | { id: string } | null | undefined) { return typeof value === "string" ? value : value?.id ?? null; }
function iso(value: number | null | undefined) { return value ? new Date(value * 1000).toISOString() : null; }
export async function processStripeEvent(event: Stripe.Event) {
  if (!handled.has(event.type)) return;
  const stripe = getStripe();
  const object = event.data.object;
  let customerId: string | null = null;
  let eventSubscriptionId: string | null = null;
  if (object.object === "subscription") { customerId = idOf(object.customer); eventSubscriptionId = object.id; }
  else if (object.object === "checkout.session") { customerId = idOf(object.customer); eventSubscriptionId = idOf(object.subscription); }
  else if (object.object === "invoice") { customerId = idOf(object.customer); eventSubscriptionId = idOf(object.parent?.subscription_details?.subscription); }
  else if (object.object === "subscription_schedule") { customerId = idOf(object.customer); eventSubscriptionId = idOf(object.subscription) ?? idOf(object.released_subscription); }
  if (!customerId || (!eventSubscriptionId && event.type !== "checkout.session.expired")) return;
  const admin = createAdminClient();
  const { data: mapping, error } = await admin.from("organization_subscriptions").select("organization_id").eq("provider_customer_id", customerId).maybeSingle();
  if (error) throw new Error("Stripe tenant lookup failed", { cause: error });
  if (!mapping) {
    // Other Stripe applications may share the account; SentinelGrid metadata must reconcile.
    if (!eventSubscriptionId) return;
    const sub = await stripe.subscriptions.retrieve(eventSubscriptionId);
    if (sub.metadata.organization_id) throw new Error("SentinelGrid Stripe customer has no organization mapping");
    return;
  }
  const organizationId = String(mapping.organization_id);
  if (event.type === "checkout.session.expired" && object.object === "checkout.session") {
    await withBillingLock(organizationId, async (token) => {
      const session = await stripe.checkout.sessions.retrieve(object.id);
      if (session.status !== "expired" || idOf(session.customer) !== customerId) throw new Error("Invalid Checkout expiration state");
      const { error: expiryError } = await admin.rpc("expire_stripe_checkout", { p_organization_id: organizationId, p_token: token, p_event_id: event.id, p_session_id: session.id, p_attempt_id: session.metadata?.checkout_attempt_id ?? null });
      if (expiryError) throw new Error("Checkout expiration synchronization failed", { cause: expiryError });
    });
    revalidatePath("/dashboard/billing");
    return;
  }
  if (!eventSubscriptionId) return;
  await withBillingLock(organizationId, async (token) => {
    const { data: processed, error: receiptError } = await admin.from("stripe_webhook_events").select("event_id").eq("event_id", event.id).maybeSingle();
    if (receiptError) throw new Error("Stripe receipt lookup failed", { cause: receiptError });
    if (processed) return;
    const previous = await loadBillingSubscription(organizationId);
    if (previous.plan === "enterprise") {
      console.info("Stripe event retained outside automatic Enterprise licensing", { eventId: event.id, organizationId });
      return;
    }
    const list = await stripe.subscriptions.list({ customer: customerId!, status: "all", limit: 100 });
    if (list.has_more) throw new Error("Stripe subscription history needs reconciliation");
    const live = list.data.filter((s) => !["canceled", "incomplete_expired"].includes(s.status));
    if (live.length > 1) throw new Error("Duplicate live Stripe subscriptions require reconciliation");
    const canonicalId = live[0]?.id ?? previous.provider_subscription_id ?? eventSubscriptionId;
    // Fetch under the organization lock, never apply the potentially stale event payload.
    const sub = await stripe.subscriptions.retrieve(canonicalId);
    if (idOf(sub.customer) !== customerId || (sub.metadata.organization_id && sub.metadata.organization_id !== organizationId)) throw new Error("Stripe subscription organization mismatch");
    const item = sub.items.data[0];
    if (sub.items.data.length !== 1 || !item || item.quantity !== 1) throw new Error("Unsupported Stripe subscription item configuration");
    const terminal = ["canceled", "incomplete_expired"].includes(sub.status);
    const paidPlan = terminal ? null : planForPrice(item.price.id);
    const entitled = ["active", "trialing", "past_due"].includes(sub.status);
    let pendingPlan: string | null = null;
    let pendingAt: string | null = null;
    const scheduleId = terminal ? null : idOf(sub.schedule);
    if (scheduleId) {
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      const next = schedule.phases.find((phase) => phase.start_date > (schedule.current_phase?.start_date ?? item.current_period_start));
      if (next && next.items.length === 1) {
        pendingPlan = planForPrice(idOf(next.items[0].price)!);
        pendingAt = iso(next.start_date);
      }
    }
    const latestInvoiceId = idOf(sub.latest_invoice);
    const latestInvoice = latestInvoiceId ? await stripe.invoices.retrieve(latestInvoiceId) : null;
    const paymentIssue = ["past_due", "unpaid"].includes(sub.status) || Boolean(latestInvoice?.status === "open" && latestInvoice.attempted && latestInvoice.amount_remaining > 0);
    const state = {
      payment_issue: paymentIssue,
      plan: entitled && paidPlan ? paidPlan : "free", status: sub.status, provider_customer_id: customerId,
      provider_subscription_id: terminal ? null : sub.id, provider_price_id: terminal ? null : item.price.id,
      current_period_start: iso(item.current_period_start), current_period_end: iso(item.current_period_end),
      cancel_at_period_end: !terminal && sub.cancel_at_period_end,
      provider_schedule_id: scheduleId, pending_plan: pendingPlan, pending_plan_at: pendingAt,
    };
    const actions: string[] = [];
    if (pendingPlan && pendingPlan !== previous.pending_plan) actions.push("billing.plan_downgrade_scheduled");
    if (!previous.provider_subscription_id && !terminal) actions.push("billing.subscription_created");
    if (previous.plan === "free" && state.plan !== "free") actions.push("billing.subscription_activated");
    else if (previous.plan !== state.plan) actions.push("billing.plan_changed");
    if (terminal && previous.provider_subscription_id) actions.push("billing.subscription_cancelled");
    if (state.cancel_at_period_end && !previous.cancel_at_period_end) actions.push("billing.subscription_cancel_scheduled");
    if (!state.cancel_at_period_end && previous.cancel_at_period_end && !terminal) actions.push("billing.subscription_resumed");
    const wasPaymentIssue = previous.payment_issue || previous.status === "past_due" || previous.status === "unpaid";
    let notification: { type: string; title: string; message: string } | null = null;
    if (paymentIssue && !wasPaymentIssue) {
      actions.push("billing.payment_failed");
      notification = { type: "billing.payment_failed", title: "Payment issue", message: "We couldn't process your latest subscription payment. Open Manage billing to update your payment method." };
    } else if (wasPaymentIssue && !paymentIssue && sub.status === "active") {
      actions.push("billing.payment_recovered");
      notification = { type: "billing.payment_recovered", title: "Payment recovered", message: "Your subscription payment has recovered." };
    }
    const { error: syncError } = await admin.rpc("apply_stripe_event", { p_organization_id: organizationId, p_token: token, p_event_id: event.id, p_event_type: event.type, p_state: state, p_actions: actions, p_notification: notification });
    if (syncError) throw new Error("Stripe database synchronization failed", { cause: syncError });
  });
  revalidatePath("/dashboard", "layout");
}
