import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: monitors, error } = await supabase
    .from("monitors")
    .select("*")
    .eq("user_id", user.id);

  if (error) {
    console.error("Dashboard monitors error:", error);
  }

  const total = monitors?.length ?? 0;

  const online =
    monitors?.filter((monitor) => monitor.status === "online").length ?? 0;

  const offline =
    monitors?.filter((monitor) => monitor.status === "offline").length ?? 0;

  const warnings =
    monitors?.filter((monitor) => monitor.status === "warning").length ?? 0;

  const checkedMonitors =
    monitors?.filter(
      (monitor) =>
        monitor.status === "online" ||
        monitor.status === "offline"
    ) ?? [];

  const uptime =
    checkedMonitors.length > 0
      ? (
          (online / checkedMonitors.length) *
          100
        ).toFixed(2)
      : null;

  const responseTimes =
    monitors
      ?.map((monitor) => monitor.response_time_ms)
      .filter(
        (value): value is number =>
          typeof value === "number"
      ) ?? [];

  const averageResponse =
    responseTimes.length > 0
      ? Math.round(
          responseTimes.reduce(
            (total, current) => total + current,
            0
          ) / responseTimes.length
        )
      : null;

  return (
    <main className="p-8">
      <div className="mx-auto max-w-7xl">

        {/* HEADER */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            Dashboard
          </h1>

          <p className="mt-2 text-zinc-400">
            Overview of your infrastructure.
          </p>
        </div>

        {/* STATS */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">

          {/* ONLINE */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-400">
                Online
              </p>

              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </div>

            <p className="mt-3 text-3xl font-bold">
              {online}
            </p>

            <p className="mt-2 text-xs text-zinc-600">
              of {total} monitors
            </p>
          </div>

          {/* WARNING */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-400">
                Warnings
              </p>

              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
            </div>

            <p className="mt-3 text-3xl font-bold">
              {warnings}
            </p>

            <p className="mt-2 text-xs text-zinc-600">
              requires attention
            </p>
          </div>

          {/* OFFLINE */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-400">
                Offline
              </p>

              <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            </div>

            <p className="mt-3 text-3xl font-bold">
              {offline}
            </p>

            <p className="mt-2 text-xs text-zinc-600">
              unavailable
            </p>
          </div>

          {/* RESPONSE */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-sm text-zinc-400">
              Avg. response
            </p>

            <p className="mt-3 text-3xl font-bold">
              {averageResponse !== null
                ? `${averageResponse} ms`
                : "--"}
            </p>

            <p className="mt-2 text-xs text-zinc-600">
              latest checks
            </p>
          </div>

          {/* UPTIME */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-sm text-zinc-400">
              Availability
            </p>

            <p className="mt-3 text-3xl font-bold">
              {uptime !== null
                ? `${uptime}%`
                : "--"}
            </p>

            <p className="mt-2 text-xs text-zinc-600">
              current status
            </p>
          </div>

        </div>

        {/* MONITORS OVERVIEW */}
        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900">

          <div className="border-b border-zinc-800 px-6 py-5">
            <h2 className="font-semibold">
              Monitor overview
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Current status of your monitored services.
            </p>
          </div>

          {!monitors?.length ? (
            <div className="px-6 py-12 text-center">
              <p className="text-zinc-400">
                No monitors configured.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {monitors.map((monitor) => (
                <div
                  key={monitor.id}
                  className="flex items-center justify-between gap-6 px-6 py-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {monitor.name}
                    </p>

                    <p className="mt-1 truncate text-sm text-zinc-500">
                      {monitor.url}
                    </p>
                  </div>

                  <div className="flex items-center gap-6">

                    <div className="hidden text-right sm:block">
                      <p className="text-sm">
                        {monitor.response_time_ms
                          ? `${monitor.response_time_ms} ms`
                          : "--"}
                      </p>

                      <p className="text-xs text-zinc-600">
                        response
                      </p>
                    </div>

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
                </div>
              ))}
            </div>
          )}

        </div>

      </div>
    </main>
  );
}