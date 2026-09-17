import "server-only";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { BillingError } from "./lock";
export function singleSubscriptionItem(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  if (sub.items.data.length !== 1 || !item || item.quantity !== 1) throw new BillingError("This subscription needs manual billing assistance.");
  return item;
}
export async function scheduleSubscriptionDowngrade(sub: Stripe.Subscription, nextPrice: string) {
  const stripe = getStripe();
  const item = singleSubscriptionItem(sub);
  const scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id;
  const schedule = scheduleId ? await stripe.subscriptionSchedules.retrieve(scheduleId) : await stripe.subscriptionSchedules.create({ from_subscription: sub.id }, { idempotencyKey: `downgrade-schedule-${sub.id}-${item.current_period_start}` });
  const phase = schedule.phases.find((p) => p.start_date === schedule.current_phase?.start_date);
  if (!phase) throw new BillingError("Current subscription schedule phase is unavailable.");
  const discounts = phase.discounts.map((d) => ({ discount: typeof d.discount === "string" ? d.discount : d.discount?.id, coupon: typeof d.coupon === "string" ? d.coupon : d.coupon?.id, promotion_code: typeof d.promotion_code === "string" ? d.promotion_code : d.promotion_code?.id }));
  const shared = { discounts, default_tax_rates: phase.default_tax_rates?.map((t) => typeof t === "string" ? t : t.id), automatic_tax: phase.automatic_tax ? { enabled: phase.automatic_tax.enabled } : undefined };
  await stripe.subscriptionSchedules.update(schedule.id, { end_behavior: "release", proration_behavior: "none", phases: [
    { ...shared, start_date: phase.start_date, end_date: item.current_period_end, items: [{ price: item.price.id, quantity: 1 }], proration_behavior: "none" },
    { ...shared, start_date: item.current_period_end, duration: { interval: "month", interval_count: 1 }, items: [{ price: nextPrice, quantity: 1 }], proration_behavior: "none" },
  ] });
  return { scheduleId: schedule.id, effectiveAt: new Date(item.current_period_end * 1000).toISOString() };
}
export async function upgradeSubscription(sub: Stripe.Subscription, price: string) {
  const item = singleSubscriptionItem(sub);
  return getStripe().subscriptions.update(sub.id, { items: [{ id: item.id, price, quantity: 1 }], proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" });
}
