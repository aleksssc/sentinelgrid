import { connection } from "next/server";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Globe2,
  Plus,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";

type MonitorStatus = "online" | "offline" | "unknown";

function getStatus(status: unknown): MonitorStatus {
  if (status === "online" || status === "offline") return status;
  return "unknown";
}

function statusLabel(status: MonitorStatus) {
  if (status === "online") return "Online";
  if (status === "offline") return "Offline";
  return "Not checked";
}

function statusColor(status: MonitorStatus) {
  if (status === "online") return "text-emerald-400";
  if (status === "offline") return "text-red-400";
  return "text-zinc-400";
}

function formatLastChecked(value: string | null) {
  if (!value) return "Never checked";

  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MonitorsPage() {
  await connection();

  const supabase = await createClient();
  const { data: monitors } = await supabase
    .from("monitors")
    .select("*")
    .order("created_at", { ascending: false });

  async function addMonitor(formData: FormData) {
    "use server";

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const name = String(formData.get("name") ?? "").trim();
    const urlInput = String(formData.get("url") ?? "").trim();

    if (!name || !urlInput) return;

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(urlInput);
    } catch {
      return;
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return;
    }

    await supabase.from("monitors").insert({
      user_id: user.id,
      name,
      url: parsedUrl.toString(),
    });

    revalidatePath("/dashboard/monitors");
  }

  async function checkMonitor(monitorId: string) {
    "use server";

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data: monitor } = await supabase
      .from("monitors")
      .select("*")
      .eq("id", monitorId)
      .eq("user_id", user.id)
      .single();

    if (!monitor) return;

    let online = false;
    let statusCode: number | null = null;
    let responseTime: number | null = null;
    let errorMessage: string | null = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const start = performance.now();

    try {
      const response = await fetch(monitor.url, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });

      responseTime = Math.round(performance.now() - start);
      statusCode = response.status;
      online = response.ok;
    } catch (error) {
      responseTime = Math.round(performance.now() - start);
      errorMessage = error instanceof Error ? error.message : "Unknown connection error";
    } finally {
      clearTimeout(timeout);
    }

    await supabase.from("monitor_checks").insert({
      monitor_id: monitor.id,
      online,
      status_code: statusCode,
      response_time_ms: responseTime,
      error_message: errorMessage,
    });

    await supabase
      .from("monitors")
      .update({
        status: online ? "online" : "offline",
        status_code: statusCode,
        response_time_ms: responseTime,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", monitor.id);

    revalidatePath("/dashboard/monitors");
    revalidatePath("/dashboard");
  }

  const monitorList = monitors ?? [];
  const onlineCount = monitorList.filter(
    (monitor) => getStatus(monitor.status) === "online",
  ).length;
  const offlineCount = monitorList.filter(
    (monitor) => getStatus(monitor.status) === "offline",
  ).length;
  const responseTimes = monitorList
    .map((monitor) => monitor.response_time_ms)
    .filter((value): value is number => typeof value === "number");
  const averageResponse = responseTimes.length
    ? Math.round(responseTimes.reduce((total, value) => total + value, 0) / responseTimes.length)
    : null;

  return (
    <main className="p-6 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <section className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-400">
              <Activity size={14} />
              Operations
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Monitors</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
              Keep an eye on websites, APIs and services from one operational view.
            </p>
          </div>
          <a
            href="#add-monitor"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
          >
            <Plus size={17} />
            Add monitor
          </a>
        </section>

        <section className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={<Globe2 size={17} />} label="Total monitors" value={String(monitorList.length)} tone="neutral" />
          <MetricCard icon={<CheckCircle2 size={17} />} label="Online" value={String(onlineCount)} tone="green" />
          <MetricCard icon={<TriangleAlert size={17} />} label="Offline" value={String(offlineCount)} tone="red" />
          <MetricCard icon={<Clock3 size={17} />} label="Avg. response" value={averageResponse === null ? "--" : `${averageResponse} ms`} tone="blue" />
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0f12]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-6">
            <div>
              <h2 className="font-semibold text-white">All monitors</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {monitorList.length} configured endpoint{monitorList.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Live status overview
            </div>
          </div>

          {!monitorList.length ? (
            <div className="px-6 py-20 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#090a0c] text-zinc-500">
                <Globe2 size={21} />
              </div>
              <h3 className="mt-4 font-medium text-white">No monitors yet</h3>
              <p className="mt-2 text-sm text-zinc-500">Add your first endpoint below to start monitoring it.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.07]">
              {monitorList.map((monitor) => {
                const status = getStatus(monitor.status);
                const checkAction = checkMonitor.bind(null, monitor.id);

                return (
                  <div
                    key={monitor.id}
                    className="group grid gap-4 bg-[#0d0f12] px-5 py-5 transition hover:bg-[#14161a] sm:px-6 lg:grid-cols-[minmax(0,1.7fr)_0.7fr_0.7fr_1fr_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${status === "online" ? "bg-emerald-400" : status === "offline" ? "bg-red-400" : "bg-zinc-500"}`} />
                        <h3 className="truncate font-medium text-white">{monitor.name}</h3>
                        <span className={`hidden rounded-full border px-2 py-0.5 text-[11px] font-medium sm:inline-flex ${status === "online" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : status === "offline" ? "border-red-500/20 bg-red-500/10 text-red-400" : "border-white/[0.08] bg-white/[0.04] text-zinc-400"}`}>
                          {statusLabel(status)}
                        </span>
                      </div>
                      <p className="mt-1 truncate pl-5 text-xs text-zinc-500">{monitor.url}</p>
                    </div>

                    <div>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-600">Status</p>
                      <p className={`mt-1 text-sm font-medium sm:hidden ${statusColor(status)}`}>{statusLabel(status)}</p>
                      <p className="mt-1 hidden text-sm font-medium text-zinc-300 sm:block">{monitor.status_code ?? "--"} HTTP</p>
                    </div>

                    <div>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-600">Response</p>
                      <p className="mt-1 text-sm font-medium text-zinc-300">{monitor.response_time_ms ? `${monitor.response_time_ms} ms` : "--"}</p>
                    </div>

                    <div>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-600">Last check</p>
                      <p className="mt-1 text-sm text-zinc-400">{formatLastChecked(monitor.last_checked_at)}</p>
                    </div>

                    <div className="flex items-center gap-2 lg:justify-end">
                      <Link
                        href={`/dashboard/monitors/${monitor.id}`}
                        aria-label={`Open ${monitor.name} details`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 text-xs font-medium text-zinc-300 transition hover:border-white/[0.2] hover:bg-white/[0.05] hover:text-white"
                      >
                        Details
                        <ArrowUpRight size={14} />
                      </Link>
                      <form action={checkAction}>
                        <button
                          type="submit"
                          aria-label={`Check ${monitor.name} now`}
                          title="Check now"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] text-zinc-400 transition hover:border-white/[0.2] hover:bg-white/[0.05] hover:text-white"
                        >
                          <RefreshCw size={15} />
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section id="add-monitor" className="mt-6 rounded-2xl border border-dashed border-white/[0.12] bg-[#0d0f12] p-5 sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
              <Plus size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-white">Add a monitor</h2>
              <p className="mt-1 text-sm text-zinc-500">Create an HTTP or HTTPS endpoint to check manually.</p>
            </div>
          </div>
          <form action={addMonitor} className="grid gap-3 lg:grid-cols-[1fr_2fr_auto]">
            <input name="name" required placeholder="Monitor name" className="h-11 rounded-xl border border-white/[0.1] bg-[#090a0c] px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-500/50" />
            <input name="url" type="url" required placeholder="https://example.com" className="h-11 rounded-xl border border-white/[0.1] bg-[#090a0c] px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-500/50" />
            <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200">
              <Plus size={16} />
              Create monitor
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "neutral" | "green" | "red" | "blue";
}) {
  const toneClasses = {
    neutral: "border-white/[0.08] bg-white/[0.025] text-zinc-400",
    green: "border-emerald-500/15 bg-emerald-500/[0.04] text-emerald-400",
    red: "border-red-500/15 bg-red-500/[0.04] text-red-400",
    blue: "border-cyan-500/15 bg-cyan-500/[0.04] text-cyan-400",
  }[tone];

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0d0f12] p-4">
      <div className={`mb-4 flex h-8 w-8 items-center justify-center rounded-lg border ${toneClasses}`}>{icon}</div>
      <p className="text-xs uppercase tracking-[0.14em] text-zinc-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-white">{value}</p>
    </div>
  );
}
