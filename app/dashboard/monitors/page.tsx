import { connection } from "next/server";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Globe2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { AddMonitorButton, type AddMonitorState } from "@/components/dashboard/add-monitor-button";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserMonitorCreationAccess } from "@/lib/resource-creation";
import { CompactSummary, EmptyState, PageHeader, SectionHeader, Surface } from "@/components/dashboard/dashboard-primitives";
import { FormSubmitButton } from "@/components/dashboard/form-submit-button";

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

function httpStatusLabel(statusCode: number | null) {
  return statusCode === null ? "No response" : `${statusCode} HTTP`;
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const monitorCreationAccess = await getUserMonitorCreationAccess(createAdminClient(), user.id);
  const monitorCreationReason = monitorCreationAccess.reason === "subscription_restricted" ? "Your subscription requires attention before new monitors can be created." : monitorCreationAccess.reason === "limit_reached" ? "Monitor limit reached. Upgrade your plan to add more monitors." : undefined;

  const { data: monitors } = await supabase
    .from("monitors")
    .select("*")
    .order("created_at", { ascending: false });

  async function addMonitor(_previousState: AddMonitorState, formData: FormData): Promise<AddMonitorState> {
    "use server";

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "You must be signed in." };

    const name = String(formData.get("name") ?? "").trim();
    const urlInput = String(formData.get("url") ?? "").trim();

    if (!name || !urlInput) return { error: "Monitor name and endpoint URL are required." };

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(urlInput);
    } catch {
      return { error: "Enter a valid endpoint URL." };
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return { error: "Only HTTP and HTTPS endpoints are supported." };

    const currentAccess = await getUserMonitorCreationAccess(createAdminClient(), user.id);
    if (!currentAccess.allowed) return { error: currentAccess.reason === "subscription_restricted" ? "Your subscription requires attention before new monitors can be created." : "Monitor limit reached. Upgrade your plan to add more monitors." };

    const { error } = await supabase.from("monitors").insert({ user_id: user.id, name, url: parsedUrl.toString() });
    if (error) { console.error("Monitor creation error:", error); return { error: "Could not create monitor." }; }
    revalidatePath("/dashboard/monitors");
    return { success: "Monitor created." };
  }

  async function checkMonitor(monitorId: string) {
    "use server";

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return ;

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
  const onlineCount = monitorList.filter((monitor) => getStatus(monitor.status) === "online").length;
  const offlineCount = monitorList.filter((monitor) => getStatus(monitor.status) === "offline").length;
  const responseTimes = monitorList
    .map((monitor) => monitor.response_time_ms)
    .filter((value): value is number => typeof value === "number");
  const averageResponse = responseTimes.length
    ? Math.round(responseTimes.reduce((total, value) => total + value, 0) / responseTimes.length)
    : null;

  return (
    <div className="sg-page-shell">
      <div className="sg-page">
        <PageHeader
          title="Monitors"
          eyebrow="Operations"
          icon={<Activity size={22} />}
          description="Keep an eye on websites, APIs and services from one operational view."
          actions={<AddMonitorButton action={addMonitor} disabled={!monitorCreationAccess.allowed} disabledReason={monitorCreationReason} />}
        />

        <CompactSummary
          label="Monitor summary"
          items={[
            { label: "Total monitors", value: monitorList.length, icon: <Globe2 size={14} /> },
            { label: "Online", value: onlineCount, icon: <CheckCircle2 size={14} />, tone: "success" },
            { label: "Offline", value: offlineCount, icon: <TriangleAlert size={14} />, tone: offlineCount ? "danger" : "neutral" },
            { label: "Avg. response", value: averageResponse === null ? "--" : `${averageResponse} ms`, icon: <Clock3 size={14} />, tone: averageResponse === null ? "neutral" : "info" },
          ]}
        />

        <Surface className="overflow-hidden" aria-labelledby="monitor-inventory-title">
          <SectionHeader
            title="Monitor inventory"
            description={`${monitorList.length} configured endpoint${monitorList.length === 1 ? "" : "s"}`}
            actions={<span className="sg-meta">Last recorded checks</span>}
          />
          {!monitorList.length ? (
            <EmptyState
              title="No monitors yet"
              description="Add your first endpoint to start monitoring it."
              icon={<Globe2 size={22} />}
              action={<AddMonitorButton action={addMonitor} variant="secondary" disabled={!monitorCreationAccess.allowed} disabledReason={monitorCreationReason} />}
            />
          ) : (
            <div className="divide-y divide-surface-edge">
              <div className="sg-table-heading hidden gap-4 px-5 py-3 lg:grid lg:grid-cols-[minmax(0,1.7fr)_0.8fr_0.7fr_1fr_auto]">
                <span>Endpoint</span><span>HTTP status</span><span>Response</span><span>Last check</span><span className="w-36 text-right">Actions</span>
              </div>
              {monitorList.map((monitor) => {
                const status = getStatus(monitor.status);
                const checkAction = checkMonitor.bind(null, monitor.id);
                const httpTone = status === "online" ? "success" : status === "offline" ? "danger" : "neutral";
                return (
                  <div key={monitor.id} className="sg-row grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.7fr)_0.8fr_0.7fr_1fr_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-medium text-white">{monitor.name}</h3>
                        <StatusBadge status={status}>{statusLabel(status)}</StatusBadge>
                      </div>
                      <p className="mt-1 truncate text-xs text-surface-muted" title={monitor.url}>{monitor.url}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 lg:block"><p className="sg-meta lg:hidden">HTTP status</p><StatusBadge status={httpStatusLabel(monitor.status_code)} tone={httpTone}>{httpStatusLabel(monitor.status_code)}</StatusBadge></div>
                    <div className="flex items-center justify-between gap-3 lg:block"><p className="sg-meta lg:hidden">Response</p><p className="text-sm tabular-nums text-zinc-300">{monitor.response_time_ms != null ? `${monitor.response_time_ms} ms` : "--"}</p></div>
                    <div className="flex items-center justify-between gap-3 lg:block"><p className="sg-meta lg:hidden">Last check</p><p className="text-xs text-surface-muted">{formatLastChecked(monitor.last_checked_at)}</p></div>
                    <div className="flex items-center gap-2 lg:w-36 lg:justify-end">
                      <Link href={`/dashboard/monitors/${monitor.id}`} aria-label={`Open ${monitor.name} details`} className="sg-button sg-button-secondary sg-button-sm">Details<ArrowUpRight size={14} /></Link>
                      <form action={checkAction}><FormSubmitButton aria-label={`Check ${monitor.name} now`} title="Check now" pendingLabel="" variant="secondary" size="icon"><RefreshCw size={15} /></FormSubmitButton></form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
