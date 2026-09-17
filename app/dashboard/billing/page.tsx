import Link from "next/link";

import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";

import {
  Activity,
  Building2,
  CreditCard,
  Crown,
  Monitor,
  Users,
} from "lucide-react";

import { getOrganizationContext } from "@/lib/organization-context";
import { getOrganizationEntitlements } from "@/lib/billing/entitlements";

import {
  PLANS,
  RESOURCES,
  formatPlanPrice,
  isPlanName,
} from "@/lib/plans";

import {
  PageHeader,
  Surface,
} from "@/components/dashboard/dashboard-primitives";

import BillingControls from "./billing-controls";

function formatDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function resourceIcon(resource: string) {
  switch (resource) {
    case "members":
      return <Users size={18} />;

    case "clients":
      return <Building2 size={18} />;

    case "devices":
      return <Monitor size={18} />;

    case "monitors":
      return <Activity size={18} />;

    default:
      return <Activity size={18} />;
  }
}

function resourceLabel(resource: string) {
  return resource.charAt(0).toUpperCase() + resource.slice(1);
}

function displayLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return "Custom";
  }

  return limit.toLocaleString("en-GB");
}

function usagePercentage(usage: number, limit: number) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((usage / limit) * 100));
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    organizationId?: string;
    checkout?: string;
  }>;
}) {
  await connection();

  const query = await searchParams;

  const context =
    await getOrganizationContext();

  if (!context.user) {
    redirect("/auth/login");
  }

  const organization =
    query.organizationId
      ? context.organizations.find(
          (item) =>
            item.id ===
            query.organizationId
        )
      : context.organization;

  if (!organization) {
    notFound();
  }

  const entitlements =
    await getOrganizationEntitlements(
      organization.id
    );

  const {
    plan,
    usage,
    limits,
    subscription: sub,
  } = entitlements;

  const paymentIssue =
    Boolean(sub.payment_issue) ||
    [
      "past_due",
      "unpaid",
      "incomplete",
    ].includes(sub.status);

  const currentPeriodEnd =
    formatDate(
      sub.current_period_end
    );

  const pendingPlanDate =
    formatDate(
      sub.pending_plan_at
    );

  const subscriptionActive =
    !paymentIssue &&
    [
      "active",
      "trialing",
    ].includes(sub.status);

  return (
    <div className="sg-page-shell">
      <div className="sg-page space-y-6">

        {/* =====================================================
            HEADER
        ====================================================== */}

        <PageHeader
          eyebrow="Account"
          title="Billing"
          description="Manage your SentinelGrid plan, infrastructure limits and subscription."
          icon={
            <CreditCard size={22} />
          }
          actions={
            <span
              className={[
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
                paymentIssue
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : subscriptionActive
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-surface-edge bg-surface text-surface-muted",
              ].join(" ")}
            >
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  paymentIssue
                    ? "bg-amber-400"
                    : subscriptionActive
                      ? "bg-emerald-400"
                      : "bg-zinc-500",
                ].join(" ")}
              />

              {paymentIssue
                ? "Payment issue"
                : subscriptionActive
                  ? "Subscription active"
                  : sub.status.replace(
                      /_/g,
                      " "
                    )}
            </span>
          }
        />

        {/* =====================================================
            ORGANIZATION SELECTOR
        ====================================================== */}

        {context.organizations.length >
          1 && (
          <nav
            aria-label="Organization billing"
            className="flex flex-wrap gap-3"
          >
            {context.organizations.map(
              (item) => (
                <Link
                  key={item.id}
                  href={`/dashboard/billing?organizationId=${item.id}`}
                  aria-current={
                    item.id ===
                    organization.id
                      ? "page"
                      : undefined
                  }
                  className={
                    item.id ===
                    organization.id
                      ? "sg-button sg-button-primary"
                      : "sg-button sg-button-secondary"
                  }
                >
                  {item.name}
                </Link>
              )
            )}
          </nav>
        )}

        {/* =====================================================
            PAYMENT ISSUE
        ====================================================== */}

        {paymentIssue && (
          <div
            role="alert"
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 text-sm text-amber-200"
          >
            <div className="font-medium">
              Payment issue
            </div>

            <p className="mt-1 text-amber-200/75">
              We couldn&apos;t process
              your latest subscription
              payment. Use Manage billing
              to review your payment
              details. Existing data has
              not been deleted.
            </p>
          </div>
        )}

        {/* =====================================================
            CURRENT PLAN
        ====================================================== */}

        <Surface className="overflow-hidden">
          <div className="grid lg:grid-cols-[0.9fr_1.35fr]">

            {/* LEFT */}

            <div className="flex flex-col justify-between border-b border-surface-edge p-6 lg:border-b-0 lg:border-r">
              <div>
                <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10 text-blue-400">
                  <Crown size={21} />
                </div>

                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-surface-muted">
                  Current plan
                </p>

                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                  {PLANS[plan].name}
                </h2>

                <div className="mt-2 flex items-end gap-1">
                  <span className="text-2xl font-semibold text-white">
                    {formatPlanPrice(
                      plan
                    )}
                  </span>

                  {plan !==
                    "enterprise" && (
                    <span className="pb-0.5 text-sm text-surface-muted">
                      / month
                    </span>
                  )}
                </div>

                <p className="mt-4 max-w-sm text-sm leading-6 text-surface-muted">
                  {
                    PLANS[plan]
                      .description
                  }
                </p>
              </div>

              <div className="mt-8 space-y-1 text-xs text-surface-muted">
                {sub.cancel_at_period_end &&
                  currentPeriodEnd && (
                    <p>
                      Subscription ends{" "}
                      <span className="text-white">
                        {
                          currentPeriodEnd
                        }
                      </span>
                    </p>
                  )}

                {!sub.cancel_at_period_end &&
                  sub.provider_subscription_id &&
                  currentPeriodEnd && (
                    <p>
                      Next renewal{" "}
                      <span className="text-white">
                        {
                          currentPeriodEnd
                        }
                      </span>
                    </p>
                  )}

                {sub.pending_plan &&
                  isPlanName(
                    sub.pending_plan
                  ) && (
                    <p className="text-amber-300">
                      Changes to{" "}
                      {
                        PLANS[
                          sub
                            .pending_plan
                        ].name
                      }
                      {pendingPlanDate
                        ? ` on ${pendingPlanDate}`
                        : ""}
                    </p>
                  )}
              </div>
            </div>

            {/* RIGHT */}

            <div className="p-6">
              <div>
                <h3 className="font-semibold text-white">
                  Plan usage
                </h3>

                <p className="mt-1 text-sm text-surface-muted">
                  Resources currently
                  assigned to your
                  organization.
                </p>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {RESOURCES.map(
                  (resource) => {
                    const current =
                      usage[resource];

                    const limit =
                      limits[resource];

                    const percentage =
                      usagePercentage(
                        current,
                        limit
                      );

                    const atLimit =
                      Number.isFinite(
                        limit
                      ) &&
                      current >=
                        limit;

                    return (
                      <div
                        key={
                          resource
                        }
                        className="rounded-xl border border-surface-edge bg-black/10 p-4"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2.5">
                            <span className="text-surface-muted">
                              {resourceIcon(
                                resource
                              )}
                            </span>

                            <span className="text-sm font-medium text-white">
                              {resourceLabel(
                                resource
                              )}
                            </span>
                          </div>

                          <span
                            className={[
                              "text-sm font-medium",
                              atLimit
                                ? "text-amber-300"
                                : "text-white",
                            ].join(
                              " "
                            )}
                          >
                            {current.toLocaleString(
                              "en-GB"
                            )}{" "}
                            /{" "}
                            {displayLimit(
                              limit
                            )}
                          </span>
                        </div>

                        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/5">
                          <div
                            className={[
                              "h-full rounded-full transition-[width]",
                              atLimit
                                ? "bg-amber-400"
                                : "bg-blue-500",
                            ].join(
                              " "
                            )}
                            style={{
                              width: `${percentage}%`,
                            }}
                          />
                        </div>

                        {atLimit && (
                          <p className="mt-2 text-xs text-amber-300">
                            Limit{" "}
                            {current >
                            limit
                              ? "exceeded"
                              : "reached"}
                            .
                          </p>
                        )}
                      </div>
                    );
                  }
                )}
              </div>

              {entitlements.pendingInvites >
                0 && (
                <p className="mt-4 text-xs text-surface-muted">
                  {
                    entitlements.pendingInvites
                  }{" "}
                  pending{" "}
                  {entitlements.pendingInvites ===
                  1
                    ? "invitation reserves"
                    : "invitations reserve"}{" "}
                  member{" "}
                  {entitlements.pendingInvites ===
                  1
                    ? "seat"
                    : "seats"}
                  . The owner counts
                  once.
                </p>
              )}
            </div>
          </div>
        </Surface>

        {/* =====================================================
            BILLING CONTROLS / AVAILABLE PLANS
        ====================================================== */}

        <BillingControls
          key={organization.id}
          organizationId={
            organization.id
          }
          plan={plan}
          owner={
            entitlements.role ===
            "owner"
          }
          hasSubscription={Boolean(
            sub.provider_subscription_id
          )}
          hasCustomer={Boolean(
            sub.provider_customer_id
          )}
          cancelAtPeriodEnd={
            sub.cancel_at_period_end
          }
          confirming={
            query.checkout ===
              "success" &&
            (!sub.provider_subscription_id ||
              sub.status ===
                "incomplete")
          }
          pendingPlan={
            sub.pending_plan
          }
        />
      </div>
    </div>
  );
}