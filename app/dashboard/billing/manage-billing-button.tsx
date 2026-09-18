"use client";

import {
  CreditCard,
  Loader2,
} from "lucide-react";

import {
  useState,
  useTransition,
} from "react";

export default function ManageBillingButton({
  organizationId,
}: {
  organizationId: string;
}) {
  const [error, setError] =
    useState<string | null>(null);

  const [pending, startTransition] =
    useTransition();

  function openBillingPortal() {
    setError(null);

    startTransition(async () => {
      try {
        const response =
          await fetch(
            "/api/billing/portal",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({
                organizationId,
              }),
            }
          );

        const result =
          await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ||
              "Could not open billing portal."
          );
        }

        if (!result.url) {
          throw new Error(
            "Stripe did not return a billing portal URL."
          );
        }

        window.location.assign(
          result.url
        );
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not open billing portal."
        );
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={openBillingPortal}
        className="sg-button sg-button-secondary sg-button-sm"
      >
        {pending ? (
          <Loader2
            size={14}
            className="animate-spin"
          />
        ) : (
          <CreditCard size={14} />
        )}

        Manage billing
      </button>

      {error && (
        <p className="mt-2 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}