"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Activity, Binary, Braces, ChevronRight, Globe2, Network, Radar, Route, Search, ShieldCheck, X } from "lucide-react";
import { Surface } from "@/components/dashboard/dashboard-primitives";

type ToolId = "dns" | "http" | "headers" | "ssl" | "whois" | "reverse-dns" | "subnet";
type ToolState = "available" | "agent" | "source" | "coming";
type Tool = {
  id?: ToolId;
  name: string;
  description: string;
  state: ToolState;
  placeholder?: string;
  targetLabel?: string;
  detail?: ReactNode;
  icon: ReactNode;
};

type Category = { title: string; icon: ReactNode; tools: Tool[] };

const categories: Category[] = [
  { title: "Network", icon: <Network size={16} />, tools: [
    { name: "Ping", description: "Test reachability from a managed device.", state: "agent", icon: <Activity size={16} /> },
    { name: "Traceroute", description: "Trace a route from a managed device.", state: "agent", icon: <Route size={16} /> },
    { id: "dns", name: "DNS Lookup", description: "Resolve public DNS records.", state: "available", placeholder: "example.com", targetLabel: "Domain", detail: "All available public records are included in each lookup.", icon: <Search size={16} /> },
    { name: "Port Check", description: "Check a port from a managed device.", state: "agent", icon: <Binary size={16} /> },
    { id: "subnet", name: "Subnet Calculator", description: "Calculate IPv4 CIDR ranges.", state: "available", placeholder: "192.0.2.0/24", targetLabel: "IP / CIDR", icon: <Braces size={16} /> },
  ] },
  { title: "Web & Domains", icon: <Globe2 size={16} />, tools: [
    { id: "http", name: "HTTP Check", description: "Check an endpoint and response time.", state: "available", placeholder: "https://example.com", targetLabel: "URL", detail: "Requests use the GET method and do not follow redirects.", icon: <Activity size={16} /> },
    { id: "ssl", name: "SSL Inspector", description: "Inspect a public TLS certificate.", state: "available", placeholder: "example.com", targetLabel: "Hostname", icon: <ShieldCheck size={16} /> },
    { id: "whois", name: "WHOIS Lookup", description: "Review public domain registration data.", state: "available", placeholder: "example.com", targetLabel: "Domain", icon: <Search size={16} /> },
    { name: "DNS Records", description: "Inspect records from a connected DNS source.", state: "source", icon: <Search size={16} /> },
    { id: "headers", name: "Headers Inspector", description: "Inspect response headers from a public URL.", state: "available", placeholder: "https://example.com", targetLabel: "URL", detail: "Requests use the GET method and do not follow redirects.", icon: <Binary size={16} /> },
  ] },
  { title: "IP & Network Info", icon: <Radar size={16} />, tools: [
    { name: "Public IP Lookup", description: "Look up a public IP address.", state: "coming", icon: <Radar size={16} /> },
    { id: "reverse-dns", name: "Reverse DNS", description: "Resolve a public IP address to hostnames.", state: "available", placeholder: "8.8.8.8", targetLabel: "IP address", icon: <Search size={16} /> },
    { name: "ASN / Provider Lookup", description: "Identify network ownership and ASN.", state: "coming", icon: <Binary size={16} /> },
  ] },
];

const quickTools = ["DNS Lookup", "Subnet Calculator", "HTTP Check", "SSL Inspector", "WHOIS Lookup", "Headers Inspector"];
const stateLabel: Record<ToolState, string> = { available: "Available", agent: "Requires Agent", source: "DNS source required", coming: "Coming soon" };
const toolsByName = new Map(categories.flatMap((category) => category.tools).map((tool) => [tool.name, tool]));

function ResultValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <>{value.length ? value.map((item) => <span key={String(item)} className="sg-diagnostic-value">{String(item)}</span>) : "None found"}</>;
  if (value && typeof value === "object") return <pre className="sg-diagnostic-json">{JSON.stringify(value, null, 2)}</pre>;
  return <>{String(value ?? "Not available")}</>;
}

function Results({ value }: { value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return <p className="text-sm text-zinc-300"><ResultValue value={value} /></p>;
  return <dl className="sg-diagnostic-results">{Object.entries(value as Record<string, unknown>).map(([key, item]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd><ResultValue value={item} /></dd></div>)}</dl>;
}

export default function ToolsWorkspace() {
  const [selected, setSelected] = useState<Tool | null>(null);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const targetInput = useRef<HTMLInputElement>(null);
  const drawerId = useId();

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCategories = useMemo(() => categories.map((category) => ({ ...category, tools: category.tools.filter((tool) => !normalizedQuery || `${tool.name} ${tool.description}`.toLowerCase().includes(normalizedQuery)) })).filter((category) => category.tools.length), [normalizedQuery]);

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => targetInput.current?.focus({ preventScroll: true }));
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") closeDrawer(); }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("keydown", onKeyDown); };
  }, [selected]);

  function selectTool(tool: Tool, element: HTMLButtonElement) {
    trigger.current = element;
    setSelected(tool);
    setTarget("");
    setResult(null);
    setError(null);
  }

  function closeDrawer() {
    setSelected(null);
    window.requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!selected?.id || !target.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/diagnostics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: selected.id, target }) });
      const payload = await response.json() as { error?: string } & Record<string, unknown>;
      if (!response.ok) throw new Error(payload.error ?? "The diagnostic could not be completed.");
      setResult(payload);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The diagnostic could not be completed.");
    } finally {
      setRunning(false);
    }
  }

  return <div className="sg-tools-workspace">
    <label className="sg-tools-search" htmlFor="tools-search"><Search size={17} aria-hidden="true" /><input id="tools-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools..." autoComplete="off" /></label>

    {!normalizedQuery && <section className="sg-tools-quick" aria-labelledby="quick-tools-heading">
      <h2 id="quick-tools-heading" className="sg-tools-group-title">Quick tools</h2>
      <div className="sg-tools-quick-grid">{quickTools.map((name) => {
        const tool = toolsByName.get(name)!;
        return <ToolButton key={tool.name} tool={tool} onSelect={selectTool} compact />;
      })}</div>
    </section>}

    <div className="sg-tools-categories">
      {filteredCategories.map((category) => <section key={category.title} className="sg-tools-category sg-surface sg-panel" aria-labelledby={`${category.title}-tools`}>
        <div className="sg-tools-section-heading"><span className="sg-tool-category-icon" aria-hidden="true">{category.icon}</span><h2 id={`${category.title}-tools`}>{category.title}</h2></div>
        <div className="sg-tools-list">{category.tools.map((tool) => <ToolButton key={tool.name} tool={tool} onSelect={selectTool} />)}</div>
      </section>)}
    </div>
    {!filteredCategories.length && <Surface className="sg-tools-empty"><p className="sg-section-title">No tools found</p><p className="sg-section-description">Try a different search term.</p></Surface>}

    {selected && <div className="sg-tools-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
      <aside id={drawerId} role="dialog" aria-modal="true" aria-labelledby={`${drawerId}-title`} className="sg-tools-drawer">
        <header className="sg-tools-drawer-header"><div className="flex min-w-0 items-start gap-3"><span className="sg-tool-icon" aria-hidden="true">{selected.icon}</span><div className="min-w-0"><h2 id={`${drawerId}-title`} className="sg-section-title">{selected.name}</h2><p className="sg-section-description">{selected.description}</p></div></div><button type="button" className="sg-button sg-button-ghost sg-button-icon shrink-0" onClick={closeDrawer} aria-label={`Close ${selected.name}`}><X size={17} aria-hidden="true" /></button></header>
        {selected.id ? <form onSubmit={run} className="sg-tools-drawer-body"><label htmlFor={`${drawerId}-target`} className="text-xs font-medium text-[var(--sg-text)]">{selected.targetLabel ?? "Target"}</label><input ref={targetInput} id={`${drawerId}-target`} className="sg-control w-full px-3" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={selected.placeholder} autoComplete="off" required />{selected.detail && <p className="sg-meta">{selected.detail}</p>}<button className="sg-button sg-button-primary w-fit" disabled={running}>{running ? "Running..." : "Run diagnostic"}</button>{Boolean(error || result) && <div className="sg-diagnostic-output" aria-live="polite">{error ? <p className="text-sm text-red-300">{error}</p> : <Results value={result} />}</div>}</form> : <div className="sg-tools-drawer-body"><div className="sg-tool-unavailable"><span className={`sg-tool-state-dot sg-tool-state-${selected.state}`} aria-hidden="true" /><div><p className="sg-section-title">{stateLabel[selected.state]}</p><p className="sg-section-description">{selected.state === "agent" ? "This diagnostic requires execution from a managed device." : selected.state === "source" ? "Connect a DNS zone source to inspect managed record health and configuration." : "This diagnostic is planned for a future SentinelGrid release."}</p></div></div></div>}
      </aside>
    </div>}
  </div>;
}

function ToolButton({ tool, onSelect, compact = false }: { tool: Tool; onSelect: (tool: Tool, element: HTMLButtonElement) => void; compact?: boolean }) {
  return <button type="button" className={compact ? "sg-tool-launcher sg-tool-launcher-quick" : "sg-tool-launcher"} onClick={(event) => onSelect(tool, event.currentTarget)}>
    <span className="sg-tool-icon" aria-hidden="true">{tool.icon}</span><span className="sg-tool-content"><span className="sg-tool-name">{tool.name}</span>{!compact && <span className="sg-meta sg-tool-description">{tool.description}</span>}</span><span className="sg-tool-state"><span className={`sg-tool-state-dot sg-tool-state-${tool.state}`} aria-hidden="true" />{stateLabel[tool.state]}</span>{!compact && <ChevronRight size={16} className="sg-tool-chevron" aria-hidden="true" />}
  </button>;
}
