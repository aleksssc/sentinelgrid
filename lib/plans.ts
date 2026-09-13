export const PLAN_LIMITS = {
  free: {
    members: 1,
    clients: 3,
    devices: 10,
    monitors: 10,
  },

  pro: {
    members: 5,
    clients: 25,
    devices: 100,
    monitors: 100,
  },

  business: {
    members: 20,
    clients: Infinity,
    devices: 500,
    monitors: 500,
  },

  enterprise: {
    members: Infinity,
    clients: Infinity,
    devices: Infinity,
    monitors: Infinity,
  },
} as const;


export const PLAN_PRICES = {
  free: 0,
  pro: 24.99,
  business: 59.99,
  enterprise: null,
} as const;


export const PLAN_LABELS = {
  free: "Free",
  pro: "Pro",
  business: "Business",
  enterprise: "Enterprise",
} as const;


export type PlanName =
  keyof typeof PLAN_LIMITS;


export type PlanResource =
  keyof typeof PLAN_LIMITS.free;


export type EnterpriseCustomLimits = {
  members?: number | null;
  clients?: number | null;
  devices?: number | null;
  monitors?: number | null;
};


// =========================================================
// FEATURES / ENTITLEMENTS
// =========================================================

export const PLAN_FEATURES = {
  free: {
    deviceActions: false,
    terminal: false,
    rdp: false,
  },

  pro: {
    deviceActions: true,
    terminal: true,
    rdp: true,
  },

  business: {
    deviceActions: true,
    terminal: true,
    rdp: true,
  },

  enterprise: {
    deviceActions: true,
    terminal: true,
    rdp: true,
  },
} as const satisfies Record<
  PlanName,
  Record<string, boolean>
>;


export type PlanFeature =
  keyof typeof PLAN_FEATURES.free;


export function planHasFeature(
  plan: PlanName,
  feature: PlanFeature
) {
  return PLAN_FEATURES[plan][feature];
}


// =========================================================
// SUBSCRIPTION LIFECYCLE
// =========================================================

export const SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "grace_period",
  "restricted",
  "canceled",
] as const;


export type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUSES)[number];


export type SubscriptionAccessMode =
  | "full"
  | "grace"
  | "restricted";


export function normalizeSubscriptionStatus(
  status: string | null | undefined
): SubscriptionStatus {
  if (
    status &&
    SUBSCRIPTION_STATUSES.includes(
      status as SubscriptionStatus
    )
  ) {
    return status as SubscriptionStatus;
  }

  return "active";
}


export function getSubscriptionAccessMode(
  status: SubscriptionStatus
): SubscriptionAccessMode {
  if (
    status === "restricted" ||
    status === "canceled"
  ) {
    return "restricted";
  }

  if (
    status === "past_due" ||
    status === "grace_period"
  ) {
    return "grace";
  }

  return "full";
}


export function canUsePaidFeatures(
  status: SubscriptionStatus
) {
  return getSubscriptionAccessMode(status) !==
    "restricted";
}


export function canCreateResources(
  status: SubscriptionStatus
) {
  return getSubscriptionAccessMode(status) !==
    "restricted";
}


// =========================================================
// GET EFFECTIVE LIMIT
// =========================================================

export function getPlanLimit(
  plan: PlanName,
  resource: PlanResource,
  customLimits?: EnterpriseCustomLimits
) {

  if (plan !== "enterprise") {
    return PLAN_LIMITS[plan][resource];
  }


  const customLimit =
    customLimits?.[resource];


  if (
    typeof customLimit === "number"
  ) {
    return customLimit;
  }


  return Infinity;
}


// =========================================================
// CAN CREATE RESOURCE
// =========================================================

export function canCreateResource({
  plan,
  resource,
  currentUsage,
  customLimits,
  subscriptionStatus = "active",
}: {
  plan: PlanName;
  resource: PlanResource;
  currentUsage: number;
  customLimits?: EnterpriseCustomLimits;
  subscriptionStatus?: SubscriptionStatus;
}) {

  if (
    !canCreateResources(
      subscriptionStatus
    )
  ) {
    return false;
  }


  const limit = getPlanLimit(
    plan,
    resource,
    customLimits
  );


  if (limit === Infinity) {
    return true;
  }


  return currentUsage < limit;
}


// =========================================================
// DISPLAY LIMIT
// =========================================================

export function formatPlanLimit(
  limit: number
) {

  if (limit === Infinity) {
    return "Unlimited";
  }

  return limit.toString();
}
