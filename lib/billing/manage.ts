import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

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
  "custom-dark-v2";

export type BillingAction =
  | "checkout"
  | "change"
  | "cancel"
  | "cancel_now"
  | "resume"
  | "portal";

export const BILLING_ACTIONS:
  readonly string[] = [
    "checkout",
    "change",
    "cancel",
    "cancel_now",
    "resume",
    "portal",
  ];

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

  if (
    (
      action === "checkout" ||
      action === "change"
    ) &&
    !isPaidPlan(plan)
  ) {
    throw new BillingError(
      "Invalid plan",
      400
    );
  }

  const result =
    await withBillingLock(
      organizationId,
      async (token) => {
        const state =
          await loadBillingSubscription(
            organizationId
          );

        const stripe =
          getStripe();

        const returnURL =
          `${siteURL()}/dashboard/billing?organizationId=${organizationId}`;

        const audit =
          async (
            event: string
          ) => {
            const {
              error,
            } =
              await createAdminClient()
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

            if (error) {
              throw new Error(
                "Could not record billing audit",
                {
                  cause:
                    error,
                }
              );
            }
          };

        /* =================================================
           CUSTOMER PORTAL
        ================================================= */

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
              (item) =>
                item
                  .metadata
                  ?.sentinelgrid ===
                "payment-only-v1"
            );

          if (!config) {
            config =
              await stripe.billingPortal.configurations.create(
                {
                  metadata:
                    {
                      sentinelgrid:
                        "payment-only-v2",
                    },

                  features:
                    {
                      customer_update:
                        {
                          enabled:
                            true,

                          allowed_updates:
                            [
                              "address",
                              "name",
                              "tax_id",
                            ],
                        },

                      invoice_history:
                        {
                          enabled:
                            true,
                        },

                      payment_method_update:
                        {
                          enabled:
                            true,
                        },

                      subscription_cancel:
                        {
                          enabled:
                            true,
                        },

                      subscription_update:
                        {
                          enabled:
                            true,
                        },
                    },
                },
                {
                  idempotencyKey:
                    "sentinelgrid-payment-portal-v1",
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

        /* =================================================
           ENTERPRISE
        ================================================= */

        if (
          state.plan ===
          "enterprise"
        ) {
          throw new BillingError(
            "Contact Sales to change an Enterprise license."
          );
        }

        /* =================================================
           STRIPE CUSTOMER
        ================================================= */

        let customerId =
          state.provider_customer_id;

        if (!customerId) {
          if (
            action !==
            "checkout"
          ) {
            throw new BillingError(
              "No Stripe subscription exists."
            );
          }

          const customer =
            await stripe.customers.create(
              {
                metadata:
                  {
                    organization_id:
                      organizationId,
                  },
              },
              {
                idempotencyKey:
                  `sentinelgrid-customer-${organizationId}`,
              }
            );

          customerId =
            customer.id;

          await saveBillingReferences(
            organizationId,
            token,
            {
              provider_customer_id:
                customerId,
            }
          );
        }

        /* =================================================
           EXISTING SUBSCRIPTIONS
        ================================================= */

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

        /* =================================================
           NEW SUBSCRIPTION
           CUSTOM CHECKOUT + ELEMENTS
        ================================================= */

        if (
          action ===
          "checkout"
        ) {
          if (
            existing ||
            state.provider_subscription_id
          ) {
            throw new BillingError(
              "A subscription already exists. Refresh billing or use Manage billing."
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

          /*
           * Completed Checkout exists but the subscription
           * hasn't appeared in the subscription list yet.
           *
           * Do not create another charge.
           */
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

          /*
           * Reuse only Custom Checkout Sessions created
           * by the current SentinelGrid checkout version.
           */
          if (open) {
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
              return {
                clientSecret:
                  open.client_secret,

                checkoutSessionId:
                  open.id,
              };
            }

            /*
             * Expire old Embedded/Hosted/Custom sessions
             * that no longer match this implementation.
             */
            await stripe.checkout.sessions.expire(
              open.id
            );
          }

          /* =================================================
             CHECKOUT ATTEMPT
          ================================================= */

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

          const attempt =
            !open &&
            !state.checkout_session_id &&
            recentAttempt &&
            state.checkout_attempt_id
              ? state.checkout_attempt_id
              : randomUUID();

          await saveBillingReferences(
            organizationId,
            token,
            {
              checkout_attempt_id:
                attempt,

              checkout_attempt_at:
                new Date().toISOString(),
            }
          );

          const metadata =
            {
              organization_id:
                organizationId,

              requested_plan:
                plan,

              checkout_attempt_id:
                attempt,

              checkout_version:
                CHECKOUT_VERSION,
            };

          /* =================================================
             CREATE CUSTOM CHECKOUT SESSION
          ================================================= */

          const session =
            await stripe.checkout.sessions.create(
              {
                customer:
                  customerId,

                mode:
                  "subscription",

                /*
                 * Custom Checkout Sessions + Stripe Elements.
                 */
                ui_mode:
                  "custom",
                
                locale:
                  "en-GB",

                line_items:
                  [
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

                subscription_data:
                  {
                    metadata,
                  },

                /*
                 * Used by redirect-based payment methods.
                 *
                 * For normal card payments our React flow can
                 * complete without leaving the application.
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

        /* =================================================
           EXISTING SUBSCRIPTION REQUIRED
        ================================================= */

        if (
          !existing ||
          (
            state.provider_subscription_id &&
            existing.id !==
              state.provider_subscription_id
          )
        ) {
          throw new BillingError(
            "No current subscription was found. Refresh billing."
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

        /* =================================================
           CANCEL / RESUME
        ================================================= */

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
              "Stripe accepted the request. Confirming subscription state.",
          };
        }

        /* =================================================
           PLAN CHANGE
        ================================================= */

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

        const currentPlan =
          planForPrice(
            item.price.id
          );

        const resolvedPrice =
          await validatePrice(
            plan
          );

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

        /* =================================================
           BUSINESS -> PRO
        ================================================= */

        if (
          currentPlan ===
            "business" &&
          plan ===
            "pro"
        ) {
          if (
            sub.cancel_at_period_end
          ) {
            throw new BillingError(
              "Resume your subscription before scheduling a downgrade."
            );
          }

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
        } else {
          /* ===============================================
             PRO -> BUSINESS
          ================================================ */

          if (
            sub.cancel_at_period_end
          ) {
            throw new BillingError(
              "Resume your subscription before upgrading."
            );
          }

          await releaseSchedule();

          await upgradeSubscription(
            sub,
            resolvedPrice
          );

          /*
           * Webhook remains the source of truth.
           */
        }

        return {
          message:
            "Stripe accepted the plan change. Confirming your subscription.",
        };
      }
    );

  revalidatePath(
    "/dashboard",
    "layout"
  );

  return result;
}