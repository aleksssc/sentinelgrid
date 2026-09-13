import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CalendarClock, Globe2, Network, Plus, ScanSearch, ShieldX } from "lucide-react";
import { getOrganizationContext } from "@/lib/organization-context";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { CompactSummary, EmptyState, PageHeader, SectionHeader, Surface } from "@/components/dashboard/dashboard-primitives";
import { loadDomains, type DomainMonitorStatus } from "./data";

function domainHealth(status: DomainMonitorStatus) {
  if (status === "online") return { label: "Healthy", tone: "success" as const };
  if (status === "offline") return { label: "Issue detected", tone: "danger" as const };
  return { label: "Not checked", tone: "neutral" as const };
}
function domainHref(hostname: string) { return `/dashboard/domains/${encodeURIComponent(hostname)}`; }

export default async function DomainsPage() {
  await connection();
  const { user, organization } = await getOrganizationContext();
  if (!user) redirect("/auth/login");
  if (!organization) redirect("/onboarding");
  const { domains, error } = await loadDomains(user.id);

  return <div className="sg-page-shell"><div className="sg-page">
    <PageHeader title="Domains & DNS" eyebrow="Infrastructure" icon={<Globe2 size={22} />} description="Manage and review monitored domains from one place." actions={<Link href="/dashboard/monitors#add-monitor" className="sg-button sg-button-primary"><Plus size={16} />Add monitor</Link>} />
    <CompactSummary label="Domain summary" items={[{ label: "Total domains", value: domains.length, icon: <Globe2 size={14} /> }, { label: "Expiring soon", value: "--", icon: <CalendarClock size={14} />, tone: "neutral" }, { label: "SSL issues", value: "--", icon: <ShieldX size={14} />, tone: "neutral" }, { label: "DNS issues", value: "--", icon: <AlertTriangle size={14} />, tone: "neutral" }]} />
    <section className="mt-6" aria-label="Domain inventory"><SectionHeader title="Domain inventory" description="Overview of monitored domains and their current health." icon={<ScanSearch size={17} />} />
      {error && <div role="alert" className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm text-amber-300"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><p>{error}</p></div>}
      {domains.length ? <div className="sg-domain-grid mt-4">{domains.map((domain) => { const health = domainHealth(domain.status); return <article key={domain.hostname} className="sg-domain-card"><div className="flex min-w-0 items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><span className="sg-section-icon h-9 w-9 shrink-0" aria-hidden="true"><Globe2 size={17} /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold text-white">{domain.hostname}</h2><StatusBadge status={health.label} tone={health.tone}>{health.label}</StatusBadge></div><p className="sg-meta mt-1">{domain.endpoints.length} linked monitor{domain.endpoints.length === 1 ? "" : "s"}</p></div></div><Link href={domainHref(domain.hostname)} aria-label={`Open ${domain.hostname}`} className="sg-button sg-button-ghost sg-button-icon sg-button-sm"><ArrowUpRight size={14} /></Link></div><dl className="sg-domain-details"><div><dt>Registrar</dt><dd>Not available</dd></div><div><dt>Domain expiry</dt><dd>Not available</dd></div><div><dt>SSL certificate</dt><dd><StatusBadge status="unavailable">Not checked</StatusBadge></dd></div><div><dt>DNSSEC</dt><dd><StatusBadge status="unavailable">Not checked</StatusBadge></dd></div><div className="sm:col-span-2"><dt>Nameservers</dt><dd>Not available</dd></div><div className="sm:col-span-2"><dt>Resolved IP addresses</dt><dd>Not available</dd></div></dl><div className="sg-domain-actions"><Link href={`${domainHref(domain.hostname)}?tab=dns-records`} className="sg-button sg-button-secondary sg-button-sm">View DNS</Link><Link href={`${domainHref(domain.hostname)}?tab=ssl`} className="sg-button sg-button-secondary sg-button-sm">View SSL</Link><Link href={`${domainHref(domain.hostname)}?tab=monitors`} className="sg-button sg-button-ghost sg-button-sm">View monitors<ArrowUpRight size={13} /></Link></div></article>; })}</div> : !error ? <Surface className="mt-4"><EmptyState title="No domains in your inventory" description="Add an HTTP or HTTPS monitor to begin tracking the domain behind it." icon={<Globe2 size={22} />} action={<Link href="/dashboard/monitors#add-monitor" className="sg-button sg-button-primary"><Plus size={15} />Add monitor</Link>} /></Surface> : null}
    </section>
    <Surface className="mt-6 overflow-hidden" aria-labelledby="dns-records-title"><SectionHeader title="DNS Records" description="Inspect record health and zone configuration from a connected DNS source." icon={<Network size={17} />} /><div className="sg-domain-empty-state"><span className="sg-empty-icon" aria-hidden="true"><Network size={22} /></span><div><h2 id="dns-records-title" className="sg-section-title">No DNS source available</h2><p className="sg-section-description max-w-xl">Connect a DNS provider or zone source to inspect record health and configuration.</p><button type="button" disabled title="DNS source connections are not available yet" className="sg-button sg-button-secondary sg-button-sm mt-4">Connect DNS source</button></div></div></Surface>
  </div></div>;
}
