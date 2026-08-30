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

export type PlanName =
  keyof typeof PLAN_LIMITS;