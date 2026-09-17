import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { AnimatedSelection } from "@/components/dashboard/animated-selection";
import Link from "next/link";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, Building2, ChevronDown, ChevronLeft, ChevronRight,
  Clock3, Info, Search, ShieldCheck, TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MAX_PAGE, PAGE_SIZE, formatOperationsTime, operationsHref,
  type OperationsFilters, type OperationsKind, type OperationsResult, type OperationRow,
} from "@/lib/operations/filters";
import OperationsRefresh from "./operations-refresh";
import OperationsFilterBar from "./operations-filters";

const toneClasses = {
  error: "border-red-500/20 bg-red-500/[0.08] text-red-400",
  warning: "border-amber-500/20 bg-amber-500/[0.08] text-amber-400",
  info: "border-sky-500/20 bg-sky-500/[0.08] text-sky-400",
};

export default function OperationsView({ kind, organizationName, filters, result, now }: {
  kind: OperationsKind; organizationName: string; filters: OperationsFilters; result: OperationsResult; now: number;
}) {
  const incidents = kind === "incidents";
  const monitorSource = filters.source === "monitors";
  const title = incidents ? "Incident evidence" : "Alerts";
  const Icon = incidents ? TriangleAlert : Bell;
  const tabs = incidents ? [{ id: "commands", name: "Command failures" }, { id: "audit", name: "Audit exceptions" }] :
    [{ id: "devices", name: "Device signals" }, { id: "monitors", name: "Monitor signals" }];
  const statuses = filters.source === "commands" ? [{ id: "failed", name: "Failed" }, { id: "expired", name: "Expired" }] :
    filters.source === "devices" ? [{ id: "offline", name: "Offline" }, { id: "warning", name: "Warning" }] :
    monitorSource ? [{ id: "offline", name: "Offline" }, { id: "unchecked", name: "Not checked" }] : [];
  const errors = result.rows.filter((row) => row.tone === "error").length;
  const warnings = result.rows.filter((row) => row.tone !== "error").length;
  const unavailable = Boolean(result.error && !result.rows.length);
  const filtered = Boolean(filters.query || filters.status !== "all" || filters.page > 1);
  const placeholder = filters.source === "commands" ? "Search command, error code or message..." :
    filters.source === "audit" ? "Search action, target or actor..." : monitorSource ? "Search monitor name..." : "Search device name or hostname...";

  return (
    <div className="sg-page-shell">
      <div className="sg-page">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-surface-edge bg-surface text-zinc-400"><Icon size={22} /></div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-surface-accent">Operations</p>
              <h1 className="sg-page-title">{title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{incidents ?
                "Review recorded command and audit failures across your organization. These are evidence records, not open incident tickets." :
                "Review current operational signals that need attention across devices and monitors."}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="sg-button sg-button-secondary">
              <Link prefetch={false} href={incidents ? "/dashboard/alerts" : "/dashboard/incidents"}>{incidents ? "View alerts" : "View incidents"}<ArrowUpRight size={14} /></Link>
            </Button>
            <OperationsRefresh />
          </div>
        </header>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs text-surface-muted">
          <span className="inline-flex items-center gap-2"><Building2 size={14} />{organizationName}<span className="text-zinc-700">/</span>Read-only evidence</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 size={13} />Snapshot {formatOperationsTime(new Date(now).toISOString())} UTC</span>
        </div>

        <section aria-label="Current page summary" className="mb-6 grid gap-3 sm:grid-cols-3">
          <Metric label="Records on this page" value={unavailable ? "--" : String(result.rows.length)} description={`Up to ${PAGE_SIZE} per page, not an organization-wide total`} icon={<Activity size={16} />} />
          <Metric label={incidents ? "Recorded failures" : "Offline signals"} value={unavailable ? "--" : String(errors)} description="In the displayed results" icon={<TriangleAlert size={16} />} tone="text-red-400" />
          <Metric label={incidents ? "Informational outcomes" : "Warnings / not checked"} value={unavailable ? "--" : String(warnings)} description="In the displayed results" icon={<Info size={16} />} tone="text-amber-400" />
        </section>

        <section className="sg-surface overflow-hidden">
          <nav aria-label={`${title} sources`} className="px-4 pt-3 sm:px-6">
            <AnimatedSelection value={filters.source} className="sg-tabs">
            {tabs.map((tab) => <Link key={tab.id} prefetch={false} aria-current={filters.source === tab.id ? "page" : undefined}
              href={operationsHref(kind, filters, { source: tab.id, page: 1, status: "all", query: "" })}
              className="sg-tab">{tab.name}</Link>)}
            </AnimatedSelection>
          </nav>

          <OperationsFilterBar key={`${kind}:${filters.source}`} kind={kind} filters={filters} statuses={statuses} placeholder={placeholder} />

          <div className="flex items-start gap-2 border-b border-surface-edge bg-white/[0.015] px-5 py-3 text-xs leading-5 text-surface-muted sm:px-6">
            <Info size={14} className="mt-0.5 shrink-0" />
            <p>{filters.source === "commands" ? "One record per command. Confirmed no-newer-version outcomes are excluded; legacy no-eligible-release results remain informational. These are historical outcomes, not open incident tickets." :
              filters.source === "audit" ? "Failed audit events without command or update-transaction correlation. Command lifecycle events are shown in Command failures instead of duplicated here." :
              monitorSource ? "Monitors currently belong to your account, not an organization. Results reflect the last manual check; use Monitors to run another check." :
              "Offline after more than 90 seconds without a heartbeat, or a recorded offline state. Signals are recalculated on refresh; no automatic polling or new alert rules are running."}</p>
          </div>

          {result.error && <div role="alert" className="m-5 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm text-amber-300"><TriangleAlert size={17} className="mt-0.5 shrink-0" /><p>{result.error}</p></div>}
          {result.rows.length ? <div className="divide-y divide-surface-edge">{result.rows.map((row) => <EvidenceRow key={row.id} row={row} />)}</div> : !unavailable ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-surface-edge bg-surface-inset text-surface-muted">{filtered ? <Search size={22} /> : <ShieldCheck size={22} />}</div>
              <h2 className="sg-section-title mt-4 text-white">{filters.page > 1 ? "No more records on this page" : filters.query || filters.status !== "all" ? "No matching records" : incidents ? "No recorded failures in this view" : "No attention signals in this view"}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-surface-muted">{filtered ? "Try a different search, clear the filters or return to the first page." : incidents ? "Only failures recorded by the existing backend appear here. This does not certify that every operation was successful." : "No matching records are visible to your account. This is not a guarantee that all infrastructure is healthy."}</p>
              {filtered ? <Link prefetch={false} href={operationsHref(kind, filters, { query: "", status: "all", page: 1 })} className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-white">Reset view<ArrowUpRight size={14} /></Link> : !incidents && <Link prefetch={false} href={monitorSource ? "/dashboard/monitors" : "/dashboard/organizations"} className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-white">{monitorSource ? "Open monitors" : "Open infrastructure"}<ArrowUpRight size={14} /></Link>}
            </div>
          ) : null}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-edge px-5 py-4 sm:px-6">
            <p className="text-xs text-surface-muted">Page {filters.page}{result.rows.length > 0 ? ` / Showing ${(filters.page - 1) * PAGE_SIZE + 1}-${(filters.page - 1) * PAGE_SIZE + result.rows.length}` : ""}{filters.page === MAX_PAGE ? " / Narrow your filters to see more history" : ""}</p>
            <nav aria-label="Pagination" className="flex items-center gap-2">
              <PageLink href={filters.page > 1 ? operationsHref(kind, filters, { page: filters.page - 1 }) : undefined} label="Previous"><ChevronLeft size={14} /></PageLink>
              <PageLink href={result.hasNext ? operationsHref(kind, filters, { page: filters.page + 1 }) : undefined} label="Next"><ChevronRight size={14} /></PageLink>
            </nav>
          </footer>
        </section>
        <div className="mt-5 flex items-start gap-2 px-1 text-xs leading-5 text-surface-muted"><ArrowDownRight size={14} className="mt-0.5 shrink-0" /><p>{incidents ? "Evidence is read-only while incident ownership, investigation and resolution are not tracked by the current workflow." : "Signals are derived from the latest device and monitor records. Notification rules and silencing are not available yet."} Existing device actions remain in Clients.</p></div>
      </div>
    </div>
  );
}

function EvidenceRow({ row }: { row: OperationRow }) {
  const Icon = row.tone === "info" ? Info : TriangleAlert;
  return <details className="group transition open:bg-white/[0.015]">
    <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-5 outline-none transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-surface-focus sm:px-6 [&::-webkit-details-marker]:hidden">
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${toneClasses[row.tone]}`}><Icon size={16} /></span>
      <div className="grid min-w-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="sg-section-title font-medium text-zinc-100">{row.title}</h2><StatusBadge status={row.status} tone={row.tone === "error" ? "danger" : row.tone} /></div><p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-surface-muted">{row.description}</p></div>
        <div className="min-w-0"><p className="truncate text-sm text-zinc-300">{row.target}</p><p className="mt-1 truncate text-xs text-surface-muted">{row.context}</p></div>
        <div className="text-xs text-surface-muted"><p>{row.timeLabel}</p><p className="mt-1 text-zinc-400">{formatOperationsTime(row.timestamp)}{row.timestamp ? " UTC" : ""}</p></div>
      </div>
      <ChevronDown size={15} aria-label="Expand evidence" className="mt-1 shrink-0 text-surface-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="border-t border-surface-edge px-5 py-5 sm:px-6 sm:pl-[72px]">
      <p className="mb-5 max-w-3xl whitespace-pre-wrap break-words text-sm leading-6 text-zinc-400">{row.description}</p>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">{row.details.map((detail) => <div key={detail.label} className="min-w-0"><dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-surface-muted">{detail.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-400 [overflow-wrap:anywhere]">{detail.value}</dd></div>)}</dl>
      {row.href && <Link prefetch={false} href={row.href} className="sg-button sg-button-secondary sg-button-sm mt-5">{row.linkLabel}<ArrowUpRight size={14} /></Link>}
    </div>
  </details>;
}

function PageLink({ href, label, children }: { href?: string; label: string; children: React.ReactNode }) {
  const classes = "inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-xs";
  return href ? <Link prefetch={false} href={href} className={`${classes} text-zinc-300 transition hover:bg-surface-hover hover:text-white`}>{label}{children}</Link> :
    <span aria-disabled="true" className={`${classes} text-zinc-700`}>{label}{children}</span>;
}
function Metric({ label, value, description, icon, tone }: { label: string; value: string; description: string; icon: React.ReactNode; tone?: string; }) { return <div className={`sg-surface p-5`}><div className={tone}><p className={`text-xs font-medium text-surface-muted`}>{label}</p>{icon}</div><p className={`text-3xl font-semibold tracking-tight text-white`}>{value}</p><p className={`mt-2 text-xs leading-5 text-surface-muted`}>{description}</p></div>; }
