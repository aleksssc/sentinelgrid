import Link from "next/link";

import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

import {
  Activity,
  ArrowUpRight,
  CircleCheck,
  Clock3,
  Gauge,
  Globe2,
  Plus,
  Server,
  TriangleAlert,
  WifiOff,
  Zap,
} from "lucide-react";

export default async function DashboardPage() {
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // =========================
  // MONITORS
  // =========================

  const { data: monitors, error } = await supabase
    .from("monitors")
    .select("*")
    .eq("user_id", user.id);

  if (error) {
    console.error("Dashboard monitors error:", error);
  }

  // =========================
  // STATS
  // =========================

  const total = monitors?.length ?? 0;

  const online =
    monitors?.filter(
      (monitor) => monitor.status === "online"
    ).length ?? 0;

  const offline =
    monitors?.filter(
      (monitor) => monitor.status === "offline"
    ).length ?? 0;

  const warnings =
    monitors?.filter(
      (monitor) => monitor.status === "warning"
    ).length ?? 0;

  const checkedMonitors =
    monitors?.filter(
      (monitor) =>
        monitor.status === "online" ||
        monitor.status === "offline"
    ) ?? [];

  // =========================
  // UPTIME
  // =========================

  const uptime =
    checkedMonitors.length > 0
      ? (
          (online / checkedMonitors.length) *
          100
        ).toFixed(2)
      : null;

  // =========================
  // RESPONSE TIME
  // =========================

  const responseTimes =
    monitors
      ?.map(
        (monitor) =>
          monitor.response_time_ms
      )
      .filter(
        (value): value is number =>
          typeof value === "number"
      ) ?? [];

  const averageResponse =
    responseTimes.length > 0
      ? Math.round(
          responseTimes.reduce(
            (total, current) =>
              total + current,
            0
          ) / responseTimes.length
        )
      : null;

  // =========================
  // CURRENT HEALTH
  // =========================

  const health =
    total === 0
      ? 0
      : Math.round(
          (online / total) * 100
        );

  return (
    <main className="relative min-h-full">
      <div className="mx-auto max-w-[1500px] px-7 py-7 lg:px-9 lg:py-8">

        {/* =========================
            HEADER
        ========================= */}

        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">

          <div>
            <div className="mb-2 flex items-center gap-2">

              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />

              <span className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                Infrastructure overview
              </span>

            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
              Dashboard
            </h1>

            <p className="mt-1.5 text-sm text-zinc-400">
              Monitor the health and availability of your infrastructure.
            </p>
          </div>


          <Link
            href="/dashboard/monitors"
            className="
              inline-flex h-9 items-center justify-center gap-2
              rounded-xl
              bg-white
              px-4

              text-sm font-medium
              text-zinc-950

              transition-all duration-200

              hover:bg-zinc-200
              active:scale-[0.98]
            "
          >
            <Plus size={15} />

            New monitor
          </Link>

        </div>


        {/* =========================
            INFRASTRUCTURE HEALTH
        ========================= */}

        <section
          className="
            mb-5 overflow-hidden
            rounded-2xl

            border border-white/[0.07]
            bg-[#111113]/75

            shadow-[0_12px_40px_rgba(0,0,0,0.18)]
            backdrop-blur-xl
          "
        >
          <div className="grid lg:grid-cols-[1.3fr_0.7fr]">

            {/* HEALTH */}

            <div className="border-b border-white/[0.06] p-6 lg:border-b-0 lg:border-r">

              <div className="flex items-start justify-between gap-5">

                <div>

                  <p className="text-xs font-medium uppercase tracking-[0.13em] text-zinc-500">
                    Infrastructure health
                  </p>

                  <div className="mt-4 flex items-end gap-3">

                    <span className="text-5xl font-semibold tracking-[-0.04em] text-white">
                      {health}%
                    </span>

                    <span className="mb-1.5 text-sm text-zinc-500">
                      operational
                    </span>

                  </div>

                </div>


                <div
                  className="
                    flex h-11 w-11 items-center justify-center
                    rounded-xl

                    border border-emerald-500/15
                    bg-emerald-500/[0.08]
                  "
                >
                  <Activity
                    size={20}
                    className="text-emerald-400"
                  />
                </div>

              </div>


              {/* HEALTH BAR */}

              <div className="mt-7">

                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">

                  <div
                    className="
                      h-full rounded-full
                      bg-emerald-400

                      transition-all duration-700
                    "
                    style={{
                      width: `${health}%`,
                    }}
                  />

                </div>


                <div className="mt-3 flex items-center justify-between gap-4">

                  <span className="text-xs text-zinc-500">
                    {online} of {total} monitors healthy
                  </span>


                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">

                    <CircleCheck size={13} />

                    Current status

                  </span>

                </div>

              </div>

            </div>


            {/* STATUS BREAKDOWN */}

            <div className="grid grid-cols-3 divide-x divide-white/[0.06]">

              {/* ONLINE */}

              <div className="flex flex-col justify-center px-5 py-6">

                <span className="mb-3 h-2 w-2 rounded-full bg-emerald-400" />

                <span className="text-2xl font-semibold tracking-tight text-white">
                  {online}
                </span>

                <span className="mt-1 text-xs text-zinc-500">
                  Online
                </span>

              </div>


              {/* WARNING */}

              <div className="flex flex-col justify-center px-5 py-6">

                <span className="mb-3 h-2 w-2 rounded-full bg-amber-400" />

                <span className="text-2xl font-semibold tracking-tight text-white">
                  {warnings}
                </span>

                <span className="mt-1 text-xs text-zinc-500">
                  Warning
                </span>

              </div>


              {/* OFFLINE */}

              <div className="flex flex-col justify-center px-5 py-6">

                <span className="mb-3 h-2 w-2 rounded-full bg-red-400" />

                <span className="text-2xl font-semibold tracking-tight text-white">
                  {offline}
                </span>

                <span className="mt-1 text-xs text-zinc-500">
                  Offline
                </span>

              </div>

            </div>

          </div>
        </section>


        {/* =========================
            METRICS
        ========================= */}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

          {/* TOTAL */}

          <div
            className="
              group rounded-2xl

              border border-white/[0.07]
              bg-[#111113]/70

              p-5

              backdrop-blur-xl

              transition-all duration-200

              hover:border-white/[0.11]
              hover:bg-[#151517]/80
            "
          >

            <div className="flex items-center justify-between">

              <div
                className="
                  flex h-9 w-9 items-center justify-center
                  rounded-xl

                  border border-white/[0.07]
                  bg-white/[0.035]
                "
              >
                <Server
                  size={17}
                  className="text-zinc-400"
                />
              </div>


              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-600">
                Total
              </span>

            </div>


            <p className="mt-5 text-3xl font-semibold tracking-tight text-white">
              {total}
            </p>

            <p className="mt-1 text-xs text-zinc-500">
              configured monitors
            </p>

          </div>


          {/* LATENCY */}

          <div
            className="
              group rounded-2xl

              border border-white/[0.07]
              bg-[#111113]/70

              p-5

              backdrop-blur-xl

              transition-all duration-200

              hover:border-white/[0.11]
              hover:bg-[#151517]/80
            "
          >

            <div className="flex items-center justify-between">

              <div
                className="
                  flex h-9 w-9 items-center justify-center
                  rounded-xl

                  border border-white/[0.07]
                  bg-white/[0.035]
                "
              >
                <Zap
                  size={17}
                  className="text-zinc-400"
                />
              </div>


              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-600">
                Latency
              </span>

            </div>


            <p className="mt-5 text-3xl font-semibold tracking-tight text-white">

              {averageResponse !== null
                ? averageResponse
                : "--"}

              {averageResponse !== null && (
                <span className="ml-1 text-sm font-normal text-zinc-500">
                  ms
                </span>
              )}

            </p>


            <p className="mt-1 text-xs text-zinc-500">
              average response
            </p>

          </div>


          {/* UPTIME */}

          <div
            className="
              group rounded-2xl

              border border-white/[0.07]
              bg-[#111113]/70

              p-5

              backdrop-blur-xl

              transition-all duration-200

              hover:border-white/[0.11]
              hover:bg-[#151517]/80
            "
          >

            <div className="flex items-center justify-between">

              <div
                className="
                  flex h-9 w-9 items-center justify-center
                  rounded-xl

                  border border-white/[0.07]
                  bg-white/[0.035]
                "
              >
                <Gauge
                  size={17}
                  className="text-zinc-400"
                />
              </div>


              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-600">
                Uptime
              </span>

            </div>


            <p className="mt-5 text-3xl font-semibold tracking-tight text-white">

              {uptime !== null
                ? uptime
                : "--"}

              {uptime !== null && (
                <span className="ml-0.5 text-sm font-normal text-zinc-500">
                  %
                </span>
              )}

            </p>


            <p className="mt-1 text-xs text-zinc-500">
              current availability
            </p>

          </div>


          {/* ISSUES */}

          <div
            className="
              group rounded-2xl

              border border-white/[0.07]
              bg-[#111113]/70

              p-5

              backdrop-blur-xl

              transition-all duration-200

              hover:border-white/[0.11]
              hover:bg-[#151517]/80
            "
          >

            <div className="flex items-center justify-between">

              <div
                className="
                  flex h-9 w-9 items-center justify-center
                  rounded-xl

                  border border-white/[0.07]
                  bg-white/[0.035]
                "
              >
                <TriangleAlert
                  size={17}
                  className={
                    offline + warnings > 0
                      ? "text-amber-400"
                      : "text-zinc-400"
                  }
                />
              </div>


              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-600">
                Issues
              </span>

            </div>


            <p className="mt-5 text-3xl font-semibold tracking-tight text-white">
              {offline + warnings}
            </p>


            <p className="mt-1 text-xs text-zinc-500">
              requiring attention
            </p>

          </div>

        </section>


        {/* =========================
            CONTENT GRID
        ========================= */}

        <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">

          {/* =========================
              MONITORS
          ========================= */}

          <div
            className="
              overflow-hidden rounded-2xl

              border border-white/[0.07]
              bg-[#111113]/70

              backdrop-blur-xl
            "
          >

            {/* HEADER */}

            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">

              <div>

                <h2 className="text-sm font-medium text-zinc-200">
                  Active monitors
                </h2>

                <p className="mt-1 text-xs text-zinc-500">
                  Current status of monitored services.
                </p>

              </div>


              <Link
                href="/dashboard/monitors"
                className="
                  flex items-center gap-1.5
                  text-xs font-medium text-zinc-500

                  transition-colors duration-200
                  hover:text-white
                "
              >
                View all

                <ArrowUpRight size={13} />
              </Link>

            </div>


            {/* EMPTY STATE */}

            {!monitors?.length ? (

              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">

                <div
                  className="
                    flex h-11 w-11 items-center justify-center
                    rounded-xl

                    border border-white/[0.07]
                    bg-white/[0.035]
                  "
                >
                  <Activity
                    size={19}
                    className="text-zinc-500"
                  />
                </div>


                <p className="mt-4 text-sm font-medium text-zinc-300">
                  No monitors configured
                </p>


                <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500">
                  Add your first monitor to start tracking availability
                  and response times.
                </p>


                <Link
                  href="/dashboard/monitors"
                  className="
                    mt-5 inline-flex h-8 items-center gap-1.5

                    rounded-lg
                    border border-white/[0.08]
                    bg-white/[0.04]

                    px-3

                    text-xs font-medium text-zinc-300

                    transition-all duration-200

                    hover:bg-white/[0.08]
                    hover:text-white
                  "
                >
                  <Plus size={13} />

                  Add monitor
                </Link>

              </div>

            ) : (

              <div>

                {monitors
                  .slice(0, 6)
                  .map(
                    (
                      monitor,
                      index
                    ) => {

                      const isOnline =
                        monitor.status ===
                        "online";

                      const isOffline =
                        monitor.status ===
                        "offline";

                      const isWarning =
                        monitor.status ===
                        "warning";

                      return (

                        <div
                          key={monitor.id}
                          className={`
                            group flex items-center gap-4
                            px-5 py-4

                            transition-colors duration-150

                            hover:bg-white/[0.025]

                            ${
                              index !==
                              Math.min(
                                monitors.length,
                                6
                              ) -
                                1
                                ? "border-b border-white/[0.05]"
                                : ""
                            }
                          `}
                        >

                          {/* STATUS ICON */}

                          <div
                            className={`
                              flex h-9 w-9 shrink-0
                              items-center justify-center

                              rounded-xl
                              border

                              ${
                                isOnline
                                  ? "border-emerald-500/15 bg-emerald-500/[0.07]"
                                  : isOffline
                                    ? "border-red-500/15 bg-red-500/[0.07]"
                                    : isWarning
                                      ? "border-amber-500/15 bg-amber-500/[0.07]"
                                      : "border-white/[0.07] bg-white/[0.035]"
                              }
                            `}
                          >

                            {isOffline ? (
                              <WifiOff
                                size={15}
                                className="text-red-400"
                              />
                            ) : (
                              <Globe2
                                size={15}
                                className={
                                  isOnline
                                    ? "text-emerald-400"
                                    : isWarning
                                      ? "text-amber-400"
                                      : "text-zinc-500"
                                }
                              />
                            )}

                          </div>


                          {/* MONITOR INFO */}

                          <div className="min-w-0 flex-1">

                            <p className="truncate text-sm font-medium text-zinc-200">
                              {monitor.name}
                            </p>

                            <p className="mt-0.5 truncate text-xs text-zinc-500">
                              {monitor.url}
                            </p>

                          </div>


                          {/* RESPONSE */}

                          <div className="hidden min-w-[90px] text-right sm:block">

                            <p className="text-xs font-medium text-zinc-400">

                              {typeof monitor.response_time_ms ===
                              "number"
                                ? `${monitor.response_time_ms} ms`
                                : "--"}

                            </p>

                            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-600">
                              response
                            </p>

                          </div>


                          {/* STATUS */}

                          <div className="flex min-w-[82px] justify-end">

                            <span
                              className={`
                                inline-flex items-center gap-1.5
                                rounded-full

                                px-2.5 py-1

                                text-[11px] font-medium

                                ${
                                  isOnline
                                    ? "bg-emerald-500/[0.09] text-emerald-400"
                                    : isOffline
                                      ? "bg-red-500/[0.09] text-red-400"
                                      : isWarning
                                        ? "bg-amber-500/[0.09] text-amber-400"
                                        : "bg-white/[0.05] text-zinc-500"
                                }
                              `}
                            >

                              <span
                                className={`
                                  h-1.5 w-1.5
                                  rounded-full

                                  ${
                                    isOnline
                                      ? "bg-emerald-400"
                                      : isOffline
                                        ? "bg-red-400"
                                        : isWarning
                                          ? "bg-amber-400"
                                          : "bg-zinc-500"
                                  }
                                `}
                              />


                              {isOnline
                                ? "Online"
                                : isOffline
                                  ? "Offline"
                                  : isWarning
                                    ? "Warning"
                                    : "Unknown"}

                            </span>

                          </div>

                        </div>

                      );
                    }
                  )}

              </div>

            )}

          </div>


          {/* =========================
              RIGHT COLUMN
          ========================= */}

          <div className="space-y-5">

            {/* =========================
                MONITOR SUMMARY
            ========================= */}

            <div
              className="
                rounded-2xl

                border border-white/[0.07]
                bg-[#111113]/70

                p-5

                backdrop-blur-xl
              "
            >

              <p className="text-sm font-medium text-zinc-200">
                Monitor summary
              </p>

              <p className="mt-1 text-xs text-zinc-500">
                Current monitor distribution.
              </p>


              <div className="mt-5 space-y-4">

                {/* ONLINE */}

                <div className="flex items-center justify-between">

                  <span className="flex items-center gap-2 text-xs text-zinc-400">

                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />

                    Online

                  </span>

                  <span className="text-xs font-medium text-zinc-300">
                    {online}
                  </span>

                </div>


                {/* WARNING */}

                <div className="flex items-center justify-between">

                  <span className="flex items-center gap-2 text-xs text-zinc-400">

                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />

                    Warning

                  </span>

                  <span className="text-xs font-medium text-zinc-300">
                    {warnings}
                  </span>

                </div>


                {/* OFFLINE */}

                <div className="flex items-center justify-between">

                  <span className="flex items-center gap-2 text-xs text-zinc-400">

                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" />

                    Offline

                  </span>

                  <span className="text-xs font-medium text-zinc-300">
                    {offline}
                  </span>

                </div>


                {/* TOTAL */}

                <div className="border-t border-white/[0.06] pt-4">

                  <div className="flex items-center justify-between">

                    <span className="text-xs text-zinc-500">
                      Total monitors
                    </span>

                    <span className="text-xs font-medium text-zinc-300">
                      {total}
                    </span>

                  </div>

                </div>

              </div>

            </div>


            {/* =========================
                QUICK ACTIONS
            ========================= */}

            <div
              className="
                rounded-2xl

                border border-white/[0.07]
                bg-[#111113]/70

                p-5

                backdrop-blur-xl
              "
            >

              <p className="text-sm font-medium text-zinc-200">
                Quick actions
              </p>


              <div className="mt-4 space-y-1">

                {/* CREATE MONITOR */}

                <Link
                  href="/dashboard/monitors"
                  className="
                    group flex items-center gap-3

                    rounded-xl

                    px-2.5 py-2.5

                    transition-colors duration-200

                    hover:bg-white/[0.04]
                  "
                >

                  <div
                    className="
                      flex h-8 w-8 items-center justify-center

                      rounded-lg

                      border border-white/[0.07]
                      bg-white/[0.035]
                    "
                  >
                    <Activity
                      size={14}
                      className="
                        text-zinc-500
                        transition-colors
                        group-hover:text-zinc-200
                      "
                    />
                  </div>


                  <div className="flex-1">

                    <p className="text-xs font-medium text-zinc-300">
                      Create monitor
                    </p>

                    <p className="text-[11px] text-zinc-600">
                      Track a new endpoint
                    </p>

                  </div>


                  <ArrowUpRight
                    size={13}
                    className="
                      text-zinc-600
                      transition-colors
                      group-hover:text-zinc-300
                    "
                  />

                </Link>


                {/* INCIDENTS */}

                <Link
                  href="/dashboard/incidents"
                  className="
                    group flex items-center gap-3

                    rounded-xl

                    px-2.5 py-2.5

                    transition-colors duration-200

                    hover:bg-white/[0.04]
                  "
                >

                  <div
                    className="
                      flex h-8 w-8 items-center justify-center

                      rounded-lg

                      border border-white/[0.07]
                      bg-white/[0.035]
                    "
                  >
                    <TriangleAlert
                      size={14}
                      className="
                        text-zinc-500
                        transition-colors
                        group-hover:text-zinc-200
                      "
                    />
                  </div>


                  <div className="flex-1">

                    <p className="text-xs font-medium text-zinc-300">
                      View incidents
                    </p>

                    <p className="text-[11px] text-zinc-600">
                      Investigate active issues
                    </p>

                  </div>


                  <ArrowUpRight
                    size={13}
                    className="
                      text-zinc-600
                      transition-colors
                      group-hover:text-zinc-300
                    "
                  />

                </Link>

              </div>

            </div>


            {/* =========================
                LIVE DATA
            ========================= */}

            <div className="flex items-center gap-2 px-2 text-[11px] text-zinc-600">

              <Clock3 size={12} />

              Infrastructure data from your monitors

            </div>

          </div>

        </section>

      </div>
    </main>
  );
}