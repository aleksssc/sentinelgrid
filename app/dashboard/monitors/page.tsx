import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { PageHeader, SectionHeader, StatCard, Surface, EmptyState } from "@/components/dashboard/dashboard-primitives";
import { FormSubmitButton } from "@/components/dashboard/form-submit-button";
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
    <div className="sg-page">
      <PageHeader title="Monitors" eyebrow="Operations" icon={<Activity size={22} />}
        description="Keep an eye on websites, APIs and services from one operational view."
        actions={<a href="#add-monitor" className="sg-button sg-button-primary"><Plus size={16} />Add monitor</a>} />
      <section aria-label="Monitor summary" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Globe2 size={16} />} label="Total monitors" value={monitorList.length} />
        <StatCard icon={<CheckCircle2 size={16} />} label="Online" value={onlineCount} tone="success" />
        <StatCard icon={<TriangleAlert size={16} />} label="Offline" value={offlineCount} tone="danger" />
        <StatCard icon={<Clock3 size={16} />} label="Avg. response" value={averageResponse === null ? "--" : `${averageResponse} ms`} tone="info" />
      </section>
      <Surface className="overflow-hidden">
        <SectionHeader title="All monitors" description={`${monitorList.length} configured endpoint${monitorList.length === 1 ? "" : "s"}`}
          actions={<span className="sg-meta">Last recorded checks</span>} />
        {!monitorList.length ? <EmptyState title="No monitors yet" description="Add your first endpoint to start monitoring it." icon={<Globe2 size={22} />}
          action={<a href="#add-monitor" className="sg-button sg-button-secondary"><Plus size={15} />Add monitor</a>} /> : (
          <div className="divide-y divide-surface-edge">
            <div className="sg-table-heading hidden gap-4 px-5 py-3 lg:grid lg:grid-cols-[minmax(0,1.7fr)_0.7fr_0.7fr_1fr_auto]">
              <span>Endpoint</span><span>HTTP status</span><span>Response</span><span>Last check</span><span className="w-36 text-right">Actions</span>
            </div>
            {monitorList.map((monitor) => {
              const status = getStatus(monitor.status);
              const checkAction = checkMonitor.bind(null, monitor.id);
              return (
                <div key={monitor.id} className="sg-row grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.7fr)_0.7fr_0.7fr_1fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-medium text-white">{monitor.name}</h3>
                      <StatusBadge status={status}>{statusLabel(status)}</StatusBadge>
                    </div>
                    <p className="mt-1 truncate text-xs text-surface-muted">{monitor.url}</p>
                  </div>
                  <div><p className="sg-meta lg:hidden">HTTP status</p><p className={`text-sm ${statusColor(status)}`}>{monitor.status_code ?? "--"} HTTP</p></div>
                  <div><p className="sg-meta lg:hidden">Response</p><p className="text-sm tabular-nums text-zinc-300">{monitor.response_time_ms != null ? `${monitor.response_time_ms} ms` : "--"}</p></div>
                  <div><p className="sg-meta lg:hidden">Last check</p><p className="text-xs text-surface-muted">{formatLastChecked(monitor.last_checked_at)}</p></div>
                  <div className="flex w-36 items-center gap-2 lg:justify-end">
                    <Link href={`/dashboard/monitors/${monitor.id}`} aria-label={`Open ${monitor.name} details`} className="sg-button sg-button-secondary sg-button-sm">Details<ArrowUpRight size={14} /></Link>
                    <form action={checkAction}><FormSubmitButton aria-label={`Check ${monitor.name} now`} title="Check now" pendingLabel="" variant="secondary" size="icon"><RefreshCw size={15} /></FormSubmitButton></form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Surface>
      <Surface id="add-monitor" className="sg-settings-section mt-6 overflow-hidden">
        <SectionHeader title="Add a monitor" description="Create an HTTP or HTTPS endpoint to check manually." icon={<Plus size={17} />} />
        <form action={addMonitor} className="grid items-end gap-4 p-5 lg:grid-cols-[1fr_2fr_auto]">
          <div><label htmlFor="monitor-name" className="mb-2 block text-sm font-medium text-zinc-300">Monitor name</label><input id="monitor-name" name="name" required placeholder="Production API" className="sg-control w-full px-3 py-2.5" /></div>
          <div><label htmlFor="monitor-url" className="mb-2 block text-sm font-medium text-zinc-300">Endpoint URL</label><input id="monitor-url" name="url" type="url" required placeholder="https://example.com" className="sg-control w-full px-3 py-2.5" /></div>
          <FormSubmitButton pendingLabel="Creating..."><Plus size={16} />Create monitor</FormSubmitButton>
        </form>
      </Surface>
    </div>
  );
}
