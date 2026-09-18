import "server-only";

import {
  randomUUID,
} from "node:crypto";

import {
  revalidatePath,
} from "next/cache";

import {
  assertOrganizationPermission,
} from "@/lib/organization-access";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

import {
  loadBillingSubscription,
} from "./entitlements";

import {
  BillingError,
  saveBillingReferences,
  withBillingLock,
} from "./lock";

import {
  getStripe,
  isPaidPlan,
  planForPrice,
  siteURL,
  validatePrice,
} from "./stripe";

import {
  singleSubscriptionItem,
  scheduleSubscriptionDowngrade,
  upgradeSubscription,
} from "./subscriptions";

/* =========================================================
   CHECKOUT VERSION
========================================================= */

/*
 * Change this whenever the Custom Checkout implementation
 * changes in a way that requires a fresh Stripe Session.
 */
const CHECKOUT_VERSION =
  "custom-dark-v3";

/* =========================================================
   TYPES
========================================================= */

export type BillingAction =
  | "checkout"
  | "change"
  | "cancel"
  | "resume"
  | "portal";

export const BILLING_ACTIONS:
  readonly string[] = [
    "checkout",
    "change",
    "cancel",
    "resume",
    "portal",
  ];

/* =========================================================
   HELPERS
========================================================= */

function idOf(
  value:
    | string
    | { id: string }
) {
  return typeof value ===
    "string"
    ? value
    : value.id;
}

function isStripeResourceMissing(
  error: unknown
) {
  if (
    !error ||
    typeof error !==
      "object"
  ) {
    return false;
  }

  const candidate =
    error as {
      code?: unknown;
      statusCode?: unknown;
    };

  return (
    candidate.code ===
      "resource_missing" ||
    candidate.statusCode ===
      404
  );
}

/* =========================================================
   MANAGE BILLING
========================================================= */

export async function manageBilling(
  organizationId: string,
  action: BillingAction,
  plan?: unknown
) {
  const access =
    await assertOrganizationPermission(
      organizationId,
      "billing.manage"
    );

  /* =========================================================
     VALIDATE REQUEST
  ========================================================== */

  if (
    (
      action ===
        "checkout" ||
      action ===
        "change"
    ) &&
    !isPaidPlan(
      plan
    )
  ) {
    throw new BillingError(
      "Invalid plan",
      400
    );
  }

  /* =========================================================
     BILLING LOCK
  ========================================================== */

  const result =
    await withBillingLock(
      organizationId,

      async (
        token
      ) => {
        const state =
          await loadBillingSubscription(
            organizationId
          );

        const stripe =
          getStripe();

        const admin =
          createAdminClient();

        const returnURL =
          `${siteURL()}/dashboard/billing?organizationId=${organizationId}`;

        /* =====================================================
           AUDIT
        ====================================================== */

        const audit =
          async (
            event: string
          ) => {
            const {
              error,
            } =
              await admin
                .from(
                  "audit_logs"
                )
                .insert({
                  organization_id:
                    organizationId,

                  user_id:
                    access.userId,

                  action:
                    event,

                  target_type:
                    "organization",

                  target_id:
                    organizationId,

                  status:
                    "success",
                });

            if (
              error
            ) {
              throw new Error(
                "Could not record billing audit",
                {
                  cause:
                    error,
                }
              );
            }
          };

        /* =====================================================
           RESET STALE STRIPE REFERENCES
        ====================================================== */

        const resetMissingCustomer =
          async () => {
            const now =
              new Date()
                .toISOString();

            const {
              data,
              error,
            } =
              await admin
                .from(
                  "organization_subscriptions"
                )
                .update({
                  plan:
                    "free",

                  status:
                    "active",

                  provider:
                    "manual",

                  payment_issue:
                    false,

                  provider_customer_id:
                    null,

                  provider_subscription_id:
                    null,

                  provider_price_id:
                    null,

                  provider_schedule_id:
                    null,

                  current_period_start:
                    null,

                  current_period_end:
                    null,

                  cancel_at_period_end:
                    false,

                  pending_plan:
                    null,

                  pending_plan_at:
                    null,

                  checkout_session_id:
                    null,

                  checkout_attempt_id:
                    null,

                  checkout_attempt_at:
                    null,

                  updated_at:
                    now,
                })
                .eq(
                  "organization_id",
                  organizationId
                )
                .eq(
                  "billing_lock_token",
                  token
                )
                .gt(
                  "billing_lock_until",
                  now
                )
                .select(
                  "organization_id"
                )
                .single();

            if (
              error ||
              !data
            ) {
              throw new Error(
                "Could not reconcile deleted Stripe customer",
                {
                  cause:
                    error,
                }
              );
            }

            /*
             * Keep our in-memory state aligned
             * with the database update.
             */
            state.plan =
              "free";

            state.status =
              "active";

            state.provider =
              "manual";

            state.payment_issue =
              false;

            state.provider_customer_id =
              null;

            state.provider_subscription_id =
              null;

            state.provider_price_id =
              null;

            state.provider_schedule_id =
              null;

            state.current_period_start =
              null;

            state.current_period_end =
              null;

            state.cancel_at_period_end =
              false;

            state.pending_plan =
              null;

            state.pending_plan_at =
              null;

            state.checkout_session_id =
              null;

            state.checkout_attempt_id =
              null;

            state.checkout_attempt_at =
              null;

            await audit(
              "billing.customer_reconciled"
            );
          };

        /* =====================================================
           CUSTOMER PORTAL
           Legacy/fallback path.
        ====================================================== */

        if (
          action ===
          "portal"
        ) {
          if (
            !state.provider_customer_id
          ) {
            throw new BillingError(
              "No billing customer exists yet."
            );
          }

          /*
           * Never silently recreate a Customer
           * while trying to open the portal.
           */
          try {
            const customer =
              await stripe.customers.retrieve(
                state.provider_customer_id
              );

            if (
              customer.deleted
            ) {
              throw new BillingError(
                "The Stripe billing customer no longer exists."
              );
            }
          } catch (
            error
          ) {
            if (
              error instanceof
              BillingError
            ) {
              throw error;
            }

            if (
              isStripeResourceMissing(
                error
              )
            ) {
              throw new BillingError(
                "The Stripe billing customer no longer exists."
              );
            }

            throw error;
          }

          const configs =
            await stripe.billingPortal.configurations.list(
              {
                active:
                  true,

                limit:
                  100,
              }
            );

          let config =
            configs.data.find(
              (
                item
              ) =>
                item
                  .metadata
                  ?.sentinelgrid ===
                "payment-only-v2"
            );

          if (
            !config
          ) {
            config =
              await stripe.billingPortal.configurations.create(
                {
                  metadata: {
                    sentinelgrid:
                      "payment-only-v2",
                  },

                  features: {
                    customer_update: {
                      enabled:
                        true,

                      allowed_updates: [
                        "address",
                        "name",
                        "tax_id",
                      ],
                    },

                    invoice_history: {
                      enabled:
                        true,
                    },

                    payment_method_update: {
                      enabled:
                        true,
                    },

                    /*
                     * Subscription lifecycle is
                     * managed inside SentinelGrid.
                     */
                    subscription_cancel: {
                      enabled:
                        false,
                    },

                    subscription_update: {
                      enabled:
                        false,
                    },
                  },
                },
                {
                  idempotencyKey:
                    "sentinelgrid-payment-portal-v2",
                }
              );
          }

          const session =
            await stripe.billingPortal.sessions.create(
              {
                customer:
                  state.provider_customer_id,

                configuration:
                  config.id,

                return_url:
                  returnURL,
              }
            );

          return {
            url:
              session.url,
          };
        }

        /* =====================================================
           ENTERPRISE
        ====================================================== */

        if (
          state.plan ===
          "enterprise"
        ) {
          throw new BillingError(
            "Contact Sales to change an Enterprise license."
          );
        }

        /* =====================================================
           VALIDATE STORED STRIPE CUSTOMER
        ====================================================== */

        let customerId =
          state.provider_customer_id;

        if (
          customerId
        ) {
          let missing =
            false;

          try {
            const customer =
              await stripe.customers.retrieve(
                customerId
              );

            if (
              customer.deleted
            ) {
              missing =
                true;
            }
          } catch (
            error
          ) {
            /*
             * Only an explicit missing resource
             * is safe to reconcile.
             *
             * Network failures, Stripe 5xx,
             * rate limits, etc. MUST NOT mutate
             * billing state.
             */
            if (
              isStripeResourceMissing(
                error
              )
            ) {
              missing =
                true;
            } else {
              throw error;
            }
          }

          if (
            missing
          ) {
            await resetMissingCustomer();

            customerId =
              null;

            /*
             * A missing Stripe Customer can only
             * recover automatically through a new
             * checkout.
             */
            if (
              action !==
              "checkout"
            ) {
              throw new BillingError(
                "The previous Stripe billing customer no longer exists. Start a new subscription."
              );
            }
          }
        }

        /* =====================================================
           CHECKOUT ATTEMPT
        ====================================================== */

        let checkoutAttemptId:
          string | null =
            null;

        const ensureCheckoutAttempt =
          async (
            forceNew =
              false
          ) => {
            if (
              checkoutAttemptId &&
              !forceNew
            ) {
              return checkoutAttemptId;
            }

            const recentAttempt =
              Boolean(
                state.checkout_attempt_at
              ) &&
              Date.now() -
                Date.parse(
                  state.checkout_attempt_at!
                ) <
                23 *
                  60 *
                  60 *
                  1000;

            const canReuse =
              !forceNew &&
              !state.checkout_session_id &&
              recentAttempt &&
              Boolean(
                state.checkout_attempt_id
              );

            const attempt =
              canReuse
                ? state.checkout_attempt_id!
                : randomUUID();

            const now =
              new Date()
                .toISOString();

            await saveBillingReferences(
              organizationId,
              token,
              {
                checkout_attempt_id:
                  attempt,

                checkout_attempt_at:
                  now,

                ...(forceNew
                  ? {
                      checkout_session_id:
                        null,
                    }
                  : {}),
              }
            );

            state.checkout_attempt_id =
              attempt;

            state.checkout_attempt_at =
              now;

            if (
              forceNew
            ) {
              state.checkout_session_id =
                null;
            }

            checkoutAttemptId =
              attempt;

            return attempt;
          };

        /* =====================================================
           CREATE STRIPE CUSTOMER
        ====================================================== */

        if (
          !customerId
        ) {
          if (
            action !==
            "checkout"
          ) {
            throw new BillingError(
              "No Stripe subscription exists."
            );
          }

          /*
           * Customer creation and Checkout Session
           * share the same persistent attempt ID.
           *
           * A retry after a network timeout therefore
           * receives the same Customer instead of
           * accidentally creating duplicates.
           */
          const attempt =
            await ensureCheckoutAttempt();

          const customer =
            await stripe.customers.create(
              {
                metadata: {
                  organization_id:
                    organizationId,
                },
              },
              {
                idempotencyKey:
                  `sentinelgrid-customer-${organizationId}-${attempt}`,
              }
            );

          customerId =
            customer.id;

          state.provider_customer_id =
            customerId;

          await saveBillingReferences(
            organizationId,
            token,
            {
              provider_customer_id:
                customerId,
            }
          );
        }

        /* =====================================================
           EXISTING SUBSCRIPTIONS
        ====================================================== */

        const all =
          await stripe.subscriptions.list(
            {
              customer:
                customerId,

              status:
                "all",

              limit:
                100,
            }
          );

        if (
          all.has_more
        ) {
          throw new BillingError(
            "Subscription history requires manual reconciliation."
          );
        }

        const live =
          all.data.filter(
            (
              subscription
            ) =>
              subscription.status !==
                "canceled" &&
              subscription.status !==
                "incomplete_expired"
          );

        if (
          live.length >
          1
        ) {
          throw new BillingError(
            "Multiple Stripe subscriptions require reconciliation. No new charge was created."
          );
        }

        const existing =
          live[0];

        if (
          existing &&
          existing.metadata
            .organization_id &&
          existing.metadata
            .organization_id !==
            organizationId
        ) {
          throw new BillingError(
            "Stripe organization mismatch."
          );
        }

        /* =====================================================
           NEW SUBSCRIPTION
           CUSTOM CHECKOUT
        ====================================================== */

        if (
          action ===
          "checkout"
        ) {
          if (
            existing ||
            state.provider_subscription_id
          ) {
            throw new BillingError(
              "A subscription already exists."
            );
          }

          if (
            !isPaidPlan(
              plan
            )
          ) {
            throw new BillingError(
              "Invalid plan",
              400
            );
          }

          const resolvedPrice =
            await validatePrice(
              plan
            );

          /* ===================================================
             CHECKOUT HISTORY
          ==================================================== */

          const sessions =
            await stripe.checkout.sessions.list(
              {
                customer:
                  customerId,

                limit:
                  100,
              }
            );

          if (
            sessions.has_more
          ) {
            throw new BillingError(
              "Checkout history requires manual reconciliation."
            );
          }

          /* ===================================================
             COMPLETED SESSION RECONCILIATION
          ==================================================== */

          const orphanedComplete =
            sessions.data.some(
              (
                session
              ) =>
                session.status ===
                  "complete" &&
                session.subscription &&
                !all.data.some(
                  (
                    subscription
                  ) =>
                    subscription.id ===
                    idOf(
                      session.subscription!
                    )
                )
            );

          if (
            orphanedComplete
          ) {
            throw new BillingError(
              "Confirming your previous Checkout. Please retry shortly."
            );
          }

          /* ===================================================
             OPEN SESSION
          ==================================================== */

          const open =
            sessions.data.find(
              (
                session
              ) =>
                session.status ===
                  "open" &&
                session.mode ===
                  "subscription"
            );

          if (
            open
          ) {
            const reusable =
              open.metadata
                ?.requested_plan ===
                plan &&
              open.metadata
                ?.checkout_version ===
                CHECKOUT_VERSION &&
              open.ui_mode ===
                "custom" &&
              Boolean(
                open.client_secret
              );

            if (
              reusable &&
              open.client_secret
            ) {
              /*
               * Keep the DB reference aligned even
               * if a previous response was lost.
               */
              await saveBillingReferences(
                organizationId,
                token,
                {
                  checkout_session_id:
                    open.id,
                }
              );

              return {
                clientSecret:
                  open.client_secret,

                checkoutSessionId:
                  open.id,
              };
            }

            /*
             * Old or incompatible checkout.
             */
            await stripe.checkout.sessions.expire(
              open.id
            );

            await ensureCheckoutAttempt(
              true
            );
          }

          /* ===================================================
             CHECKOUT ATTEMPT
          ==================================================== */

          const attempt =
            checkoutAttemptId ??
            await ensureCheckoutAttempt();

          const metadata = {
            organization_id:
              organizationId,

            requested_plan:
              plan,

            checkout_attempt_id:
              attempt,

            checkout_version:
              CHECKOUT_VERSION,
          };

          /* ===================================================
             CREATE CHECKOUT SESSION
          ==================================================== */

          const session =
            await stripe.checkout.sessions.create(
              {
                customer:
                  customerId,

                mode:
                  "subscription",

                ui_mode:
                  "custom",

                locale:
                  "en-GB",

                line_items: [
                  {
                    price:
                      resolvedPrice,

                    quantity:
                      1,
                  },
                ],

                client_reference_id:
                  organizationId,

                metadata,

                subscription_data: {
                  metadata,
                },

                /*
                 * Redirect-based payment methods
                 * use this URL.
                 *
                 * The client must call
                 * checkout.confirm() without
                 * supplying another returnUrl.
                 */
                return_url:
                  `${returnURL}&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
              },
              {
                idempotencyKey:
                  `checkout-${organizationId}-${attempt}-${plan}`,
              }
            );

          await saveBillingReferences(
            organizationId,
            token,
            {
              checkout_session_id:
                session.id,
            }
          );

          state.checkout_session_id =
            session.id;

          await audit(
            "billing.checkout_started"
          );

          if (
            !session.client_secret
          ) {
            throw new Error(
              "Stripe did not return a Checkout client secret"
            );
          }

          return {
            clientSecret:
              session.client_secret,

            checkoutSessionId:
              session.id,
          };
        }

        /* =====================================================
           EXISTING SUBSCRIPTION REQUIRED
        ====================================================== */

        if (
          !existing ||
          (
            state.provider_subscription_id &&
            existing.id !==
              state.provider_subscription_id
          )
        ) {
          throw new BillingError(
            "No current subscription was found."
          );
        }

        const sub =
          await stripe.subscriptions.retrieve(
            existing.id
          );

        const item =
          singleSubscriptionItem(
            sub
          );

        const scheduleId =
          sub.schedule
            ? idOf(
                sub.schedule
              )
            : null;

        /* =====================================================
           RELEASE SCHEDULE
        ====================================================== */

        const releaseSchedule =
          async () => {
            if (
              scheduleId
            ) {
              await stripe.subscriptionSchedules.release(
                scheduleId
              );
            }

            await saveBillingReferences(
              organizationId,
              token,
              {
                provider_schedule_id:
                  null,

                pending_plan:
                  null,

                pending_plan_at:
                  null,
              }
            );
          };

        /* =====================================================
           CANCEL / RESUME
        ====================================================== */

        if (
          action ===
            "cancel" ||
          action ===
            "resume"
        ) {
          if (
            action ===
              "resume" &&
            !sub.cancel_at_period_end
          ) {
            throw new BillingError(
              "Cancellation is not scheduled."
            );
          }

          if (
            action ===
              "cancel" &&
            sub.cancel_at_period_end
          ) {
            throw new BillingError(
              "Cancellation is already scheduled."
            );
          }

          /*
           * Moving to Free takes precedence over
           * a scheduled paid-plan downgrade.
           */
          if (
            action ===
            "cancel"
        ) {
            await releaseSchedule();
          }

          await stripe.subscriptions.update(
            sub.id,
            {
              cancel_at_period_end:
                action ===
                "cancel",
            }
          );

          return {
            message:
              action ===
              "cancel"
                ? "Cancellation scheduled. Confirming with Stripe."
                : "Subscription resumed. Confirming with Stripe.",
          };
        }

        /* =====================================================
           PLAN CHANGE
        ====================================================== */

        if (
          !isPaidPlan(
            plan
          )
        ) {
          throw new BillingError(
            "Invalid plan",
            400
          );
        }

        if (
          ![
            "active",
            "trialing",
          ].includes(
            sub.status
          ) ||
          sub.pending_update
        ) {
          throw new BillingError(
            "Resolve the pending payment before changing plans."
          );
        }

        /*
         * A subscription scheduled for cancellation
         * must be resumed before another paid plan
         * can be selected.
         */
        if (
          sub.cancel_at_period_end
        ) {
          throw new BillingError(
            "Resume your subscription before changing plans."
          );
        }

        const currentPlan =
          planForPrice(
            item.price.id
          );

        const resolvedPrice =
          await validatePrice(
            plan
          );

        /* =====================================================
           REMOVE SCHEDULED DOWNGRADE
        ====================================================== */

        if (
          currentPlan ===
          plan
        ) {
          if (
            scheduleId
          ) {
            await releaseSchedule();
          } else {
            throw new BillingError(
              "This is already your plan."
            );
          }

          return {
            message:
              "Scheduled plan change removed. Confirming with Stripe.",
          };
        }

        /* =====================================================
           BUSINESS -> PRO
           DOWNGRADE AT PERIOD END
        ====================================================== */

        if (
          currentPlan ===
            "business" &&
          plan ===
            "pro"
        ) {
          const scheduled =
            await scheduleSubscriptionDowngrade(
              sub,
              resolvedPrice
            );

          await saveBillingReferences(
            organizationId,
            token,
            {
              provider_schedule_id:
                scheduled.scheduleId,

              pending_plan:
                plan,

              pending_plan_at:
                scheduled.effectiveAt,
            }
          );

          await audit(
            "billing.plan_downgrade_scheduled"
          );

          return {
            message:
              "Downgrade scheduled. Confirming with Stripe.",
          };
        }

        /* =====================================================
           PRO -> BUSINESS
           IMMEDIATE UPGRADE + PRORATION
        ====================================================== */

        await releaseSchedule();

        await upgradeSubscription(
          sub,
          resolvedPrice
        );

        /*
         * Webhook remains the source of truth.
         *
         * If Stripe requires additional payment
         * authentication, that state is preserved
         * by pending_if_incomplete and can be
         * handled by the payment confirmation UI.
         */

        return {
          message:
            "Stripe accepted the plan upgrade. Confirming your subscription.",
        };
      }
    );

  /* =========================================================
     REVALIDATE
  ========================================================== */

  revalidatePath(
    "/dashboard",
    "layout"
  );

  return result;
}