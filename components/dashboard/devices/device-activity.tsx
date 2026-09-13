"use client";

import { StatusBadge, type StatusTone } from "@/components/dashboard/dashboard-badges";
import { AnimatedSelection } from "@/components/dashboard/animated-selection";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, AlertCircle, ChevronDown, Database, Download,
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
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  running: { label: "Running", tone: "warning" },
  requested: { label: "Requested", tone: "info" },
  queued: { label: "Queued", tone: "neutral" },
  warning: { label: "Warning", tone: "warning" },
  info: { label: "Recorded", tone: "neutral" },
} satisfies Record<ActivityStatus, { label: string; tone: StatusTone }>;

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
    ["Exit code", entry.exitCode?.toString()],
    ["Standard output", entry.stdout],
    ["Standard error", entry.stderr],
  ];

  return (
    <li className="relative pl-11 sm:pl-12">
      <span className={`absolute left-0 top-4 flex h-8 w-8 items-center justify-center rounded-xl border bg-surface ${entry.status === "failed" ? "border-red-500/25 text-red-400" : "border-zinc-800 text-zinc-400"}`}>
        <Icon size={15} aria-hidden="true" />
      </span>
      <details className="group rounded-xl border border-surface-edge bg-surface transition-colors open:border-zinc-700 open:bg-surface-raised hover:border-surface-accent-edge">
        <summary className="cursor-pointer list-none rounded-xl p-3 outline-none focus-visible:ring-2 focus-visible:ring-surface-focus sm:p-4 [&::-webkit-details-marker]:hidden">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1 basis-40">
              <h4 className="break-words text-sm font-medium text-zinc-100">{entry.title}</h4>
              {entry.category === "updates" && (entry.fromVersion || entry.targetVersion) && (
                <p className="mt-1 break-words font-mono text-xs text-zinc-400">
                  {entry.fromVersion && entry.targetVersion ? <>{entry.fromVersion} <span className="px-1 text-surface-muted">&rarr;</span> {entry.targetVersion}</> :
                    entry.targetVersion ? `${entry.status === "succeeded" ? "Updated to" : "Target"} ${entry.targetVersion}` : `From ${entry.fromVersion}`}
                </p>
              )}
              <p className={`mt-1 break-words text-xs ${entry.status === "failed" ? "text-red-400/90" : "text-zinc-400"}`}>{entry.summary}</p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <StatusBadge status={entry.status} tone={status.tone}>{status.label}</StatusBadge>
              <ChevronDown size={14} aria-hidden="true" className="text-surface-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-relaxed text-surface-muted">
            {entry.requestedAt ? (
              <>
                <span>Requested <ActivityTime value={entry.requestedAt} full={Boolean(crossesDay)} /></span>
                {entry.completedAt && <><span aria-hidden="true">&rarr;</span><span>Completed <ActivityTime value={entry.completedAt} full={Boolean(crossesDay)} /></span></>}
              </>
            ) : <ActivityTime value={entry.timestamp} full />}
            {entry.requestedBy && <span className="min-w-0 break-all">&middot; by {entry.requestedBy}</span>}
          </div>
        </summary>
        <div className="border-t border-surface-edge p-3 sm:p-4">
          <h5 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-surface-muted">Activity details</h5>
          <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
            {details.filter(([, value]) => value !== undefined).map(([label, value]) => (
              <div key={label} className={label === "Error message" ? "min-w-0 sm:col-span-2" : "min-w-0"}>
                <dt className="text-[11px] text-surface-muted">{label}</dt>
                <dd className={`mt-1 whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere] ${label.startsWith("Error") ? "text-red-300" : "text-zinc-300"} ${label.endsWith("ID") || label === "Command type" ? "font-mono" : ""}`}>{value}</dd>
              </div>
            ))}
          </dl>
          {entry.events.length > 0 && (
            <div className="mt-4 border-t border-surface-edge pt-3">
              <h5 className="text-[11px] font-medium text-surface-muted">Audit trail &middot; {entry.events.length} {entry.events.length === 1 ? "event" : "events"}</h5>
              <ol className="mt-2 space-y-2">
                {entry.events.map((event) => (
                  <li key={event.id} className="flex min-w-0 flex-col gap-1 text-[11px] sm:flex-row sm:flex-wrap sm:justify-between sm:gap-3">
                    <code className="break-all text-zinc-400">{event.action}</code>
                    <span className="text-surface-muted"><ActivityTime value={event.created_at} full /> &middot; {event.status ?? "Recorded"}</span>
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
    <section aria-label="Device activity" className="sg-surface mt-6 overflow-hidden">
      <div className="space-y-4 border-b border-surface-edge p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Activity timeline</h3>
            <p className="mt-1 text-xs leading-relaxed text-surface-muted">Recent device events, grouped by command. Refreshes every 30 seconds.</p>
          </div>
          <button type="button" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing} aria-label="Refresh activity" title="Refresh activity"
            className="sg-button sg-button-secondary shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-focus disabled:opacity-50">
            <RefreshCw size={14} aria-hidden="true" className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} />
          </button>
        </div>
        {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300"><AlertCircle size={14} className="shrink-0" aria-hidden="true" />{error} Use Refresh to retry.</p>}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <AnimatedSelection value={filter} role="group" aria-label="Filter activity" className="sg-segments">
            {FILTERS.map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
                className="sg-segment">
                {label}
              </button>
            ))}
          </AnimatedSelection>
          <div className="relative w-full xl:w-56">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-muted" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search activity" placeholder="Search activity..."
              className="sg-control w-full py-2 pl-9 pr-8 [&::-webkit-search-cancel-button]:appearance-none" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-surface-muted hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-focus"><X size={16} aria-hidden="true" /></button>}
          </div>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        <p role="status" className="mb-4 text-[11px] text-surface-muted">{filtered.length} {filtered.length === 1 ? "activity" : "activities"}{filter !== "all" || query.trim() ? ` of ${entries.length}` : ""} &middot; Newest first</p>
        {filtered.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <Activity size={22} className="mx-auto mb-3 text-surface-muted" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-300">{entries.length ? "No matching activity" : error ? "Activity is unavailable" : "No device activity yet"}</p>
            <p className="mt-2 text-xs text-surface-muted">{entries.length ? "Try another filter or search term." : error ? "Refresh to try loading the recent activity again." : "Commands, updates and system events will appear here."}</p>
            {(filter !== "all" || query) && <button type="button" onClick={() => { setFilter("all"); setQuery(""); }} className="sg-button sg-button-secondary sg-button-sm mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-focus">Clear filters</button>}
          </div>
        ) : groups.filter((group) => group.entries.length > 0).map((group) => (
          <section key={group.label} aria-label={group.label} className="mb-6 last:mb-0">
            <h4 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-surface-muted">{group.label}</h4>
            <ol className="relative space-y-3 before:absolute before:bottom-5 before:left-4 before:top-5 before:w-px before:bg-zinc-800/80">
              {group.entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
