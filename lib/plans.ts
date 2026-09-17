export const PLANS = {
  free: { name: "Free", monthlyPriceCents: 0, description: "For personal projects and small environments.", limits: { members: 1, clients: 3, devices: 10, monitors: 10 }, custom: false },
  pro: { name: "Pro", monthlyPriceCents: 4999, description: "For professionals and growing infrastructure.", limits: { members: 5, clients: 25, devices: 100, monitors: 100 }, custom: false },
  business: { name: "Business", monthlyPriceCents: 17999, description: "For IT teams and managed infrastructure.", limits: { members: 20, clients: 500, devices: 500, monitors: 500 }, custom: false },
  enterprise: { name: "Enterprise", monthlyPriceCents: null, description: "Custom licensed infrastructure and team capacity.", limits: { members: 0, clients: 0, devices: 0, monitors: 0 }, custom: true },
} as const;

export type PlanName = keyof typeof PLANS;
export type PlanResource = keyof typeof PLANS.free.limits;
export const PLAN_ORDER = ["free", "pro", "business", "enterprise"] as const;
export const RESOURCES = ["members", "clients", "devices", "monitors"] as const;
export type EnterpriseCustomLimits = Partial<Record<PlanResource, number | null>>;
export const PLAN_LIMITS = { free: PLANS.free.limits, pro: PLANS.pro.limits, business: PLANS.business.limits, enterprise: PLANS.enterprise.limits };
export const PLAN_LABELS = { free: PLANS.free.name, pro: PLANS.pro.name, business: PLANS.business.name, enterprise: PLANS.enterprise.name };
export const SALES_URL = "mailto:sales@sentinelgrid.com";
export function isPlanName(value: unknown): value is PlanName { return typeof value === "string" && Object.hasOwn(PLANS, value); }
export function formatPlanPrice(plan: PlanName) {
  const cents = PLANS[plan].monthlyPriceCents;
  return cents === null ? "Custom" : `\u20ac${cents === 0 ? "0" : (cents / 100).toFixed(2)}`;
}
export function planMarketingFeatures(plan: PlanName) {
  return RESOURCES.map((resource) => PLANS[plan].custom ? `Custom licensed ${resource}` : `${PLANS[plan].limits[resource]} ${resource}`);
}

// Feature entitlements are separate from roles; no feature paywalls in this release.
const FEATURES = { deviceActions: true, terminal: true, rdp: true, remoteTerminal: true, remoteActions: true, auditLogs: true, alerts: true, apiAccess: true } as const;
export const PLAN_FEATURES = { free: FEATURES, pro: FEATURES, business: FEATURES, enterprise: FEATURES };
export type PlanFeature = keyof typeof FEATURES;
export function planHasFeature(plan: PlanName, feature: PlanFeature) { return PLAN_FEATURES[plan][feature]; }
export const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "unpaid", "incomplete", "incomplete_expired", "paused", "canceled", "inactive", "grace_period", "restricted"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type SubscriptionAccessMode = "full" | "grace" | "restricted";
export function normalizeSubscriptionStatus(status: unknown): SubscriptionStatus {
  const match = SUBSCRIPTION_STATUSES.find((value) => value === status);
  if (!match) throw new Error("Invalid subscription status");
  return match;
}
export function getSubscriptionAccessMode(status: SubscriptionStatus): SubscriptionAccessMode {
  return status === "past_due" || status === "grace_period" ? "grace" : "full";
}
export function canUsePaidFeatures(status: SubscriptionStatus) { return getSubscriptionAccessMode(status) !== "restricted"; }
export function canCreateResources(status: SubscriptionStatus) { return getSubscriptionAccessMode(status) !== "restricted"; }
export function getPlanLimit(plan: PlanName, resource: PlanResource, customLimits?: EnterpriseCustomLimits) {
  if (plan !== "enterprise") return PLANS[plan].limits[resource];
  const value = customLimits?.[resource];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Enterprise ${resource} license is not configured`);
  return value;
}
export function canCreateResource({ plan, resource, currentUsage, customLimits }: { plan: PlanName; resource: PlanResource; currentUsage: number; customLimits?: EnterpriseCustomLimits; subscriptionStatus?: SubscriptionStatus }) {
  return currentUsage < getPlanLimit(plan, resource, customLimits);
}
export function formatPlanLimit(limit: number) { return limit.toString(); }
