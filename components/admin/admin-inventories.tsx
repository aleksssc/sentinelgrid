"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";

export type AdminUserRow = {
  id: string;
  email: string;
  memberships: number;
  platformRole: "developer" | "platform_admin" | null;
  suspended: boolean;
  lastSignIn: string | null;
};

export type AdminOrganizationRow = {
  id: string;
  name: string;
  ownerEmail: string;
  members: number;
  clients: number;
  devices: number;
};

type FilterOption = readonly [string, string];

export function AdminUsersInventory({ users }: { users: AdminUserRow[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const shown = useMemo(() => users.filter((user) =>
    (!deferredQuery || user.email.toLowerCase().includes(deferredQuery) || user.id.includes(deferredQuery)) &&
    (!role || role === user.platformRole || (role === "none" && !user.platformRole)) &&
    (!status || status === (user.suspended ? "suspended" : "active")),
  ), [deferredQuery, role, status, users]);
  const filtered = Boolean(query || role || status);

  return <><AdminFilterBar query={query} setQuery={setQuery} placeholder="Search email or user ID">
    <FilterSelect value={role} onChange={setRole} label="Platform role" options={[["", "All platform roles"], ["platform_admin", "Platform Admin"], ["developer", "Developer"], ["none", "No platform access"]]} />
    <FilterSelect value={status} onChange={setStatus} label="Account status" options={[["", "All account statuses"], ["active", "Active"], ["suspended", "Suspended"]]} />
    {filtered && <button type="button" className="sg-admin-filter-reset" onClick={() => { setQuery(""); setRole(""); setStatus(""); }}>Reset filters</button>}
  </AdminFilterBar>
  <div className="divide-y divide-surface-edge">
    <div className="sg-table-heading hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1.25fr)_0.65fr_0.6fr_0.7fr_auto] gap-4 px-5 py-3 lg:grid"><span>Email</span><span>Organization memberships</span><span>Platform role</span><span>Account</span><span>Last sign in</span><span /></div>
    {shown.map((user) => <div key={user.id} className="sg-admin-user-row sg-admin-interactive-row grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.25fr)_0.65fr_0.6fr_0.7fr_auto] lg:items-center">
      <div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-100">{user.email}</p><p className="mt-1 truncate font-mono text-xs text-surface-muted">{user.id}</p></div>
      <div className="sg-admin-user-fields lg:contents"><Field label="Memberships" value={user.memberships ? `${user.memberships} membership${user.memberships === 1 ? "" : "s"}` : "None"} /><Field label="Platform role" value={user.platformRole ? <StatusBadge status={user.platformRole} tone="info">{user.platformRole === "developer" ? "Developer" : "Platform Admin"}</StatusBadge> : "None"} /><Field label="Account" value={<StatusBadge status={user.suspended ? "Suspended" : "Active"} tone={user.suspended ? "warning" : "success"}>{user.suspended ? "Suspended" : "Active"}</StatusBadge>} /><Field label="Last sign in" value={format(user.lastSignIn)} /></div>
      <Link href={`/admin/users/${user.id}`} className="sg-button sg-button-secondary sg-button-sm justify-self-start lg:justify-self-end">Manage</Link>
    </div>)}
    {!shown.length && <p className="px-5 py-8 text-sm text-surface-muted">No users match the current filters.</p>}
  </div></>;
}

export function AdminOrganizationsInventory({ organizations }: { organizations: AdminOrganizationRow[] }) {
  const [query, setQuery] = useState("");
  const [resources, setResources] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const shown = useMemo(() => organizations.filter((organization) =>
    (!deferredQuery || organization.name.toLowerCase().includes(deferredQuery) || organization.ownerEmail.toLowerCase().includes(deferredQuery) || organization.id.includes(deferredQuery)) &&
    (!resources || (resources === "clients" ? organization.clients > 0 : organization.devices > 0)),
  ), [deferredQuery, organizations, resources]);
  const filtered = Boolean(query || resources);

  return <><AdminFilterBar query={query} setQuery={setQuery} placeholder="Search organization, owner or ID">
    <FilterSelect value={resources} onChange={setResources} label="Resources" options={[["", "All organizations"], ["clients", "Has clients"], ["devices", "Has devices"]]} />
    {filtered && <button type="button" className="sg-admin-filter-reset" onClick={() => { setQuery(""); setResources(""); }}>Reset filters</button>}
  </AdminFilterBar>
  <div className="divide-y divide-surface-edge">
    <div className="sg-table-heading hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_0.45fr_0.45fr_0.45fr_auto] gap-4 px-5 py-3 lg:grid"><span>Organization</span><span>Owner</span><span>Members</span><span>Clients</span><span>Devices</span><span /></div>
    {shown.map((organization) => <div key={organization.id} className="sg-admin-organization-row sg-admin-interactive-row grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_0.45fr_0.45fr_0.45fr_auto] lg:items-center">
      <div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-100">{organization.name}</p><p className="mt-1 truncate font-mono text-xs text-surface-muted">{organization.id}</p></div>
      <div className="sg-admin-organization-fields lg:contents"><Field label="Owner" value={organization.ownerEmail} /><Field label="Members" value={organization.members} /><Field label="Clients" value={organization.clients} /><Field label="Devices" value={organization.devices} /></div>
      <Link href={`/admin/organizations/${organization.id}`} className="sg-button sg-button-secondary sg-button-sm justify-self-start lg:justify-self-end">View</Link>
    </div>)}
    {!shown.length && <p className="px-5 py-8 text-sm text-surface-muted">No organizations match the current filters.</p>}
  </div></>;
}

export type AdminAuditRow = { id: string; organizationId: string | null; organizationName: string; actorEmail: string; action: string; targetType: string | null; targetName: string | null; status: string | null; createdAt: string };
export function AdminAuditInventory({ entries, organizations }: { entries: AdminAuditRow[]; organizations: { id: string; name: string }[] }) {
  const [query, setQuery] = useState(""); const [type, setType] = useState(""); const [organization, setOrganization] = useState(""); const [result, setResult] = useState(""); const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const shown = useMemo(() => entries.filter((entry) => {
    const matchesQuery = !deferredQuery || [entry.action, entry.actorEmail, entry.targetType, entry.targetName].some((value) => value?.toLowerCase().includes(deferredQuery));
    const matchesType = !type || (type === "platform" ? entry.action.startsWith("platform.") : type === "organization" ? entry.action.startsWith("organization.") : entry.targetType === "device" || entry.action.startsWith("device."));
    return matchesQuery && matchesType && (!organization || entry.organizationId === organization) && (!result || entry.status === result);
  }), [deferredQuery, entries, organization, result, type]); const filtered = Boolean(query || type || organization || result);
  return <><AdminFilterBar query={query} setQuery={setQuery} placeholder="Search action, actor or resource"><FilterSelect value={type} onChange={setType} label="Action type" options={[["", "All action types"], ["platform", "Platform actions"], ["organization", "Organization actions"], ["device", "Device actions"]]} /><FilterSelect value={organization} onChange={setOrganization} label="Organization" options={[["", "All organizations"], ...organizations.map((item) => [item.id, item.name] as FilterOption)]} /><FilterSelect value={result} onChange={setResult} label="Result" options={[["", "All results"], ["success", "Success"], ["failed", "Failed"]]} />{filtered && <button type="button" className="sg-admin-filter-reset" onClick={() => { setQuery(""); setType(""); setOrganization(""); setResult(""); }}>Reset filters</button>}</AdminFilterBar><div className="divide-y divide-surface-edge"><div className="sg-table-heading hidden grid-cols-[0.8fr_0.9fr_1fr_1fr_0.6fr] gap-4 px-5 py-3 lg:grid"><span>Timestamp</span><span>Actor</span><span>Organization</span><span>Action / resource</span><span>Result</span></div>{shown.map((entry) => <div key={entry.id} className="sg-admin-audit-row sg-admin-interactive-row grid gap-3 px-5 py-4 lg:grid-cols-[0.8fr_0.9fr_1fr_1fr_0.6fr] lg:items-center"><div className="sg-admin-audit-action"><p className="text-sm font-medium text-zinc-100">{entry.action}</p><p className="mt-1 text-xs text-surface-muted">{[entry.targetType, entry.targetName].filter(Boolean).join(" / ") || "No resource recorded"}</p></div><div className="sg-admin-audit-fields lg:contents"><Field label="Timestamp" value={format(entry.createdAt)} /><Field label="Actor" value={entry.actorEmail} /><Field label="Organization" value={entry.organizationName} /><Field label="Result" value={<StatusBadge status={entry.status ?? "unknown"}>{entry.status ?? "Unknown"}</StatusBadge>} /></div></div>)}{!shown.length && <p className="px-5 py-8 text-sm text-surface-muted">No audit entries match the current filters.</p>}</div></>;
}

export function AdminFilterBar({ query, setQuery, placeholder, children }: { query: string; setQuery: (value: string) => void; placeholder: string; children: React.ReactNode }) { return <div className="sg-admin-filter-bar" role="search"><label className="sg-admin-search sg-admin-filter-field"><span>Search</span><span className="sg-admin-search-control"><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className="sg-input" autoComplete="off" />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</span></label>{children}</div>; }
export function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: readonly FilterOption[] }) { return <label className="sg-admin-filter-select sg-admin-filter-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="sg-select">{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>; }
function Field({ label, value }: { label: string; value: React.ReactNode }) { return <div className="flex justify-between gap-3 text-xs text-zinc-300 lg:block"><span className="sg-meta lg:hidden">{label}</span><span>{value}</span></div>; }
function format(value: string | null) { return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not available"; }
