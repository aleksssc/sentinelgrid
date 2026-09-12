"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, AlertCircle, Check, ChevronDown, Clock3, Database, Download,
  Lock, Monitor, Network, Power, RefreshCw, RotateCcw, Search, Terminal, X,
} from "lucide-react";

import {
  activityDay, filterDeviceActivity, humanizeActivity, normalizeDeviceActivity,
  type ActivityEntry, type ActivityFilter, type ActivityIcon, type ActivityStatus,
  type DeviceActivity, type DeviceActivityCommand,
} from "@/lib/activity/device-activity";

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "commands", label: "Commands" },
  { value: "updates", label: "Updates" }, { value: "remote", label: "Remote" },
  { value: "system", label: "System" }, { value: "failed", label: "Failed" },
];
const ICONS = {
  update: Download, restart: RotateCcw, shutdown: Power, lock: Lock,
  terminal: Terminal, inventory: Database, network: Network, remote: Monitor, system: Activity,
} satisfies Record<ActivityIcon, typeof Activity>;
const STATUS = {
  succeeded: { label: "Succeeded", color: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400", icon: Check },
  failed: { label: "Failed", color: "border-red-500/20 bg-red-500/10 text-red-400", icon: AlertCircle },
  running: { label: "Running", color: "border-amber-500/20 bg-amber-500/10 text-amber-400", icon: Clock3 },
  requested: { label: "Requested", color: "border-sky-500/20 bg-sky-500/10 text-sky-400", icon: Clock3 },
  queued: { label: "Queued", color: "border-zinc-700 bg-zinc-800/60 text-zinc-400", icon: Clock3 },
  warning: { label: "Warning", color: "border-amber-500/20 bg-amber-500/10 text-amber-400", icon: AlertCircle },
  info: { label: "Recorded", color: "border-zinc-700 bg-zinc-800/60 text-zinc-400", icon: Activity },
} satisfies Record<ActivityStatus, { label: string; color: string; icon: typeof Activity }>;

function timestamp(value: string, full = false): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time not recorded";
  return full ? date.toLocaleString() : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function ActivityTime({ value, full = false }: { value: string; full?: boolean }) {
  return <time dateTime={Number.isFinite(Date.parse(value)) ? value : undefined} title={timestamp(value, true)}>{timestamp(value, full)}</time>;
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const Icon = ICONS[entry.icon];
  const status = STATUS[entry.status];
  const StatusIcon = status.icon;
  const crossesDay = entry.requestedAt && entry.completedAt &&
    new Date(entry.requestedAt).toDateString() !== new Date(entry.completedAt).toDateString();
  const details: [string, string | undefined][] = [
    ["Requested by", entry.requestedBy],
    ["Command type", entry.commandType],
    ["State", humanizeActivity(entry.phase)],
    ["Requested", entry.requestedAt ? timestamp(entry.requestedAt, true) : undefined],
    ["Started", entry.startedAt ? timestamp(entry.startedAt, true) : undefined],
    ["Completed", entry.completedAt ? timestamp(entry.completedAt, true) : undefined],
    ["Duration (request to completion)", entry.duration],
    ["Previous Agent version", entry.fromVersion],
    ["Target Agent version", entry.targetVersion],
    ["Command ID", entry.commandId],
    ["Transaction ID", entry.transactionId],
    ["Error code", entry.errorCode],
    ["Error message", entry.errorMessage],
  ];

  return (
    <li className="relative pl-11 sm:pl-12">
      <span className={`absolute left-0 top-4 flex h-8 w-8 items-center justify-center rounded-xl border bg-[#0d0f12] ${entry.status === "failed" ? "border-red-500/25 text-red-400" : "border-zinc-800 text-zinc-400"}`}>
        <Icon size={15} aria-hidden="true" />
      </span>
      <details className="group rounded-xl border border-zinc-800/80 bg-zinc-900/20 transition-colors open:border-zinc-700 open:bg-zinc-900/40 hover:border-zinc-700">
        <summary className="cursor-pointer list-none rounded-xl p-3 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 sm:p-4 [&::-webkit-details-marker]:hidden">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1 basis-40">
              <h4 className="break-words text-sm font-medium text-zinc-100">{entry.title}</h4>
              {entry.category === "updates" && (entry.fromVersion || entry.targetVersion) && (
                <p className="mt-1 break-words font-mono text-xs text-zinc-400">
                  {entry.fromVersion && entry.targetVersion ? <>{entry.fromVersion} <span className="px-1 text-zinc-600">&rarr;</span> {entry.targetVersion}</> :
                    entry.targetVersion ? `Target ${entry.targetVersion}` : `From ${entry.fromVersion}`}
                </p>
              )}
              <p className={`mt-1 break-words text-xs ${entry.status === "failed" ? "text-red-400/90" : "text-zinc-400"}`}>{entry.summary}</p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${status.color}`}>
                <StatusIcon size={12} aria-hidden="true" />{status.label}
              </span>
              <ChevronDown size={14} aria-hidden="true" className="text-zinc-500 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-relaxed text-zinc-500">
            {entry.requestedAt ? (
              <>
                <span>Requested <ActivityTime value={entry.requestedAt} full={Boolean(crossesDay)} /></span>
                {entry.completedAt && <><span aria-hidden="true">&rarr;</span><span>Completed <ActivityTime value={entry.completedAt} full={Boolean(crossesDay)} /></span></>}
              </>
            ) : <ActivityTime value={entry.timestamp} full />}
            {entry.requestedBy && <span className="min-w-0 break-all">&middot; by {entry.requestedBy}</span>}
          </div>
        </summary>
        <div className="border-t border-zinc-800/80 p-3 sm:p-4">
          <h5 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Activity details</h5>
          <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
            {details.filter(([, value]) => value !== undefined).map(([label, value]) => (
              <div key={label} className={label === "Error message" ? "min-w-0 sm:col-span-2" : "min-w-0"}>
                <dt className="text-[11px] text-zinc-500">{label}</dt>
                <dd className={`mt-1 whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere] ${label.startsWith("Error") ? "text-red-300" : "text-zinc-300"} ${label.endsWith("ID") || label === "Command type" ? "font-mono" : ""}`}>{value}</dd>
              </div>
            ))}
          </dl>
          {entry.events.length > 0 && (
            <div className="mt-4 border-t border-zinc-800/80 pt-3">
              <h5 className="text-[11px] font-medium text-zinc-500">Audit trail &middot; {entry.events.length} {entry.events.length === 1 ? "event" : "events"}</h5>
              <ol className="mt-2 space-y-2">
                {entry.events.map((event) => (
                  <li key={event.id} className="flex min-w-0 flex-col gap-1 text-[11px] sm:flex-row sm:flex-wrap sm:justify-between sm:gap-3">
                    <code className="break-all text-zinc-400">{event.action}</code>
                    <span className="text-zinc-500"><ActivityTime value={event.created_at} full /> &middot; {event.status ?? "Recorded"}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

export default function DeviceActivityTimeline({ deviceId, events, commands, error, now }: {
  deviceId: string;
  events: DeviceActivity[];
  commands: DeviceActivityCommand[];
  error?: string;
  now: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [query, setQuery] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const entries = useMemo(() => normalizeDeviceActivity(events, commands, deviceId), [events, commands, deviceId]);
  const filtered = useMemo(() => filterDeviceActivity(entries, filter, query), [entries, filter, query]);
  const groups = (["Today", "Yesterday", "Older"] as const).map((label) => ({
    label, entries: filtered.filter((entry) => activityDay(entry.timestamp, new Date(now)) === label),
  }));

  return (
    <section aria-label="Device activity" className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d0f12]">
      <div className="space-y-4 border-b border-zinc-800 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Activity timeline</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">Recent device events, grouped by command. Refreshes every 30 seconds.</p>
          </div>
          <button type="button" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing} aria-label="Refresh activity" title="Refresh activity"
            className="shrink-0 rounded-lg border border-zinc-800 p-2 text-zinc-400 transition hover:border-zinc-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50">
            <RefreshCw size={14} aria-hidden="true" className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} />
          </button>
        </div>
        {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300"><AlertCircle size={14} className="shrink-0" aria-hidden="true" />{error} Use Refresh to retry.</p>}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-1">
            {FILTERS.map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${filter === value ? "border-zinc-700 bg-zinc-800 text-white" : "border-transparent text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="relative w-full xl:w-56">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 text-zinc-600" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search activity" placeholder="Search activity..."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950/50 py-2 pl-9 pr-8 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 [&::-webkit-search-cancel-button]:appearance-none" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-2 rounded text-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"><X size={16} aria-hidden="true" /></button>}
          </div>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        <p role="status" className="mb-4 text-[11px] text-zinc-500">{filtered.length} {filtered.length === 1 ? "activity" : "activities"}{filter !== "all" || query.trim() ? ` of ${entries.length}` : ""} &middot; Newest first</p>
        {filtered.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <Activity size={22} className="mx-auto mb-3 text-zinc-600" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-300">{entries.length ? "No matching activity" : error ? "Activity is unavailable" : "No device activity yet"}</p>
            <p className="mt-2 text-xs text-zinc-500">{entries.length ? "Try another filter or search term." : error ? "Refresh to try loading the recent activity again." : "Commands, updates and system events will appear here."}</p>
            {(filter !== "all" || query) && <button type="button" onClick={() => { setFilter("all"); setQuery(""); }} className="mt-4 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">Clear filters</button>}
          </div>
        ) : groups.filter((group) => group.entries.length > 0).map((group) => (
          <section key={group.label} aria-label={group.label} className="mb-6 last:mb-0">
            <h4 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{group.label}</h4>
            <ol className="relative space-y-3 before:absolute before:bottom-5 before:left-4 before:top-5 before:w-px before:bg-zinc-800/80">
              {group.entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
