import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  ArrowLeft,
  Globe,
  Activity,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";

export default async function MonitorDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const { id } = await params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: monitor } = await supabase
    .from("monitors")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!monitor) {
    notFound();
  }

  // CHECKS
  const { data: checks } = await supabase
    .from("monitor_checks")
    .select("*")
    .eq("monitor_id", monitor.id)
    .order("checked_at", { ascending: false })
    .limit(100);

  const totalChecks = checks?.length ?? 0;

  const onlineChecks =
    checks?.filter((check) => check.online).length ?? 0;

  const uptime =
    totalChecks > 0
      ? ((onlineChecks / totalChecks) * 100).toFixed(2)
      : null;

  const validResponseTimes =
    checks
      ?.map((check) => check.response_time_ms)
      .filter(
        (value): value is number =>
          typeof value === "number"
      ) ?? [];

  const averageResponse =
    validResponseTimes.length > 0
      ? Math.round(
          validResponseTimes.reduce(
            (sum, current) => sum + current,
            0
          ) / validResponseTimes.length
        )
      : null;

  /*
    Sparkline simples.
    Invertido porque queremos os checks
    antigos primeiro no gráfico.
  */
  const chartChecks = [...(checks ?? [])]
    .reverse()
    .filter(
      (check) =>
        typeof check.response_time_ms === "number"
    );

  const maxResponse =
    Math.max(
      ...chartChecks.map(
        (check) => check.response_time_ms ?? 0
      ),
      1
    );

  const chartPoints = chartChecks
    .map((check, index) => {
      const x =
        chartChecks.length === 1
          ? 50
          : (index / (chartChecks.length - 1)) * 100;

      const y =
        100 -
        ((check.response_time_ms ?? 0) /
          maxResponse) *
          80;

      return `${x},${y}`;
    })
    .join(" ");

  return (
    <main className="p-8">
      <div className="mx-auto max-w-7xl">

        {/* BACK */}
        <Link
          href="/dashboard/monitors"
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"
        >
          <ArrowLeft size={16} />
          Back to monitors
        </Link>

        {/* HEADER */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">

          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">
                {monitor.name}
              </h1>

              {monitor.status === "online" && (
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                  ● Online
                </span>
              )}

              {monitor.status === "offline" && (
                <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
                  ● Offline
                </span>
              )}

              {monitor.status === "unknown" && (
                <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-400">
                  ● Unknown
                </span>
              )}
            </div>

            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-2 text-zinc-500 transition hover:text-zinc-300"
            >
              <Globe size={15} />
              {monitor.url}
            </a>
          </div>

        </div>

        {/* STATS */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

          <StatCard
            icon={<Activity size={18} />}
            label="Current response"
            value={
              monitor.response_time_ms
                ? `${monitor.response_time_ms} ms`
                : "--"
            }
          />

          <StatCard
            icon={<Globe size={18} />}
            label="HTTP status"
            value={
              monitor.status_code
                ? String(monitor.status_code)
                : "--"
            }
          />

          <StatCard
            icon={<CheckCircle2 size={18} />}
            label="Uptime"
            value={
              uptime !== null
                ? `${uptime}%`
                : "--"
            }
          />

          <StatCard
            icon={<Clock size={18} />}
            label="Average response"
            value={
              averageResponse !== null
                ? `${averageResponse} ms`
                : "--"
            }
          />

        </div>

        {/* RESPONSE CHART */}
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">

          <div className="mb-6">
            <h2 className="font-semibold">
              Response time
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Last {chartChecks.length} checks
            </p>
          </div>

          {chartChecks.length > 1 ? (
            <div className="h-56 w-full overflow-hidden">
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="h-full w-full"
              >
                {/* Grid */}
                <line
                  x1="0"
                  y1="25"
                  x2="100"
                  y2="25"
                  stroke="currentColor"
                  className="text-zinc-800"
                  strokeWidth="0.3"
                />

                <line
                  x1="0"
                  y1="50"
                  x2="100"
                  y2="50"
                  stroke="currentColor"
                  className="text-zinc-800"
                  strokeWidth="0.3"
                />

                <line
                  x1="0"
                  y1="75"
                  x2="100"
                  y2="75"
                  stroke="currentColor"
                  className="text-zinc-800"
                  strokeWidth="0.3"
                />

                {/* Data */}
                <polyline
                  points={chartPoints}
                  fill="none"
                  stroke="currentColor"
                  className="text-blue-500"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          ) : (
            <div className="flex h-56 items-center justify-center text-sm text-zinc-600">
              More checks are required to display the chart.
            </div>
          )}

        </div>

        {/* HISTORY */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">

          <div className="border-b border-zinc-800 px-6 py-5">
            <h2 className="font-semibold">
              Check history
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Latest monitoring results.
            </p>
          </div>

          {!checks?.length ? (
            <div className="px-6 py-12 text-center text-zinc-500">
              No checks recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">

                <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-600">
                  <tr>
                    <th className="px-6 py-4">
                      Status
                    </th>

                    <th className="px-6 py-4">
                      HTTP
                    </th>

                    <th className="px-6 py-4">
                      Response
                    </th>

                    <th className="px-6 py-4">
                      Checked
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {checks.map((check) => (
                    <tr
                      key={check.id}
                      className="border-b border-zinc-800/70 last:border-0"
                    >

                      <td className="px-6 py-4">
                        {check.online ? (
                          <span className="inline-flex items-center gap-2 text-emerald-400">
                            <CheckCircle2 size={15} />
                            Online
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2 text-red-400">
                            <XCircle size={15} />
                            Offline
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4 text-zinc-300">
                        {check.status_code ?? "--"}
                      </td>

                      <td className="px-6 py-4 text-zinc-300">
                        {check.response_time_ms
                          ? `${check.response_time_ms} ms`
                          : "--"}
                      </td>

                      <td className="px-6 py-4 text-zinc-500">
                        {new Date(
                          check.checked_at
                        ).toLocaleString()}
                      </td>

                    </tr>
                  ))}
                </tbody>

              </table>
            </div>
          )}

        </div>

      </div>
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <p className="text-sm">
          {label}
        </p>
      </div>

      <p className="mt-4 text-3xl font-bold">
        {value}
      </p>

    </div>
  );
}