import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import {
  Check,
  CreditCard,
  Crown,
  Gauge,
  Infinity as InfinityIcon,
  ShieldCheck,
  Sparkles,
  Users,
  Building2,
  Server,
  Activity,
  ArrowUpRight,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";

import {
  PLAN_LIMITS,
  PLAN_LABELS,
  PLAN_PRICES,
  type PlanName,
  type PlanResource,
} from "@/lib/plans";


// =========================================================
// TYPES
// =========================================================

type Subscription = {
  user_id: string;
  plan: PlanName;
  status: string;

  custom_price_monthly: number | null;

  custom_max_members: number | null;
  custom_max_clients: number | null;
  custom_max_devices: number | null;
  custom_max_monitors: number | null;

  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

type Usage = {
  members: number;
  clients: number;
  devices: number;
  monitors: number;
};


// =========================================================
// PLAN DISPLAY
// =========================================================

const PLAN_ORDER: PlanName[] = [
  "free",
  "pro",
  "business",
  "enterprise",
];

const PLAN_DESCRIPTIONS: Record<PlanName, string> = {
  free: "Explore SentinelGrid with the essentials.",

  pro: "For small teams managing growing infrastructure.",

  business:
    "Advanced monitoring for established IT operations.",

  enterprise:
    "Custom infrastructure, limits and support.",
};

const PLAN_FEATURES: Record<PlanName, string[]> = {
  free: [
    "1 team member",
    "3 clients",
    "10 devices",
    "10 monitors",
  ],

  pro: [
    "Up to 5 team members",
    "Up to 25 clients",
    "100 devices",
    "100 monitors",
  ],

  business: [
    "Up to 20 team members",
    "Unlimited clients",
    "500 devices",
    "500 monitors",
  ],

  enterprise: [
    "Custom team size",
    "Custom client limits",
    "Custom device limits",
    "Custom monitor limits",
    "Priority support",
  ],
};


// =========================================================
// HELPERS
// =========================================================

function formatPrice(
  plan: PlanName,
  customPrice?: number | null
) {
  if (plan === "enterprise") {
    if (
      customPrice !== null &&
      customPrice !== undefined
    ) {
      return `€${customPrice.toFixed(2)}`;
    }

    return "Custom";
  }

  const price = PLAN_PRICES[plan];

  if (price === 0) {
    return "Free";
  }

  return `€${price.toFixed(2)}`;
}


function getEffectiveLimit(
  plan: PlanName,
  resource: PlanResource,
  subscription: Subscription | null
) {
  if (plan !== "enterprise") {
    return PLAN_LIMITS[plan][resource];
  }

  const customLimits = {
    members: subscription?.custom_max_members,
    clients: subscription?.custom_max_clients,
    devices: subscription?.custom_max_devices,
    monitors: subscription?.custom_max_monitors,
  };

  const customLimit =
    customLimits[resource];

  if (
    customLimit === null ||
    customLimit === undefined
  ) {
    return Infinity;
  }

  return customLimit;
}


function getUsagePercentage(
  usage: number,
  limit: number
) {
  if (limit === Infinity) {
    return 100;
  }

  if (limit <= 0) {
    return 100;
  }

  return Math.min(
    (usage / limit) * 100,
    100
  );
}


// =========================================================
// USAGE ROW
// =========================================================

function UsageRow({
  label,
  usage,
  limit,
  icon: Icon,
}: {
  label: string;
  usage: number;
  limit: number;
  icon: React.ElementType;
}) {
  const percentage =
    getUsagePercentage(
      usage,
      limit
    );

  const atLimit =
    limit !== Infinity &&
    usage >= limit;

  return (
    <div
      className="
        group
        rounded-xl
        border
        border-transparent
        p-2
        transition-all
        duration-200
        hover:border-white/[0.06]
        hover:bg-[#17191f]
      "
    >
      <div className="space-y-2.5">

        <div className="
          flex
          items-center
          justify-between
          gap-4
        ">

          <div className="
            flex
            items-center
            gap-2.5
          ">

            <div
              className="
                flex
                h-8
                w-8
                items-center
                justify-center
                rounded-lg
                border
                border-white/[0.08]
                bg-[#1a1c22]
                transition-all
                duration-200
                group-hover:border-white/[0.14]
                group-hover:bg-[#202229]
              "
            >
              <Icon
                size={15}
                className="
                  text-zinc-400
                  transition-colors
                  group-hover:text-white
                "
              />
            </div>

            <span
              className="
                text-sm
                font-medium
                text-zinc-300
                transition-colors
                group-hover:text-white
              "
            >
              {label}
            </span>

          </div>


          <div className="
            flex
            items-center
            gap-1.5
            text-sm
          ">

            <span
              className={
                atLimit
                  ? "font-semibold text-red-400"
                  : "font-semibold text-white"
              }
            >
              {usage}
            </span>

            <span className="text-zinc-600">
              /
            </span>

            {limit === Infinity ? (

              <span className="
                flex
                items-center
                gap-1
                text-zinc-400
              ">
                <InfinityIcon size={14} />
                Unlimited
              </span>

            ) : (

              <span className="text-zinc-400">
                {limit}
              </span>

            )}

          </div>

        </div>


        <div
          className="
            h-1.5
            overflow-hidden
            rounded-full
            bg-[#22242a]
          "
        >
          <div
            className={`
              h-full
              rounded-full
              transition-all
              duration-500

              ${
                atLimit
                  ? "bg-red-400"
                  : "bg-zinc-300"
              }
            `}
            style={{
              width: `${percentage}%`,
            }}
          />
        </div>

      </div>
    </div>
  );
}


// =========================================================
// PAGE
// =========================================================

export default async function BillingPage() {
  await connection();

  const supabase =
    await createClient();


  // =======================================================
  // AUTH
  // =======================================================

  const {
    data: {
      user,
    },
  } =
    await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }


  // =======================================================
  // SUBSCRIPTION
  // =======================================================

  const {
    data: subscriptionData,
  } =
    await supabase
      .from("account_subscriptions")
      .select(`
        user_id,
        plan,
        status,
        custom_price_monthly,
        custom_max_members,
        custom_max_clients,
        custom_max_devices,
        custom_max_monitors,
        current_period_end,
        cancel_at_period_end
      `)
      .eq(
        "user_id",
        user.id
      )
      .maybeSingle();

  const subscription =
    subscriptionData as
      | Subscription
      | null;

  const currentPlan: PlanName =
    subscription?.plan ??
    "free";


  // =======================================================
  // ORGANIZATIONS
  // =======================================================

  const {
    data: organizations,
  } =
    await supabase
      .from("organizations")
      .select("id")
      .eq(
        "owner_id",
        user.id
      );

  const organizationIds =
    organizations?.map(
      organization =>
        organization.id
    ) ?? [];


  // =======================================================
  // MEMBERS
  // =======================================================

  let membersUsage = 1;

  if (organizationIds.length > 0) {
    const {
      data: members,
    } =
      await supabase
        .from(
          "organization_members"
        )
        .select("user_id")
        .in(
          "organization_id",
          organizationIds
        );

    const uniqueMembers =
      new Set<string>();

    uniqueMembers.add(user.id);

    members?.forEach(
      member => {
        if (member.user_id) {
          uniqueMembers.add(
            member.user_id
          );
        }
      }
    );

    membersUsage =
      uniqueMembers.size;
  }


  // =======================================================
  // CLIENTS
  // =======================================================

  let clients: {
    id: string;
  }[] = [];

  if (organizationIds.length > 0) {
    const {
      data,
    } =
      await supabase
        .from("clients")
        .select("id")
        .in(
          "organization_id",
          organizationIds
        );

    clients =
      data ?? [];
  }

  const clientIds =
    clients.map(
      client =>
        client.id
    );


  // =======================================================
  // DEVICES
  // =======================================================

  let devicesUsage = 0;

  if (clientIds.length > 0) {
    const {
      count,
    } =
      await supabase
        .from("devices")
        .select(
          "id",
          {
            count: "exact",
            head: true,
          }
        )
        .in(
          "client_id",
          clientIds
        );

    devicesUsage =
      count ?? 0;
  }


  // =======================================================
  // MONITORS
  // =======================================================

  const {
    count: monitorsCount,
  } =
    await supabase
      .from("monitors")
      .select(
        "id",
        {
          count: "exact",
          head: true,
        }
      )
      .eq(
        "user_id",
        user.id
      );


  // =======================================================
  // USAGE
  // =======================================================

  const usage: Usage = {
    members: membersUsage,
    clients: clients.length,
    devices: devicesUsage,
    monitors: monitorsCount ?? 0,
  };


  const memberLimit =
    getEffectiveLimit(
      currentPlan,
      "members",
      subscription
    );

  const clientLimit =
    getEffectiveLimit(
      currentPlan,
      "clients",
      subscription
    );

  const deviceLimit =
    getEffectiveLimit(
      currentPlan,
      "devices",
      subscription
    );

  const monitorLimit =
    getEffectiveLimit(
      currentPlan,
      "monitors",
      subscription
    );


  // =======================================================
  // RENDER
  // =======================================================

  return (
    <div
      className="
        mx-auto
        w-full
        max-w-[1500px]
        px-6
        py-8
        lg:px-10
      "
    >

      {/* ===============================================
          HEADER
      =============================================== */}

      <div
        className="
          mb-8
          flex
          flex-col
          gap-4
          md:flex-row
          md:items-end
          md:justify-between
        "
      >

        <div>

          <div
            className="
              mb-2
              flex
              items-center
              gap-2
              text-sm
              text-zinc-500
            "
          >
            <CreditCard size={15} />

            Account
          </div>


          <h1
            className="
              text-3xl
              font-semibold
              tracking-tight
              text-white
            "
          >
            Billing
          </h1>


          <p
            className="
              mt-2
              max-w-2xl
              text-sm
              leading-6
              text-zinc-500
            "
          >
            Manage your SentinelGrid plan,
            infrastructure limits and subscription.
          </p>

        </div>


        <div
          className="
            flex
            items-center
            gap-2
            rounded-full
            border
            border-emerald-500/20
            bg-[#10201c]
            px-3
            py-1.5
            text-xs
            font-medium
            text-emerald-400
          "
        >
          <ShieldCheck size={14} />

          {subscription?.status ===
          "trialing"
            ? "Trial"
            : subscription?.status ===
                "past_due"
              ? "Payment required"
              : "Subscription active"}

        </div>

      </div>



      {/* ===============================================
          CURRENT PLAN
      =============================================== */}

      <div
        className="
          group
          mb-10
          overflow-hidden
          rounded-2xl
          border
          border-white/[0.08]
          bg-[#111318]
          transition-all
          duration-300
          hover:border-white/[0.14]
          hover:shadow-2xl
          hover:shadow-black/20
        "
      >

        <div
          className="
            grid
            gap-8
            p-6
            lg:grid-cols-[0.8fr_1.2fr]
            lg:p-8
          "
        >

          {/* PLAN */}

          <div
            className="
              flex
              flex-col
              justify-between
              border-b
              border-white/[0.07]
              pb-8
              lg:border-b-0
              lg:border-r
              lg:pb-0
              lg:pr-8
            "
          >

            <div>

              <div
                className="
                  mb-5
                  flex
                  h-11
                  w-11
                  items-center
                  justify-center
                  rounded-xl
                  border
                  border-white/[0.08]
                  bg-[#1a1c22]
                  transition-all
                  duration-300
                  group-hover:border-white/[0.15]
                  group-hover:bg-[#202229]
                "
              >
                <Crown
                  size={20}
                  className="text-white"
                />
              </div>


              <p
                className="
                  text-xs
                  font-semibold
                  uppercase
                  tracking-[0.16em]
                  text-zinc-500
                "
              >
                Current plan
              </p>


              <div
                className="
                  mt-2
                  flex
                  flex-wrap
                  items-end
                  gap-3
                "
              >

                <h2
                  className="
                    text-4xl
                    font-semibold
                    tracking-tight
                    text-white
                  "
                >
                  {
                    PLAN_LABELS[
                      currentPlan
                    ]
                  }
                </h2>


                {currentPlan ===
                "business" && (

                  <span
                    className="
                      mb-1
                      rounded-full
                      border
                      border-white/[0.10]
                      bg-[#202229]
                      px-2.5
                      py-1
                      text-[11px]
                      font-medium
                      text-zinc-300
                    "
                  >
                    Most Popular
                  </span>

                )}

              </div>


              <div
                className="
                  mt-5
                  flex
                  items-end
                  gap-1
                "
              >

                <span
                  className="
                    text-2xl
                    font-semibold
                    text-white
                  "
                >
                  {formatPrice(
                    currentPlan,
                    subscription
                      ?.custom_price_monthly
                  )}
                </span>


                {currentPlan !==
                  "free" &&
                  !(
                    currentPlan ===
                      "enterprise" &&
                    !subscription
                      ?.custom_price_monthly
                  ) && (

                    <span
                      className="
                        pb-1
                        text-sm
                        text-zinc-500
                      "
                    >
                      / month
                    </span>

                  )}

              </div>


              <p
                className="
                  mt-3
                  max-w-sm
                  text-sm
                  leading-6
                  text-zinc-500
                "
              >
                {
                  PLAN_DESCRIPTIONS[
                    currentPlan
                  ]
                }
              </p>

            </div>


            {subscription
              ?.cancel_at_period_end && (

              <div
                className="
                  mt-6
                  rounded-xl
                  border
                  border-amber-500/20
                  bg-[#211b10]
                  p-3
                  text-xs
                  leading-5
                  text-amber-300
                "
              >
                Your subscription is
                scheduled to cancel at the
                end of the current billing
                period.
              </div>

            )}

          </div>



          {/* USAGE */}

          <div>

            <div className="mb-5">

              <div
                className="
                  flex
                  items-center
                  gap-2
                "
              >
                <Gauge
                  size={17}
                  className="text-zinc-400"
                />

                <h3
                  className="
                    text-sm
                    font-semibold
                    text-white
                  "
                >
                  Plan usage
                </h3>
              </div>


              <p
                className="
                  mt-1
                  text-xs
                  text-zinc-600
                "
              >
                Resources currently assigned
                to your account.
              </p>

            </div>


            <div
              className="
                grid
                gap-3
                sm:grid-cols-2
              "
            >

              <UsageRow
                label="Members"
                usage={usage.members}
                limit={memberLimit}
                icon={Users}
              />

              <UsageRow
                label="Clients"
                usage={usage.clients}
                limit={clientLimit}
                icon={Building2}
              />

              <UsageRow
                label="Devices"
                usage={usage.devices}
                limit={deviceLimit}
                icon={Server}
              />

              <UsageRow
                label="Monitors"
                usage={usage.monitors}
                limit={monitorLimit}
                icon={Activity}
              />

            </div>

          </div>

        </div>

      </div>



      {/* ===============================================
          AVAILABLE PLANS HEADER
      =============================================== */}

      <div className="mb-5">

        <div
          className="
            flex
            items-center
            gap-2
          "
        >
          <Sparkles
            size={17}
            className="text-zinc-400"
          />

          <h2
            className="
              text-lg
              font-semibold
              text-white
            "
          >
            Available plans
          </h2>
        </div>


        <p
          className="
            mt-1
            text-sm
            text-zinc-500
          "
        >
          Scale SentinelGrid as your
          infrastructure grows.
        </p>

      </div>



      {/* ===============================================
          PLAN CARDS
      =============================================== */}

      <div
        className="
          grid
          gap-4
          md:grid-cols-2
          xl:grid-cols-4
        "
      >

        {PLAN_ORDER.map(
          plan => {

            const isCurrent =
              plan === currentPlan;

            const price =
              PLAN_PRICES[plan];

            const isEnterprise =
              plan ===
              "enterprise";

            const isBusiness =
              plan ===
              "business";


            return (

              <div
                key={plan}
                className={`
                  group
                  relative
                  flex
                  min-h-[410px]
                  flex-col
                  overflow-hidden
                  rounded-2xl
                  border
                  p-6
                  transition-all
                  duration-300
                  hover:-translate-y-1
                  hover:shadow-2xl
                  hover:shadow-black/30

                  ${
                    isBusiness
                      ? `
                        border-white/[0.15]
                        bg-[#16181e]
                        hover:border-white/[0.25]
                        hover:bg-[#191b22]
                      `
                      : `
                        border-white/[0.08]
                        bg-[#111318]
                        hover:border-white/[0.16]
                        hover:bg-[#15171c]
                      `
                  }
                `}
              >

                {/* POPULAR */}

                {isBusiness && (

                  <div
                    className="
                      absolute
                      right-4
                      top-4
                      rounded-full
                      border
                      border-white/[0.10]
                      bg-[#24262d]
                      px-2.5
                      py-1
                      text-[10px]
                      font-semibold
                      uppercase
                      tracking-wider
                      text-zinc-300
                      transition
                      group-hover:border-white/[0.18]
                      group-hover:text-white
                    "
                  >
                    Popular
                  </div>

                )}


                {/* PLAN TITLE */}

                <div>

                  <p
                    className="
                      text-xs
                      font-semibold
                      uppercase
                      tracking-[0.14em]
                      text-zinc-500
                      transition-colors
                      group-hover:text-zinc-400
                    "
                  >
                    {
                      PLAN_LABELS[
                        plan
                      ]
                    }
                  </p>


                  <div
                    className="
                      mt-4
                      flex
                      items-end
                      gap-1
                    "
                  >

                    <span
                      className="
                        text-3xl
                        font-semibold
                        tracking-tight
                        text-white
                      "
                    >
                      {isEnterprise
                        ? "Custom"
                        : price === 0
                          ? "€0"
                          : `€${price?.toFixed(
                              2
                            )}`}
                    </span>


                    {!isEnterprise &&
                      price !== 0 && (

                      <span
                        className="
                          pb-1
                          text-sm
                          text-zinc-600
                        "
                      >
                        /mo
                      </span>

                    )}

                  </div>


                  <p
                    className="
                      mt-4
                      min-h-[48px]
                      text-sm
                      leading-6
                      text-zinc-500
                      transition-colors
                      group-hover:text-zinc-400
                    "
                  >
                    {
                      PLAN_DESCRIPTIONS[
                        plan
                      ]
                    }
                  </p>

                </div>


                {/* SEPARATOR */}

                <div
                  className="
                    my-6
                    h-px
                    bg-[#25272d]
                  "
                />


                {/* FEATURES */}

                <div
                  className="
                    flex-1
                    space-y-3
                  "
                >

                  {
                    PLAN_FEATURES[
                      plan
                    ].map(
                      feature => (

                        <div
                          key={
                            feature
                          }
                          className="
                            flex
                            items-start
                            gap-2.5
                            text-sm
                            text-zinc-400
                            transition-colors
                            duration-200
                            group-hover:text-zinc-300
                          "
                        >

                          <Check
                            size={15}
                            className="
                              mt-0.5
                              shrink-0
                              text-zinc-300
                            "
                          />

                          {feature}

                        </div>

                      )
                    )
                  }

                </div>


                {/* BUTTON */}

                <div className="mt-7">

                  {isCurrent ? (

                    <button
                      disabled
                      className="
                        flex
                        h-10
                        w-full
                        cursor-default
                        items-center
                        justify-center
                        rounded-lg
                        border
                        border-white/[0.08]
                        bg-[#1a1c22]
                        text-sm
                        font-medium
                        text-zinc-500
                      "
                    >
                      Current Plan
                    </button>

                  ) : isEnterprise ? (

                    <Link
                      href="/contact"
                      className="
                        flex
                        h-10
                        w-full
                        items-center
                        justify-center
                        gap-2
                        rounded-lg
                        border
                        border-white/[0.10]
                        bg-[#1b1d23]
                        text-sm
                        font-medium
                        text-white
                        transition-all
                        duration-200
                        hover:border-white/[0.20]
                        hover:bg-[#23252c]
                      "
                    >
                      Contact Sales

                      <ArrowUpRight
                        size={15}
                      />
                    </Link>

                  ) : (

                    <button
                      type="button"
                      className="
                        flex
                        h-10
                        w-full
                        items-center
                        justify-center
                        gap-2
                        rounded-lg
                        bg-white
                        text-sm
                        font-semibold
                        text-black
                        transition-all
                        duration-200
                        hover:-translate-y-0.5
                        hover:bg-zinc-200
                        hover:shadow-lg
                        hover:shadow-black/20
                        active:translate-y-0
                      "
                    >
                      {currentPlan ===
                      "free"
                        ? "Upgrade Plan"
                        : "Change Plan"}

                      <ArrowUpRight
                        size={15}
                      />
                    </button>

                  )}

                </div>

              </div>

            );

          }
        )}

      </div>



      {/* ===============================================
          FOOTNOTE
      =============================================== */}

      <div
        className="
          mt-6
          flex
          items-center
          gap-2
          text-xs
          text-zinc-600
        "
      >
        <CreditCard size={13} />

        Payments and subscription management
        will be securely processed through Stripe.
      </div>

    </div>
  );
}