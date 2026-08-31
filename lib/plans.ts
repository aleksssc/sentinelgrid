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
}: {
  plan: PlanName;
  resource: PlanResource;
  currentUsage: number;
  customLimits?: EnterpriseCustomLimits;
}) {

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