"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Network, ShieldCheck } from "lucide-react";
import { AnimatedSelection } from "@/components/dashboard/animated-selection";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { SectionHeader, Surface } from "@/components/dashboard/dashboard-primitives";
import type { DomainEndpoint, DomainMonitorStatus } from "@/app/dashboard/domains/data";

type DomainTab = "overview" | "dns-records" | "ssl" | "whois" | "monitors";

type Props = {
  endpoints: DomainEndpoint[];
};

const tabs: ReadonlyArray<{ id: DomainTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "dns-records", label: "DNS Records" },
  { id: "ssl", label: "SSL" },
  { id: "whois", label: "WHOIS" },
  { id: "monitors", label: "Monitors" },
];

function formatLastChecked(value: string | null) {
  if (!value) return "Not checked";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function endpointLabel(status: DomainMonitorStatus) {
  if (status === "online") return "Online";
  if (status === "offline") return "Offline";
  return "Not checked";
}

export function DomainDetailTabs({ endpoints }: Props) {
  const [activeTab, setActiveTab] = useState<DomainTab>("overview");
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabId = useId();
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);

  function selectTab(nextIndex: number) {
    const tab = tabs[(nextIndex + tabs.length) % tabs.length];
    setActiveTab(tab.id);
    requestAnimationFrame(() => tabListRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${tab.id}"]`)?.focus());
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight") { event.preventDefault(); selectTab(activeIndex + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); selectTab(activeIndex - 1); }
    if (event.key === "Home") { event.preventDefault(); selectTab(0); }
    if (event.key === "End") { event.preventDefault(); selectTab(tabs.length - 1); }
  }

  return <>
    <div ref={tabListRef}>
      <AnimatedSelection value={activeTab} role="tablist" aria-label="Domain sections" className="sg-tabs mb-6">
        {tabs.map((tab) => <button
          key={tab.id}
          id={`${tabId}-${tab.id}-tab`}
          type="button"
          role="tab"
          data-tab={tab.id}
          aria-controls={`${tabId}-${tab.id}-panel`}
          aria-selected={activeTab === tab.id}
          aria-pressed={activeTab === tab.id}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => setActiveTab(tab.id)}
          onKeyDown={onTabKeyDown}
          className="sg-tab"
        >{tab.label}</button>)}
      </AnimatedSelection>
    </div>

    <div id={`${tabId}-${activeTab}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${activeTab}-tab`} tabIndex={0} className="sg-domain-tab-panel">
      {activeTab === "overview" && <Surface className="overflow-hidden"><SectionHeader title="Domain overview" description="Information provided by a domain or DNS source will appear here." />
        <dl className="sg-domain-details p-5"><div><dt>Registrar</dt><dd>Not available</dd></div><div><dt>Domain expiry</dt><dd>Not available</dd></div><div><dt>Nameservers</dt><dd>Not available</dd></div><div><dt>Resolved IP addresses</dt><dd>Not available</dd></div></dl>
      </Surface>}

      {activeTab === "dns-records" && <Surface className="overflow-hidden"><SectionHeader title="DNS Records" description="Record health and configuration from a connected provider or zone source." icon={<Network size={17} />} />
        <div className="sg-domain-empty-state"><span className="sg-empty-icon" aria-hidden="true"><Network size={22} /></span><div><h2 className="sg-section-title">No DNS source configured</h2><p className="sg-section-description">Connect a DNS provider or zone source to inspect record health and configuration.</p><button type="button" disabled title="DNS source connections are not configured yet" className="sg-button sg-button-secondary sg-button-sm mt-4">Connect DNS source</button></div></div>
      </Surface>}

      {activeTab === "ssl" && <Surface className="overflow-hidden"><SectionHeader title="SSL" description="Certificate inspection requires an SSL data source." icon={<ShieldCheck size={17} />} />
        <div className="p-5"><StatusBadge status="unavailable">Not configured</StatusBadge><p className="sg-section-description mt-3">Certificate validity and expiry will be available once a source is connected.</p></div>
      </Surface>}

      {activeTab === "whois" && <Surface className="overflow-hidden"><SectionHeader title="WHOIS" description="Ownership and registration details require a WHOIS source." />
        <div className="p-5"><StatusBadge status="unavailable">Not available</StatusBadge></div>
      </Surface>}

      {activeTab === "monitors" && <Surface className="overflow-hidden"><SectionHeader title="Linked monitors" description="HTTP and HTTPS checks currently contributing to this domain health." />
        <div className="divide-y divide-surface-edge">{endpoints.map((endpoint) => <Link key={endpoint.id} href={`/dashboard/monitors/${endpoint.id}`} className="sg-row flex min-w-0 items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="truncate text-sm font-medium text-white">{endpoint.name}</p><p className="mt-1 truncate text-xs text-surface-muted">{endpoint.url} · Last check {formatLastChecked(endpoint.lastCheckedAt)}</p></div><div className="flex shrink-0 items-center gap-3"><StatusBadge status={endpoint.status}>{endpointLabel(endpoint.status)}</StatusBadge><ArrowUpRight size={15} className="text-surface-muted" /></div></Link>)}</div>
      </Surface>}
    </div>
  </>;
}
