"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, ChevronRight, List, LayoutGrid, Search } from "lucide-react";
import { useAppearance } from "@/components/dashboard/appearance-provider";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { AnimatedSelection } from "@/components/dashboard/animated-selection";
import { EmptyState } from "@/components/dashboard/dashboard-primitives";

type Client = { id: string; name: string; description: string | null; status: "active" | "inactive"; operationalSummary?: string };
type Props = { organizationId: string; clients: Client[] };
type ViewMode = "grid" | "list";

export default function OrganizationClients({ organizationId, clients }: Props) {
  const { preferences, ready } = useAppearance();
  const [search, setSearch] = useState("");
  const [viewOverride, setViewOverride] = useState<{ mode: ViewMode; defaultView: ViewMode; organizationId: string } | null>(null);
  if (viewOverride && (viewOverride.defaultView !== preferences.defaultView || viewOverride.organizationId !== organizationId)) setViewOverride(null);
  const viewMode = viewOverride?.defaultView === preferences.defaultView && viewOverride.organizationId === organizationId ? viewOverride.mode : preferences.defaultView;
  const filteredClients = useMemo(() => {
    const value = search.trim().toLowerCase();
    return clients.filter((client) => !value || client.name.toLowerCase().includes(value) || client.description?.toLowerCase().includes(value));
  }, [clients, search]);

  return <div className="sg-client-directory" aria-busy={!ready}>
    <div className="sg-toolbar sg-client-toolbar">
      <div className="relative min-w-0 flex-1 sm:max-w-sm"><Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-muted" /><input type="search" aria-label="Search clients" placeholder="Search clients..." value={search} onChange={(event) => setSearch(event.target.value)} className="sg-control w-full pl-9 pr-3" /></div>
      <span className="sg-meta hidden sm:block" role="status">{filteredClients.length} {filteredClients.length === 1 ? "client" : "clients"}{search ? ` of ${clients.length}` : ""}</span>
      <AnimatedSelection value={viewMode} className="sg-segments" role="group" aria-label="Client view">{([{ mode: "list", icon: List }, { mode: "grid", icon: LayoutGrid }] as const).map(({ mode, icon: Icon }) => <button key={mode} type="button" disabled={!ready} onClick={() => setViewOverride({ mode, defaultView: preferences.defaultView, organizationId })} title={mode === "list" ? "List view" : "Grid view"} aria-label={mode === "list" ? "List view" : "Grid view"} aria-pressed={viewMode === mode} className="sg-segment flex items-center justify-center"><Icon size={16} /></button>)}</AnimatedSelection>
    </div>
    <span role="status" className="sr-only sm:hidden">{filteredClients.length} clients found</span>
    {!ready ? <div role="status" className="sg-client-skeleton animate-pulse"><span className="sr-only">Loading client view...</span>{[0, 1, 2].map((key) => <div key={key} />)}</div> : filteredClients.length === 0 ? <EmptyState title="No clients found" description="Try another name or clear your search." icon={<Building2 size={22} />} action={<button type="button" className="sg-button sg-button-secondary sg-button-sm" onClick={() => setSearch("")}>Clear search</button>} /> : <div className={viewMode === "grid" ? "sg-client-grid" : "sg-client-list"}>{filteredClients.map((client) => <Link key={client.id} href={`/dashboard/organizations/${organizationId}/clients/${client.id}`} className={`sg-client-item group ${viewMode === "grid" ? "sg-surface sg-interactive sg-client-card" : "sg-row sg-client-row"}`}><span className="sg-client-icon" aria-hidden="true"><Building2 size={17} /></span><div className="sg-client-copy"><h3 className="truncate text-sm font-medium text-zinc-100">{client.name}</h3><p className="sg-meta">{client.operationalSummary || client.description || "No description provided."}</p></div><StatusBadge status={client.status} /><ChevronRight size={16} className="sg-client-chevron" aria-hidden="true" /></Link>)}</div>}
  </div>;
}
