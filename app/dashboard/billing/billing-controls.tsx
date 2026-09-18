"use client";

import {
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  ArrowRight,
  Check,
  ShieldCheck,
  X,
} from "lucide-react";

import ViewportDialog from "@/components/dashboard/viewport-dialog";

import {
  PLANS,
  PLAN_ORDER,
  SALES_URL,
  formatPlanPrice,
  planMarketingFeatures,
  type PlanName,
} from "@/lib/plans";

import type {
  BillingAction,
} from "@/lib/billing/manage";

import CustomBillingCheckout from "./custom-checkout";

/* =========================================================
   TYPES
========================================================= */

type PaidPlan =
  | "pro"
  | "business";

type Selection = {
  action: BillingAction;
  plan?: PaidPlan;
  title: string;
};

type CheckoutState = {
  clientSecret: string;
  plan: PaidPlan;
};

/* =========================================================
   COMPONENT
========================================================= */

export default function BillingControls({
  organizationId,
  plan,
  owner,
  hasSubscription,
  hasCustomer,
  cancelAtPeriodEnd,
  confirming,
  pendingPlan,
}: {
  organizationId: string;
  plan: PlanName;
  owner: boolean;
  hasSubscription: boolean;
  hasCustomer: boolean;
  cancelAtPeriodEnd: boolean;
  confirming: boolean;
  pendingPlan: string | null;
}) {
  const router =
    useRouter();

  const [
    selection,
    setSelection,
  ] =
    useState<Selection | null>(
      null
    );

  const [
    checkout,
    setCheckout,
  ] =
    useState<CheckoutState | null>(
      null
    );

  const [
    message,
    setMessage,
  ] =
    useState<string | null>(
      null
    );

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  const [
    waiting,
    setWaiting,
  ] =
    useState(
      confirming
    );

  useEffect(() => {
    if (
      hasSubscription &&
      !confirming
    ) {
      setWaiting(false);
      setMessage(null);
    }
  }, [
    hasSubscription,
    confirming,
  ]);

  const [
    busy,
    startTransition,
  ] =
    useTransition();

  /* =========================================================
     WEBHOOK CONFIRMATION
  ========================================================== */

  useEffect(() => {
    if (!waiting) {
      return;
    }

    let attempts =
      0;

    const timer =
      setInterval(
        () => {
          router.refresh();

          attempts += 1;

          if (
            attempts >=
            12
          ) {
            clearInterval(
              timer
            );

            setWaiting(
              false
            );
          }
        },
        5000
      );

    return () =>
      clearInterval(
        timer
      );
  }, [
    waiting,
    router,
  ]);

  /* =========================================================
     CHECKOUT COMPLETE
  ========================================================== */

  const handleCheckoutComplete =
    useCallback(
      () => {
        setCheckout(
          null
        );

        setSelection(
          null
        );

        setError(
          null
        );

        setMessage(
          "Payment submitted. Confirming your subscription with Stripe."
        );

        setWaiting(
          true
        );

        router.refresh();
      },
      [
        router,
      ]
    );

  /* =========================================================
     BILLING REQUEST
  ========================================================== */

  function submit(
    value: Selection
  ) {
    setError(
      null
    );

    startTransition(
      async () => {
        try {
          const response =
            await fetch(
              `/api/billing/${value.action}`,
              {
                method:
                  "POST",

                headers:
                  {
                    "Content-Type":
                      "application/json",
                  },

                body:
                  JSON.stringify(
                    {
                      organizationId,

                      ...(value.plan
                        ? {
                            plan:
                              value.plan,
                          }
                        : {}),
                    }
                  ),
              }
            );

          const result =
            await response.json();

          if (
            !response.ok
          ) {
            throw new Error(
              result.error ||
                "Billing request failed"
            );
          }

          /* ===============================================
             CUSTOM STRIPE CHECKOUT
          ================================================ */

          if (
            value.action ===
            "checkout"
          ) {
            if (
              !value.plan
            ) {
              throw new Error(
                "Checkout plan is missing"
              );
            }

            if (
              typeof result.clientSecret !==
                "string" ||
              !result.clientSecret
            ) {
              throw new Error(
                "Stripe did not return a Checkout session"
              );
            }

            setSelection(
              null
            );

            setCheckout(
              {
                clientSecret:
                  result.clientSecret,

                plan:
                  value.plan,
              }
            );

            return;
          }

          /* ===============================================
             CUSTOMER PORTAL
          ================================================ */

          if (
            result.url
          ) {
            window.location.assign(
              result.url
            );

            return;
          }

          /* ===============================================
             CHANGE / CANCEL / RESUME
          ================================================ */

          setSelection(
            null
          );

          setMessage(
            result.message ??
              null
          );

          setWaiting(
            true
          );

          router.refresh();
        } catch (
          cause
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Billing request failed"
          );
        }
      }
    );
  }

  /* =========================================================
     OPEN CONFIRMATION
  ========================================================== */

  function openSelection(
    value: Selection
  ) {
    setError(
      null
    );

    setMessage(
      null
    );

    setSelection(
      value
    );
  }

  /* =========================================================
     RENDER
  ========================================================== */

  return (
    <>
      {/* =====================================================
          STATUS
      ====================================================== */}

      {(message ||
        confirming ||
        waiting) && (
        <div
          role="status"
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            background:
              "var(--sg-accent-soft)",

            borderColor:
              "var(--sg-accent-edge)",

            color:
              "var(--sg-accent-text)",
          }}
        >
          {message ??
            "Confirming your subscription with Stripe..."}
        </div>
      )}

      {error &&
        !selection &&
        !checkout && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300"
          >
            {
              error
            }
          </div>
        )}

      {!owner && (
        <p className="text-sm text-surface-muted">
          Only the organization owner can change billing.
        </p>
      )}

      {/* =====================================================
          AVAILABLE PLANS
      ====================================================== */}

      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">
            Available plans
          </h2>

          <p className="mt-1 text-sm text-surface-muted">
            Choose the plan that fits your infrastructure.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

          {PLAN_ORDER.map(
            (
              slug
            ) => {
              const current =
                slug ===
                plan;

              const popular =
                slug ===
                "business";

              const canChange =
                owner &&
                plan !==
                  "enterprise";

              const features =
                planMarketingFeatures(
                  slug
                );

              return (
                <article
                  key={
                    slug
                  }
                  className="
                    relative
                    flex
                    min-h-[420px]
                    flex-col
                    border
                    p-5
                    shadow-[0_10px_30px_rgba(0,0,0,0.18)]
                    transition
                  "
                  style={{
                    borderRadius:
                      "var(--sg-panel-radius)",

                    background:
                      current
                        ? "var(--sg-selected)"
                        : "var(--sg-surface)",

                    borderColor:
                      current
                        ? "var(--sg-accent-edge)"
                        : "var(--sg-border)",
                  }}
                >
                  {/* =========================================
                      PLAN HEADER
                  ========================================== */}

                  <div className="mb-4 flex min-h-6 items-center justify-between gap-2">

                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sg-muted)]">
                      {
                        PLANS[
                          slug
                        ].name
                      }
                    </span>

                    {popular &&
                      !current && (
                        <span
                          className="
                            rounded-full
                            border
                            px-2
                            py-1
                            text-[10px]
                            font-semibold
                            uppercase
                            tracking-wider
                          "
                          style={{
                            borderColor:
                              "var(--sg-accent-edge)",

                            background:
                              "var(--sg-accent-soft)",

                            color:
                              "var(--sg-accent-text)",
                          }}
                        >
                          Popular
                        </span>
                      )}

                    {current && (
                      <span
                        className="
                          rounded-full
                          border
                          px-2
                          py-1
                          text-[10px]
                          font-semibold
                          uppercase
                          tracking-wider
                        "
                        style={{
                          borderColor:
                            "var(--sg-accent-edge)",

                          background:
                            "var(--sg-accent-soft)",

                          color:
                            "var(--sg-accent-text)",
                        }}
                      >
                        Current plan
                      </span>
                    )}
                  </div>

                  {/* =========================================
                      PRICE
                  ========================================== */}

                  <div>
                    <div className="flex items-end gap-1">

                      <span className="text-3xl font-semibold tracking-tight text-white">
                        {formatPlanPrice(
                          slug
                        )}
                      </span>

                      {slug !==
                        "enterprise" && (
                        <span className="pb-1 text-xs text-[var(--sg-muted)]">
                          / month
                        </span>
                      )}
                    </div>

                    <p className="mt-3 min-h-10 text-sm leading-5 text-[var(--sg-muted)]">
                      {
                        PLANS[
                          slug
                        ]
                          .description
                      }
                    </p>
                  </div>

                  {/* DIVIDER */}

                  <div
                    className="my-5 border-t"
                    style={{
                      borderColor:
                        "var(--sg-border)",
                    }}
                  />

                  {/* =========================================
                      FEATURES
                  ========================================== */}

                  <ul className="flex-1 space-y-3 text-sm">

                    {features.map(
                      (
                        feature
                      ) => (
                        <li
                          key={
                            feature
                          }
                          className="flex items-start gap-2.5 text-zinc-300"
                        >
                          <Check
                            size={
                              15
                            }
                            className="mt-0.5 shrink-0"
                            style={{
                              color:
                                "var(--sg-accent-text)",
                            }}
                          />

                          <span>
                            {
                              feature
                            }
                          </span>
                        </li>
                      )
                    )}
                  </ul>

                  {/* =========================================
                      ACTION
                  ========================================== */}

                  <div className="mt-6">

                    {/* ENTERPRISE */}

                    {slug ===
                      "enterprise" && (
                      <a
                        href={
                          SALES_URL
                        }
                        className="sg-button sg-button-secondary w-full justify-center"
                      >
                        Contact Sales

                        <ArrowRight
                          size={
                            15
                          }
                        />
                      </a>
                    )}

                    {/* CURRENT PLAN */}

                    {slug !==
                      "enterprise" &&
                      current &&
                      !pendingPlan && (
                        <button
                          type="button"
                          disabled
                          className="sg-button sg-button-secondary w-full justify-center opacity-60"
                        >
                          Current Plan
                        </button>
                      )}

                    {/* FREE */}

                    {slug ===
                      "free" &&
                      !current &&
                      owner &&
                      hasSubscription &&
                      !cancelAtPeriodEnd && (
                        <button
                          type="button"
                          disabled={
                            busy
                          }
                          className="sg-button sg-button-secondary w-full justify-center"
                          onClick={() =>
                            openSelection(
                              {
                                action:
                                  "cancel",

                                title:
                                  "Move to Free?",
                              }
                            )
                          }
                        >
                          Change Plan

                          <ArrowRight
                            size={
                              15
                            }
                          />
                        </button>
                      )}

                    {/* PRO / BUSINESS */}

                    {(slug ===
                      "pro" ||
                      slug ===
                        "business") &&
                      canChange &&
                      (
                        !current ||
                        pendingPlan
                      ) && (
                        <button
                          type="button"
                          disabled={
                            busy
                          }
                          className="sg-button sg-button-primary w-full justify-center"
                          onClick={() =>
                            openSelection(
                              {
                                action:
                                  hasSubscription
                                    ? "change"
                                    : "checkout",

                                plan:
                                  slug,

                                title:
                                  current
                                    ? `Keep ${PLANS[slug].name}?`
                                    : `${
                                        plan ===
                                          "business" &&
                                        slug ===
                                          "pro"
                                          ? "Downgrade"
                                          : "Upgrade"
                                      } to ${PLANS[slug].name}?`,
                              }
                            )
                          }
                        >
                          {current
                            ? "Keep current plan"
                            : "Change Plan"}

                          <ArrowRight
                            size={
                              15
                            }
                          />
                        </button>
                      )}
                  </div>
                </article>
              );
            }
          )}
        </div>
      </div>

      {/* =====================================================
          CONFIRMATION DIALOG
      ====================================================== */}

      {selection && (
        <ViewportDialog
          label={
            selection.title
          }
          onDismiss={() => {
            if (
              !busy
            ) {
              setSelection(
                null
              );
            }
          }}
        >
          <div
            className="
              w-full
              max-w-lg
              border
              p-6
              text-white
              shadow-2xl
            "
            style={{
              borderColor:
                "var(--sg-border)",

              background:
                "var(--sg-surface)",

              borderRadius:
                "var(--sg-panel-radius)",
            }}
          >
            <h2 className="text-xl font-semibold">
              {
                selection.title
              }
            </h2>

            {selection.plan && (
              <div
                className="mt-5 border p-4"
                style={{
                  borderColor:
                    "var(--sg-border)",

                  background:
                    "var(--sg-inset)",

                  borderRadius:
                    "var(--sg-control-radius)",
                }}
              >
                <div className="flex items-end gap-1">

                  <span className="text-2xl font-semibold">
                    {formatPlanPrice(
                      selection.plan
                    )}
                  </span>

                  <span className="pb-0.5 text-xs text-[var(--sg-muted)]">
                    / month
                  </span>
                </div>

                <p className="mt-2 text-sm text-[var(--sg-muted)]">
                  {
                    PLANS[
                      selection
                        .plan
                    ]
                      .description
                  }
                </p>

                <ul className="mt-4 space-y-2 text-sm">

                  {planMarketingFeatures(
                    selection.plan
                  ).map(
                    (
                      feature
                    ) => (
                      <li
                        key={
                          feature
                        }
                        className="flex items-start gap-2"
                      >
                        <Check
                          size={
                            14
                          }
                          className="mt-0.5 shrink-0"
                          style={{
                            color:
                              "var(--sg-accent-text)",
                          }}
                        />

                        <span>
                          {
                            feature
                          }
                        </span>
                      </li>
                    )
                  )}
                </ul>
              </div>
            )}

            <p className="my-5 text-sm leading-6 text-[var(--sg-muted)]">

              {selection.action ===
              "cancel"
                ? "Your subscription remains active until the end of the current billing period. After that your organization moves to Free. Existing data will not be deleted."

                : selection.action ===
                    "resume"
                  ? "Continue your subscription and its regular monthly renewals before cancellation takes effect."

                  : plan ===
                        "business" &&
                      selection.plan ===
                        "pro"
                    ? "The downgrade takes effect at the end of the billing period. Existing data stays available; new creations are blocked while usage is at or above the new limits."

                    : selection.plan ===
                          plan &&
                        pendingPlan
                      ? "The scheduled downgrade will be removed. Your current plan and regular renewal price remain unchanged."

                      : hasSubscription
                        ? "Stripe will calculate the prorated plan change. Your limits change only after Stripe confirms it."

                        : "Continue to secure checkout to complete your subscription."}
            </p>

            {error && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300"
              >
                {
                  error
                }
              </div>
            )}

            <div className="flex justify-end gap-3">

              <button
                type="button"
                disabled={
                  busy
                }
                className="sg-button sg-button-secondary"
                onClick={() =>
                  setSelection(
                    null
                  )
                }
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={
                  busy
                }
                className="sg-button sg-button-primary"
                onClick={() =>
                  submit(
                    selection
                  )
                }
              >
                {busy
                  ? "Processing..."
                  : "Continue"}
              </button>
            </div>
          </div>
        </ViewportDialog>
      )}

      {/* =====================================================
          CUSTOM STRIPE CHECKOUT
      ====================================================== */}

      {checkout && (
        <ViewportDialog
          label={`Subscribe to ${PLANS[checkout.plan].name}`}
          onDismiss={() =>
            setCheckout(
              null
            )
          }
        >
          <div
            className="
              flex
              max-h-[92vh]
              w-[min(720px,calc(100vw-2rem))]
              flex-col
              overflow-hidden
              border
              shadow-2xl
            "
            style={{
              background:
                "var(--sg-surface)",

              borderColor:
                "var(--sg-border)",

              borderRadius:
                "var(--sg-panel-radius)",
            }}
          >
            {/* HEADER */}

            <div
              className="
                flex
                shrink-0
                items-start
                justify-between
                gap-5
                border-b
                px-6
                py-5
              "
              style={{
                background:
                  "var(--sg-inset)",

                borderColor:
                  "var(--sg-border)",
              }}
            >
              <div>

                <div
                  className="
                    flex
                    items-center
                    gap-2
                    text-xs
                    font-semibold
                    uppercase
                    tracking-[0.16em]
                  "
                  style={{
                    color:
                      "var(--sg-accent-text)",
                  }}
                >
                  <ShieldCheck
                    size={
                      14
                    }
                  />

                  Secure checkout
                </div>

                <h2 className="mt-2 text-xl font-semibold text-white">
                  Subscribe to{" "}
                  {
                    PLANS[
                      checkout
                        .plan
                    ].name
                  }
                </h2>

                <p className="mt-1 text-sm text-[var(--sg-muted)]">
                  {formatPlanPrice(
                    checkout.plan
                  )}
                  {" "}
                  / month
                </p>
              </div>

              <button
                type="button"
                aria-label="Close checkout"
                title="Close checkout"
                className="
                  inline-flex
                  h-9
                  w-9
                  shrink-0
                  items-center
                  justify-center
                  border
                  text-[var(--sg-muted)]
                  transition
                  hover:text-white
                "
                style={{
                  background:
                    "var(--sg-raised)",

                  borderColor:
                    "var(--sg-border)",

                  borderRadius:
                    "var(--sg-control-radius)",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background =
                    "var(--sg-hover)";

                  event.currentTarget.style.borderColor =
                    "var(--sg-accent-edge)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background =
                    "var(--sg-raised)";

                  event.currentTarget.style.borderColor =
                    "var(--sg-border)";
                }}
                onClick={() =>
                  setCheckout(
                    null
                  )
                }
              >
                <X
                  size={
                    17
                  }
                />
              </button>
            </div>

            {/* BODY */}

            <div
              className="min-h-0 flex-1 overflow-y-auto"
              style={{
                background:
                  "var(--sg-surface)",
              }}
            >
              <div className="mx-auto w-full max-w-[620px] p-6">

                <CustomBillingCheckout
                  key={
                    checkout.clientSecret
                  }
                  clientSecret={
                    checkout.clientSecret
                  }
                  organizationId={
                    organizationId
                  }
                  priceLabel={`${formatPlanPrice(
                    checkout.plan
                  )} / month`}
                  onComplete={
                    handleCheckoutComplete
                  }
                />
              </div>
            </div>
          </div>
        </ViewportDialog>
      )}
    </>
  );
}