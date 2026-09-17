import "server-only";
import Stripe from "stripe";
import { PLANS } from "@/lib/plans";
export type PaidPlan = "pro" | "business";
export function isPaidPlan(value: unknown): value is PaidPlan { return value === "pro" || value === "business"; }
export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}
let client: Stripe | undefined;
export function getStripe() {
  return client ??= new Stripe(requiredEnv("STRIPE_SECRET_KEY"), { maxNetworkRetries: 2, timeout: 15000 });
}
export function siteURL() {
  const url = new URL(requiredEnv("NEXT_PUBLIC_SITE_URL"));
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))) throw new Error("Invalid NEXT_PUBLIC_SITE_URL");
  return url.origin;
}
export function priceId(plan: PaidPlan) { return requiredEnv(plan === "pro" ? "STRIPE_PRO_PRICE_ID" : "STRIPE_BUSINESS_PRICE_ID"); }
export function planForPrice(id: string): PaidPlan {
  if (id === priceId("pro")) return "pro";
  if (id === priceId("business")) return "business";
  throw new Error("Unrecognized Stripe subscription price");
}
export async function validatePrice(plan: PaidPlan) {
  const price = await getStripe().prices.retrieve(priceId(plan));
  const product = requiredEnv(plan === "pro" ? "STRIPE_PRO_PRODUCT_ID" : "STRIPE_BUSINESS_PRODUCT_ID");
  if (!price.active || price.product !== product || price.currency !== "eur" || price.unit_amount !== PLANS[plan].monthlyPriceCents || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 || price.recurring.usage_type !== "licensed") throw new Error("Stripe price does not match the published plan");
  return price.id;
}
