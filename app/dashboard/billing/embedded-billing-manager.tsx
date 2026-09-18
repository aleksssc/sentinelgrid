"use client";

import {
  CreditCard,
  ExternalLink,
  FileText,
  Loader2,
  ReceiptText,
  RotateCcw,
  X,
} from "lucide-react";

import {
  useEffect,
  useState,
  useTransition,
} from "react";

import {
  useRouter,
} from "next/navigation";

import ViewportDialog from "@/components/dashboard/viewport-dialog";

import type {
  BillingManagementSummary,
} from "@/lib/billing/management";

export default function EmbeddedBillingManager({
  organizationId,
}: {
  organizationId: string;
}) {
  const router =
    useRouter();

  const [
    open,
    setOpen,
  ] =
    useState(false);

  const [
    data,
    setData,
  ] =
    useState<BillingManagementSummary | null>(
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
    confirming,
    setConfirming,
  ] =
    useState<
      | "cancel"
      | "resume"
      | null
    >(
      null
    );

  const [
    busy,
    startTransition,
  ] =
    useTransition();

  /* =========================================================
     LOAD BILLING
  ========================================================== */

  async function load() {
    setError(
      null
    );

    try {
      const response =
        await fetch(
          `/api/billing/summary?organizationId=${encodeURIComponent(
            organizationId
          )}`,
          {
            cache:
              "no-store",
          }
        );

      const result =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          result.error ||
            "Unable to load billing."
        );
      }

      setData(
        result
      );
    } catch (
      cause
    ) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load billing."
      );
    }
  }

  useEffect(() => {
    if (
      open
    ) {
      void load();
    }
  }, [
    open,
    organizationId,
  ]);

  /* =========================================================
     BILLING ACTION
  ========================================================== */

  function action(
    billingAction:
      | "cancel"
      | "resume"
  ) {
    startTransition(
      async () => {
        setError(
          null
        );

        try {
          const response =
            await fetch(
              `/api/billing/${billingAction}`,
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body:
                  JSON.stringify({
                    organizationId,
                  }),
              }
            );

          const result =
            await response.json();

          if (
            !response.ok
          ) {
            throw new Error(
              result.error ||
                "Billing action failed."
            );
          }

          setConfirming(
            null
          );

          /*
           * Give Stripe/webhook a moment
           * to update the subscription state.
           */
          await new Promise(
            (
              resolve
            ) =>
              setTimeout(
                resolve,
                1200
              )
          );

          await load();

          router.refresh();
        } catch (
          cause
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Billing action failed."
          );
        }
      }
    );
  }

  /* =========================================================
     RENDER
  ========================================================== */

  return (
    <>
      <button
        type="button"
        className="sg-button sg-button-secondary sg-button-sm"
        onClick={() =>
          setOpen(
            true
          )
        }
      >
        <CreditCard
          size={14}
        />

        Manage billing
      </button>

      {open && (
        <ViewportDialog
          label="Manage billing"
          onDismiss={() => {
            if (
              !busy
            ) {
              setOpen(
                false
              );
            }
          }}
        >
          <div
            className="
              flex
              max-h-[90vh]
              w-[min(760px,calc(100vw-2rem))]
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
            {/* =================================================
                HEADER
            ================================================== */}

            <div className="flex items-center justify-between border-b border-surface-edge px-6 py-5">

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-surface-muted">
                  Billing
                </p>

                <h2 className="mt-1 text-xl font-semibold text-white">
                  Manage billing
                </h2>
              </div>

             <button
                type="button"
                disabled={busy}
                aria-label="Close billing"
                title="Close"
                className="
                    inline-flex
                    h-9
                    w-9
                    shrink-0
                    items-center
                    justify-center
                    rounded-lg
                    border
                    border-surface-edge
                    bg-surface-raised
                    text-surface-muted
                    transition
                    hover:border-[var(--sg-accent-edge)]
                    hover:bg-surface
                    hover:text-white
                    disabled:cursor-not-allowed
                    disabled:opacity-50
                "
                onClick={() =>
                    setOpen(false)
                }
                >
                <X
                    size={18}
                    strokeWidth={2}
                    className="h-[18px] w-[18px]"
                />
                </button>
            </div>

            {/* =================================================
                BODY
            ================================================== */}

            <div className="min-h-0 flex-1 overflow-y-auto p-6">

              {/* ===============================================
                  LOADING
              ================================================ */}

              {!data &&
                !error && (
                  <div className="flex min-h-52 items-center justify-center gap-3 text-sm text-surface-muted">

                    <Loader2
                      size={17}
                      className="animate-spin"
                    />

                    Loading billing...
                  </div>
                )}

              {/* ===============================================
                  ERROR
              ================================================ */}

              {error && (
                <div
                  role="alert"
                  className="mb-5 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300"
                >
                  {
                    error
                  }
                </div>
              )}

              {data && (
                <div className="space-y-5">

                  {/* ===========================================
                      SUBSCRIPTION
                  ============================================ */}

                  <section className="rounded-xl border border-surface-edge">

                    <div className="border-b border-surface-edge px-5 py-4">
                      <h3 className="font-semibold text-white">
                        Subscription
                      </h3>
                    </div>

                    <div className="grid gap-4 p-5 sm:grid-cols-2">

                      <div>
                        <p className="text-xs uppercase tracking-wider text-surface-muted">
                          Plan
                        </p>

                        <p className="mt-1 font-medium text-white">
                          {data.subscription?.plan
                            ? data.subscription.plan
                                .charAt(
                                  0
                                )
                                .toUpperCase() +
                              data.subscription.plan.slice(
                                1
                              )
                            : "No active subscription"}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-wider text-surface-muted">
                          Status
                        </p>

                        <p className="mt-1 font-medium capitalize text-white">
                          {data.subscription?.status ??
                            "None"}
                        </p>
                      </div>

                      {data.subscription?.periodEnd && (
                        <div>
                          <p className="text-xs uppercase tracking-wider text-surface-muted">
                            {data.subscription
                              .cancelAtPeriodEnd
                              ? "Ends"
                              : "Next renewal"}
                          </p>

                          <p className="mt-1 text-white">
                            {formatDate(
                              data.subscription
                                .periodEnd
                            )}
                          </p>
                        </div>
                      )}

                      {data.subscription &&
                        data.subscription.amount !==
                          null && (
                          <div>
                            <p className="text-xs uppercase tracking-wider text-surface-muted">
                              Price
                            </p>

                            <p className="mt-1 text-white">
                              {formatMoney(
                                data.subscription
                                  .amount,
                                data.subscription
                                  .currency
                              )}{" "}
                              / month
                            </p>
                          </div>
                        )}
                    </div>
                  </section>

                  {/* ===========================================
                      PAYMENT METHOD
                  ============================================ */}

                  <section className="rounded-xl border border-surface-edge">

                    <div className="flex items-center gap-2 border-b border-surface-edge px-5 py-4">

                      <CreditCard
                        size={16}
                        className="text-surface-muted"
                      />

                      <h3 className="font-semibold text-white">
                        Payment method
                      </h3>
                    </div>

                    <div className="p-5">

                      {data.paymentMethod ? (
                        <>
                          <p className="font-medium capitalize text-white">
                            {
                              data.paymentMethod
                                .brand
                            }{" "}
                            ••••{" "}
                            {
                              data.paymentMethod
                                .last4
                            }
                          </p>

                          <p className="mt-1 text-xs text-surface-muted">
                            Expires{" "}
                            {
                              data.paymentMethod
                                .expMonth
                            }
                            /
                            {
                              data.paymentMethod
                                .expYear
                            }
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-surface-muted">
                          No payment method recorded.
                        </p>
                      )}
                    </div>
                  </section>

                  {/* ===========================================
                      INVOICES
                  ============================================ */}

                  <section className="rounded-xl border border-surface-edge">

                    <div className="flex items-center gap-2 border-b border-surface-edge px-5 py-4">

                      <ReceiptText
                        size={16}
                        className="text-surface-muted"
                      />

                      <h3 className="font-semibold text-white">
                        Invoice history
                      </h3>
                    </div>

                    {data.invoices.length ? (
                      <div className="divide-y divide-surface-edge">

                        {data.invoices.map(
                          (
                            invoice
                          ) => (
                            <div
                              key={
                                invoice.id
                              }
                              className="flex items-center justify-between gap-4 px-5 py-4"
                            >
                              <div className="min-w-0">

                                <p className="text-sm font-medium text-white">
                                  {formatMoney(
                                    invoice.amount,
                                    invoice.currency
                                  )}
                                </p>

                                <p className="mt-1 text-xs text-surface-muted">
                                  {formatDate(
                                    invoice.createdAt
                                  )}{" "}
                                  ·{" "}
                                  {invoice.status ??
                                    "unknown"}
                                </p>
                              </div>

                              <div className="flex gap-2">

                                {invoice.url && (
                                  <a
                                    href={
                                      invoice.url
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    className="sg-button sg-button-secondary sg-button-sm"
                                  >
                                    <ExternalLink
                                      size={13}
                                    />

                                    View
                                  </a>
                                )}

                                {invoice.pdf && (
                                  <a
                                    href={
                                      invoice.pdf
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label="Download invoice PDF"
                                    className="sg-button sg-button-secondary sg-button-sm"
                                  >
                                    <FileText
                                      size={13}
                                    />
                                  </a>
                                )}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    ) : (
                      <p className="p-5 text-sm text-surface-muted">
                        No invoices yet.
                      </p>
                    )}
                  </section>

                  {/* ===========================================
                      SUBSCRIPTION ACTIONS
                  ============================================ */}

                  {data.subscription && (
                    <section className="rounded-xl border border-red-500/20 bg-red-500/[0.025]">

                      <div className="border-b border-red-500/15 px-5 py-4">

                        <h3 className="font-semibold text-white">
                          Subscription
                          actions
                        </h3>

                        <p className="mt-1 text-xs text-surface-muted">
                          Manage renewal of
                          your SentinelGrid
                          subscription.
                        </p>
                      </div>

                      <div className="p-5">

                        {!confirming ? (
                          <div className="flex flex-wrap gap-3">

                            {data.subscription
                              .cancelAtPeriodEnd ? (
                              <button
                                type="button"
                                disabled={
                                  busy
                                }
                                className="sg-button sg-button-secondary"
                                onClick={() =>
                                  setConfirming(
                                    "resume"
                                  )
                                }
                              >
                                <RotateCcw
                                  size={14}
                                />

                                Resume
                                subscription
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={
                                  busy
                                }
                                className="sg-button sg-button-danger"
                                onClick={() =>
                                  setConfirming(
                                    "cancel"
                                  )
                                }
                              >
                                Cancel
                                subscription
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">

                            <p className="text-sm leading-6 text-red-200">

                              {confirming ===
                              "resume"
                                ? "Resume your subscription? Normal monthly renewals will continue."

                                : data.subscription
                                      .periodEnd
                                  ? `Cancel your subscription? Your current plan will remain active until ${formatDate(
                                      data.subscription
                                        .periodEnd
                                    )}. After that, your organization will move to the Free plan.`

                                  : "Cancel your subscription? Your current plan will remain available until the end of the current billing period. After that, your organization will move to the Free plan."}
                            </p>

                            <div className="mt-4 flex justify-end gap-2">

                              <button
                                type="button"
                                disabled={
                                  busy
                                }
                                className="sg-button sg-button-secondary"
                                onClick={() =>
                                  setConfirming(
                                    null
                                  )
                                }
                              >
                                Back
                              </button>

                              <button
                                type="button"
                                disabled={
                                  busy
                                }
                                className={
                                  confirming ===
                                  "resume"
                                    ? "sg-button sg-button-primary"
                                    : "sg-button sg-button-danger"
                                }
                                onClick={() =>
                                  action(
                                    confirming
                                  )
                                }
                              >
                                {busy && (
                                  <Loader2
                                    size={14}
                                    className="animate-spin"
                                  />
                                )}

                                {confirming ===
                                "resume"
                                  ? "Resume subscription"
                                  : "Confirm cancellation"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </div>
        </ViewportDialog>
      )}
    </>
  );
}

/* =========================================================
   FORMATTERS
========================================================= */

function formatDate(
  value: string
) {
  return new Intl.DateTimeFormat(
    "en-GB",
    {
      dateStyle:
        "medium",
    }
  ).format(
    new Date(
      value
    )
  );
}

function formatMoney(
  amount: number,
  currency: string
) {
  return new Intl.NumberFormat(
    "en-GB",
    {
      style:
        "currency",

      currency:
        currency.toUpperCase(),
    }
  ).format(
    amount /
      100
  );
}