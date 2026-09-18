"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
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

export type AdminAuditRow = {
  id: string;
  organizationId: string | null;
  organizationName: string;
  actorEmail: string;
  action: string;
  targetType: string | null;
  targetName: string | null;
  status: string | null;
  createdAt: string;
};

type FilterOption = readonly [string, string];

export function AdminUsersInventory({ users }: { users: AdminUserRow[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const shown = useMemo(
    () =>
      users.filter(
        (user) =>
          (!deferredQuery ||
            user.email.toLowerCase().includes(deferredQuery) ||
            user.id.toLowerCase().includes(deferredQuery)) &&
          (!role || role === user.platformRole || (role === "none" && !user.platformRole)) &&
          (!status || status === (user.suspended ? "suspended" : "active")),
      ),
    [deferredQuery, role, status, users],
  );

  const filtered = Boolean(query || role || status);

  return (
    <>
      <AdminFilterBar query={query} setQuery={setQuery} placeholder="Search email or user ID">
        <FilterSelect
          value={role}
          onChange={setRole}
          label="Platform role"
          options={[
            ["", "All roles"],
            ["platform_admin", "Platform Admin"],
            ["developer", "Developer"],
            ["none", "No platform access"],
          ]}
        />
        <FilterSelect
          value={status}
          onChange={setStatus}
          label="Account status"
          options={[
            ["", "All accounts"],
            ["active", "Active"],
            ["suspended", "Suspended"],
          ]}
        />
        {filtered && (
          <button
            type="button"
            className="sg-admin-filter-reset"
            onClick={() => {
              setQuery("");
              setRole("");
              setStatus("");
            }}
          >
            Reset
          </button>
        )}
      </AdminFilterBar>

      <div className="sg-admin-inventory-head sg-admin-grid-users">
        <span>User</span>
        <span>Organizations</span>
        <span>Platform role</span>
        <span>Status</span>
        <span>Last sign in</span>
        <span />
      </div>

      {shown.map((user) => (
        <Link
          key={user.id}
          href={`/admin/users/${user.id}`}
          className="sg-admin-inventory-row sg-admin-grid-users"
        >
          <div className="sg-admin-inventory-row-main">
            <strong>{user.email}</strong>
            <span>{user.id}</span>
          </div>

          <InventoryField label="Organizations" value={user.memberships} />
          <InventoryField
            label="Platform role"
            value={
              user.platformRole ? (
                <StatusBadge status={user.platformRole} tone="info">
                  {user.platformRole === "developer" ? "Developer" : "Platform Admin"}
                </StatusBadge>
              ) : (
                "None"
              )
            }
          />
          <InventoryField
            label="Status"
            value={
              <StatusBadge
                status={user.suspended ? "Suspended" : "Active"}
                tone={user.suspended ? "warning" : "success"}
              />
            }
          />
          <InventoryField label="Last sign in" value={format(user.lastSignIn)} />
          <ChevronRight className="sg-admin-row-chevron" size={16} />
        </Link>
      ))}

      {!shown.length && <p className="sg-admin-empty">No users match the current filters.</p>}
    </>
  );
}

export function AdminOrganizationsInventory({
  organizations,
}: {
  organizations: AdminOrganizationRow[];
}) {
  const [query, setQuery] = useState("");
  const [resources, setResources] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const shown = useMemo(
    () =>
      organizations.filter(
        (organization) =>
          (!deferredQuery ||
            organization.name.toLowerCase().includes(deferredQuery) ||
            organization.ownerEmail.toLowerCase().includes(deferredQuery) ||
            organization.id.toLowerCase().includes(deferredQuery)) &&
          (!resources ||
            (resources === "clients"
              ? organization.clients > 0
              : organization.devices > 0)),
      ),
    [deferredQuery, organizations, resources],
  );

  const filtered = Boolean(query || resources);

  return (
    <>
      <AdminFilterBar
        query={query}
        setQuery={setQuery}
        placeholder="Search organization, owner or ID"
      >
        <FilterSelect
          value={resources}
          onChange={setResources}
          label="Resources"
          options={[
            ["", "All organizations"],
            ["clients", "Has clients"],
            ["devices", "Has devices"],
          ]}
        />
        {filtered && (
          <button
            type="button"
            className="sg-admin-filter-reset"
            onClick={() => {
              setQuery("");
              setResources("");
            }}
          >
            Reset
          </button>
        )}
      </AdminFilterBar>

      <div className="sg-admin-inventory-head sg-admin-grid-organizations">
        <span>Organization</span>
        <span>Owner</span>
        <span>Members</span>
        <span>Clients</span>
        <span>Devices</span>
        <span />
      </div>

      {shown.map((organization) => (
        <Link
          key={organization.id}
          href={`/admin/organizations/${organization.id}`}
          className="sg-admin-inventory-row sg-admin-grid-organizations"
        >
          <div className="sg-admin-inventory-row-main">
            <strong>{organization.name}</strong>
            <span>{organization.id}</span>
          </div>

          <InventoryField label="Owner" value={organization.ownerEmail} />
          <InventoryField label="Members" value={organization.members} />
          <InventoryField label="Clients" value={organization.clients} />
          <InventoryField label="Devices" value={organization.devices} />
          <ChevronRight className="sg-admin-row-chevron" size={16} />
        </Link>
      ))}

      {!shown.length && <p className="sg-admin-empty">No organizations match the current filters.</p>}
    </>
  );
}

export function AdminAuditInventory({
  entries,
  organizations,
}: {
  entries: AdminAuditRow[];
  organizations: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [organization, setOrganization] = useState("");
  const [result, setResult] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const shown = useMemo(
    () =>
      entries.filter((entry) => {
        const matchesQuery =
          !deferredQuery ||
          [entry.action, entry.actorEmail, entry.targetType, entry.targetName].some((value) =>
            value?.toLowerCase().includes(deferredQuery),
          );

        const matchesType =
          !type ||
          (type === "platform"
            ? entry.action.startsWith("platform.")
            : type === "organization"
              ? entry.action.startsWith("organization.")
              : entry.targetType === "device" || entry.action.startsWith("device."));

        return (
          matchesQuery &&
          matchesType &&
          (!organization || entry.organizationId === organization) &&
          (!result || entry.status === result)
        );
      }),
    [deferredQuery, entries, organization, result, type],
  );

  const filtered = Boolean(query || type || organization || result);

  return (
    <>
      <AdminFilterBar query={query} setQuery={setQuery} placeholder="Search action, actor or resource">
        <FilterSelect
          value={type}
          onChange={setType}
          label="Type"
          options={[
            ["", "All actions"],
            ["platform", "Platform"],
            ["organization", "Organization"],
            ["device", "Device"],
          ]}
        />
        <FilterSelect
          value={organization}
          onChange={setOrganization}
          label="Organization"
          options={[
            ["", "All organizations"],
            ...organizations.map((item) => [item.id, item.name] as FilterOption),
          ]}
        />
        <FilterSelect
          value={result}
          onChange={setResult}
          label="Result"
          options={[
            ["", "All results"],
            ["success", "Success"],
            ["failed", "Failed"],
          ]}
        />
        {filtered && (
          <button
            type="button"
            className="sg-admin-filter-reset"
            onClick={() => {
              setQuery("");
              setType("");
              setOrganization("");
              setResult("");
            }}
          >
            Reset
          </button>
        )}
      </AdminFilterBar>

      <div className="sg-admin-inventory-head sg-admin-grid-audit">
        <span>Event</span>
        <span>Actor</span>
        <span>Organization</span>
        <span>Timestamp</span>
        <span>Result</span>
      </div>

      {shown.map((entry) => (
        <div
          key={entry.id}
          className="sg-admin-inventory-row sg-admin-grid-audit"
        >
          <div className="sg-admin-inventory-row-main">
            <strong>{entry.action}</strong>
            <span>
              {[entry.targetType, entry.targetName].filter(Boolean).join(" / ") ||
                "No resource recorded"}
            </span>
          </div>

          <InventoryField label="Actor" value={entry.actorEmail} />
          <InventoryField label="Organization" value={entry.organizationName} />
          <InventoryField label="Timestamp" value={format(entry.createdAt)} />
          <InventoryField
            label="Result"
            value={<StatusBadge status={entry.status ?? "unknown"}>{entry.status ?? "Unknown"}</StatusBadge>}
          />
        </div>
      ))}

      {!shown.length && <p className="sg-admin-empty">No audit entries match the current filters.</p>}
    </>
  );
}

export function AdminFilterBar({
  query,
  setQuery,
  placeholder,
  children,
}: {
  query: string;
  setQuery: (value: string) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sg-admin-filter-bar" role="search">
      <label className="sg-admin-search sg-admin-filter-field">
        <span>Search</span>
        <span className="sg-admin-search-control">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            className="sg-input"
            autoComplete="off"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </span>
      </label>
      {children}
    </div>
  );
}

export function FilterSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: readonly FilterOption[];
}) {
  return (
    <label className="sg-admin-filter-select sg-admin-filter-field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="sg-select"
      >
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function InventoryField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="sg-admin-inventory-field">
      <label>{label}</label>
      <span>{value}</span>
    </div>
  );
}

function format(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not available";
}
