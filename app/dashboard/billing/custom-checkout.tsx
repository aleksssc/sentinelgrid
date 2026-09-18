"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  loadStripe,
} from "@stripe/stripe-js";

import {
  CheckoutElementsProvider,
  ContactDetailsElement,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";

/* =========================================================
   STRIPE
========================================================= */

const publishableKey =
  process.env
    .NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

const stripePromise =
  publishableKey
    ? loadStripe(
        publishableKey
      )
    : null;

/* =========================================================
   THEME
========================================================= */

type CheckoutTheme = {
  surface: string;
  raised: string;
  inset: string;
  border: string;
  muted: string;
  accent: string;
  accentText: string;
  primary: string;
  primaryHover: string;
  primaryInk: string;
  radius: string;
};

const fallbackTheme: CheckoutTheme = {
  surface: "#0d0f12",
  raised: "#12151a",
  inset: "#090b0e",
  border: "#252a32",
  muted: "#959ca8",
  accent: "#60a5fa",
  accentText: "#93c5fd",
  primary: "#e2e8f0",
  primaryHover: "#dbeafe",
  primaryInk: "#0c1626",
  radius: "10px",
};

function cssVariable(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: string
) {
  const value =
    styles
      .getPropertyValue(name)
      .trim();

  return value || fallback;
}

function readCheckoutTheme(): CheckoutTheme {
  if (
    typeof window ===
    "undefined"
  ) {
    return fallbackTheme;
  }

  const root =
    document.querySelector(
      ".sg-dashboard"
    ) ??
    document.documentElement;

  const styles =
    getComputedStyle(root);

  return {
    surface:
      cssVariable(
        styles,
        "--sg-surface",
        fallbackTheme.surface
      ),

    raised:
      cssVariable(
        styles,
        "--sg-raised",
        fallbackTheme.raised
      ),

    inset:
      cssVariable(
        styles,
        "--sg-inset",
        fallbackTheme.inset
      ),

    border:
      cssVariable(
        styles,
        "--sg-border",
        fallbackTheme.border
      ),

    muted:
      cssVariable(
        styles,
        "--sg-muted",
        fallbackTheme.muted
      ),

    accent:
      cssVariable(
        styles,
        "--sg-accent",
        fallbackTheme.accent
      ),

    accentText:
      cssVariable(
        styles,
        "--sg-accent-text",
        fallbackTheme.accentText
      ),

    primary:
      cssVariable(
        styles,
        "--sg-primary",
        fallbackTheme.primary
      ),

    primaryHover:
      cssVariable(
        styles,
        "--sg-primary-hover",
        fallbackTheme.primaryHover
      ),

    primaryInk:
      cssVariable(
        styles,
        "--sg-primary-ink",
        fallbackTheme.primaryInk
      ),

    radius:
      cssVariable(
        styles,
        "--sg-control-radius",
        fallbackTheme.radius
      ),
  };
}

function useCheckoutTheme() {
  const [
    theme,
    setTheme,
  ] =
    useState<CheckoutTheme>(
      fallbackTheme
    );

  useEffect(() => {
    function updateTheme() {
      setTheme(
        readCheckoutTheme()
      );
    }

    updateTheme();

    /*
     * The application stores the selected theme on <html>
     * using data-sg-theme.
     *
     * Observe changes so an already-open Checkout also
     * follows the newly selected SentinelGrid theme.
     */
    const observer =
      new MutationObserver(
        updateTheme
      );

    observer.observe(
      document.documentElement,
      {
        attributes:
          true,

        attributeFilter:
          [
            "data-sg-theme",
          ],
      }
    );

    return () =>
      observer.disconnect();
  }, []);

  return theme;
}

/* =========================================================
   CHECKOUT FORM
========================================================= */

function CheckoutForm({
  organizationId,
  priceLabel,
  onComplete,
}: {
  organizationId: string;
  priceLabel: string;
  onComplete: () => void;
}) {
  const result =
    useCheckoutElements();

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);

  /* =======================================================
     LOADING
  ======================================================== */

  if (
    result.type ===
    "loading"
  ) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[var(--sg-muted)]">
          <span
            className="
              h-4
              w-4
              animate-spin
              rounded-full
              border-2
            "
            style={{
              borderColor:
                "var(--sg-border)",

              borderTopColor:
                "var(--sg-accent)",
            }}
          />

          Loading secure checkout...
        </div>
      </div>
    );
  }

  /* =======================================================
     PROVIDER ERROR
  ======================================================== */

  if (
    result.type ===
    "error"
  ) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300"
      >
        {result.error
          .message ||
          "Unable to load Stripe Checkout."}
      </div>
    );
  }

  const checkout =
    result.checkout;

  /* =======================================================
     SUBMIT
  ======================================================== */

  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (
      submitting ||
      !checkout.canConfirm
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const confirmation =
        await checkout.confirm();

      if (
        confirmation.type ===
        "error"
      ) {
        setError(
          confirmation.error
            .message ||
            "Payment could not be confirmed."
        );

        setSubmitting(false);

        return;
      }

      /*
      * Stripe webhook remains
      * the billing source of truth.
      */
      onComplete();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Payment could not be confirmed."
      );

      setSubmitting(false);
    }
  }

  /* =======================================================
     RENDER
  ======================================================== */

  return (
    <form
      onSubmit={
        handleSubmit
      }
      className="space-y-7"
    >
      {/* ===================================================
          CONTACT
      ==================================================== */}

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Contact details
          </h3>

          <p className="mt-1 text-xs text-[var(--sg-muted)]">
            Used for billing and payment confirmation.
          </p>
        </div>

        <ContactDetailsElement />
      </section>

      {/* ===================================================
          PAYMENT
      ==================================================== */}

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Payment method
          </h3>

          <p className="mt-1 text-xs text-[var(--sg-muted)]">
            Payment details are processed securely by Stripe.
          </p>
        </div>

        <PaymentElement />
      </section>

      {/* ===================================================
          ERROR
      ==================================================== */}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300"
        >
          {
            error
          }
        </div>
      )}

      {/* ===================================================
          SUBMIT
      ==================================================== */}

      <button
        type="submit"
        disabled={
          submitting ||
          !checkout.canConfirm
        }
        className="
          flex
          h-12
          w-full
          items-center
          justify-center
          px-4
          text-sm
          font-semibold
          transition
          disabled:cursor-not-allowed
          disabled:opacity-50
        "
        style={{
          background:
            "var(--sg-primary)",

          color:
            "var(--sg-primary-ink)",

          borderRadius:
            "var(--sg-control-radius)",
        }}
        onMouseEnter={(event) => {
          if (
            !event.currentTarget
              .disabled
          ) {
            event.currentTarget.style.background =
              "var(--sg-primary-hover)";
          }
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background =
            "var(--sg-primary)";
        }}
      >
        {submitting
          ? "Processing..."
          : `Subscribe · ${priceLabel}`}
      </button>

      {/* ===================================================
          FOOTER
      ==================================================== */}

      <div className="flex items-center justify-center gap-2 text-[11px] text-[var(--sg-muted)]">
        <span>
          Secure payments by Stripe
        </span>

        <span>
          •
        </span>

        <span>
          SentinelGrid
        </span>
      </div>
    </form>
  );
}

/* =========================================================
   PROVIDER
========================================================= */

export default function CustomBillingCheckout({
  clientSecret,
  organizationId,
  priceLabel,
  onComplete,
}: {
  clientSecret: string;
  organizationId: string;
  priceLabel: string;
  onComplete: () => void;
}) {
  const theme =
    useCheckoutTheme();

  /*
   * CheckoutElementsProvider supports appearance updates.
   *
   * When data-sg-theme changes, these resolved colors change
   * too and Stripe updates the Elements appearance.
   */
  const options =
    useMemo(
      () => ({
        clientSecret,

        elementsOptions:
          {
            appearance:
              {
                theme:
                  "night" as const,

                variables:
                  {
                    colorPrimary:
                      theme.accent,

                    colorBackground:
                      theme.inset,

                    colorText:
                      "#ffffff",

                    colorTextSecondary:
                      theme.muted,

                    colorDanger:
                      "#f87171",

                    fontFamily:
                      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",

                    borderRadius:
                      theme.radius,

                    spacingUnit:
                      "4px",
                  },

                rules:
                  {
                    ".Input":
                      {
                        backgroundColor:
                          theme.raised,

                        borderColor:
                          theme.border,

                        boxShadow:
                          "none",
                      },

                    ".Input:hover":
                      {
                        borderColor:
                          theme.accent,
                      },

                    ".Input:focus":
                      {
                        borderColor:
                          theme.accent,

                        boxShadow:
                          `0 0 0 1px ${theme.accent}`,
                      },

                    ".Label":
                      {
                        color:
                          "#ffffff",
                      },

                    ".Tab":
                      {
                        backgroundColor:
                          theme.inset,

                        borderColor:
                          theme.border,

                        boxShadow:
                          "none",
                      },

                    ".Tab:hover":
                      {
                        backgroundColor:
                          theme.raised,

                        borderColor:
                          theme.accent,
                      },

                    ".Tab--selected":
                      {
                        backgroundColor:
                          theme.raised,

                        borderColor:
                          theme.accent,

                        boxShadow:
                          `0 0 0 1px ${theme.accent}`,
                      },
                  },
              },
          },
      }),
      [
        clientSecret,
        theme,
      ]
    );

  if (
    !publishableKey ||
    !stripePromise
  ) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300"
      >
        Stripe Checkout is not configured.
      </div>
    );
  }

  return (
    <CheckoutElementsProvider
      stripe={
        stripePromise
      }
      options={
        options
      }
    >
      <CheckoutForm
        organizationId={
          organizationId
        }
        priceLabel={
          priceLabel
        }
        onComplete={
          onComplete
        }
      />
    </CheckoutElementsProvider>
  );
}