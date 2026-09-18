import "server-only";

import {
  assertOrganizationPermission,
} from "@/lib/organization-access";

import {
  loadBillingSubscription,
} from "@/lib/billing/entitlements";

import {
  getStripe,
  planForPrice,
} from "@/lib/billing/stripe";

import {
  singleSubscriptionItem,
} from "@/lib/billing/subscriptions";

export type BillingManagementSummary = {
  customer: {
    id: string;
  } | null;

  subscription: {
    id: string;

    plan:
      | "pro"
      | "business"
      | null;

    status: string;

    cancelAtPeriodEnd:
      boolean;

    periodEnd:
      string | null;

    amount:
      number | null;

    currency:
      string;
  } | null;

  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;

  invoices: {
    id: string;
    number: string | null;
    status: string | null;
    amount: number;
    currency: string;
    createdAt: string;
    url: string | null;
    pdf: string | null;
  }[];
};

export async function getBillingManagementSummary(
  organizationId: string
): Promise<BillingManagementSummary> {
  await assertOrganizationPermission(
    organizationId,
    "billing.manage"
  );

  const state =
    await loadBillingSubscription(
      organizationId
    );

  /* =========================================================
     NO STRIPE CUSTOMER
  ========================================================== */

  if (
    !state.provider_customer_id
  ) {
    return {
      customer: null,
      subscription: null,
      paymentMethod: null,
      invoices: [],
    };
  }

  const stripe =
    getStripe();

  const customerId =
    state.provider_customer_id;

  /* =========================================================
     STRIPE SUBSCRIPTION
  ========================================================== */

  const subscriptions =
    await stripe.subscriptions.list({
      customer:
        customerId,

      status:
        "all",

      limit:
        100,
    });

  if (
    subscriptions.has_more
  ) {
    throw new Error(
      "Subscription history requires reconciliation."
    );
  }

  /*
   * Ignore subscriptions that are already fully terminated.
   *
   * A subscription scheduled for cancellation still has
   * status "active" and therefore remains visible here.
   */
  const live =
    subscriptions.data.filter(
      (subscription) =>
        ![
          "canceled",
          "incomplete_expired",
        ].includes(
          subscription.status
        )
    );

  if (
    live.length >
    1
  ) {
    throw new Error(
      "Multiple live Stripe subscriptions require reconciliation."
    );
  }

  const liveSubscription =
    live[0] ?? null;

  let subscription:
    BillingManagementSummary["subscription"] =
      null;

  let paymentMethod:
    BillingManagementSummary["paymentMethod"] =
      null;

  /* =========================================================
     SUBSCRIPTION DETAILS
  ========================================================== */

  if (
    liveSubscription
  ) {
    const detailed =
      await stripe.subscriptions.retrieve(
        liveSubscription.id,
        {
          expand: [
            "default_payment_method",
          ],
        }
      );

    const item =
      singleSubscriptionItem(
        detailed
      );

    let plan:
      | "pro"
      | "business"
      | null = null;

    try {
      plan =
        planForPrice(
          item.price.id
        );
    } catch {
      /*
       * Keep the billing manager usable even if Stripe
       * contains a legacy/unrecognized price.
       */
      plan =
        null;
    }

    subscription = {
      id:
        detailed.id,

      plan,

      status:
        detailed.status,

      cancelAtPeriodEnd:
        detailed.cancel_at_period_end,

      periodEnd:
        item.current_period_end
          ? new Date(
              item.current_period_end *
                1000
            ).toISOString()
          : null,

      amount:
        item.price.unit_amount ??
        null,

      currency:
        item.price.currency,
    };

    const method =
      detailed.default_payment_method;

    if (
      method &&
      typeof method !==
        "string" &&
      method.card
    ) {
      paymentMethod = {
        brand:
          method.card.brand,

        last4:
          method.card.last4,

        expMonth:
          method.card.exp_month,

        expYear:
          method.card.exp_year,
      };
    }
  }

  /* =========================================================
     FALLBACK CUSTOMER PAYMENT METHOD
  ========================================================== */

  if (
    !paymentMethod
  ) {
    const customer =
      await stripe.customers.retrieve(
        customerId,
        {
          expand: [
            "invoice_settings.default_payment_method",
          ],
        }
      );

    if (
      !customer.deleted
    ) {
      const method =
        customer.invoice_settings
          .default_payment_method;

      if (
        method &&
        typeof method !==
          "string" &&
        method.card
      ) {
        paymentMethod = {
          brand:
            method.card.brand,

          last4:
            method.card.last4,

          expMonth:
            method.card.exp_month,

          expYear:
            method.card.exp_year,
        };
      }
    }
  }

  /* =========================================================
     INVOICES
  ========================================================== */

  const invoices =
    await stripe.invoices.list({
      customer:
        customerId,

      limit:
        10,
    });

  /* =========================================================
     RESULT
  ========================================================== */

  return {
    customer: {
      id:
        customerId,
    },

    subscription,

    paymentMethod,

    invoices:
    invoices.data.map(
        (invoice) => ({
        id:
            invoice.id,

        number:
            invoice.number,

        status:
            invoice.status,

        amount:
            invoice.status ===
            "paid"
            ? invoice.amount_paid
            : invoice.amount_due,

        currency:
            invoice.currency,

        createdAt:
            new Date(
            invoice.created *
                1000
            ).toISOString(),

        url:
            invoice.hosted_invoice_url ??
            null,

        pdf:
            invoice.invoice_pdf ??
            null,
        })
    ),
  };
}