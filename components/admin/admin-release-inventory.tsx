"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { AdminFilterBar, FilterSelect } from "@/components/admin/admin-inventories";

export type AdminReleaseRow = {
  id: string;
  version: string;
  channel: string;
  state: "Current" | "Available" | "Archived";
  publishedAt: string | null;
  build: string;
  signer: string;
  devices: number;
};

export function AdminReleaseInventory({
  releases,
}: {
  releases: AdminReleaseRow[];
}) {
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("");
  const [state, setState] = useState("");
  const deferredQuery = useDeferredValue(query.toLowerCase().trim());

  const shown = useMemo(
    () =>
      releases.filter(
        (release) =>
          (!deferredQuery || release.version.toLowerCase().includes(deferredQuery)) &&
          (!channel || release.channel === channel) &&
          (!state || release.state === state),
      ),
    [channel, deferredQuery, releases, state],
  );

  const filtered = Boolean(query || channel || state);

  return (
    <>
      <AdminFilterBar query={query} setQuery={setQuery} placeholder="Search version">
        <FilterSelect
          value={channel}
          onChange={setChannel}
          label="Channel"
          options={[
            ["", "All channels"],
            ["stable", "Stable"],
            ["beta", "Beta"],
          ]}
        />
        <FilterSelect
          value={state}
          onChange={setState}
          label="State"
          options={[
            ["", "All states"],
            ["Current", "Current"],
            ["Available", "Available"],
            ["Archived", "Archived"],
          ]}
        />
        {filtered && (
          <button
            type="button"
            className="sg-admin-filter-reset"
            onClick={() => {
              setQuery("");
              setChannel("");
              setState("");
            }}
          >
            Reset
          </button>
        )}
      </AdminFilterBar>

      <div className="sg-admin-inventory-head sg-admin-grid-releases">
        <span>Version</span>
        <span>Channel</span>
        <span>State</span>
        <span>Published</span>
        <span>Build</span>
        <span>Signer</span>
        <span>Devices</span>
      </div>

      {shown.map((release) => (
        <div
          key={release.id}
          className="sg-admin-inventory-row sg-admin-grid-releases"
        >
          <Field label="Version" value={`v${release.version}`} mono />
          <Field label="Channel" value={release.channel} />
          <Field
            label="State"
            value={
              <StatusBadge
                status={release.state}
                tone={
                  release.state === "Current"
                    ? "success"
                    : release.state === "Available"
                      ? "info"
                      : "neutral"
                }
              >
                {release.state}
              </StatusBadge>
            }
          />
          <Field label="Published" value={formatDate(release.publishedAt)} />
          <Field label="Build" value={release.build} />
          <Field label="Signer" value={release.signer} mono />
          <Field label="Devices" value={release.devices} />
        </div>
      ))}

      {!shown.length && <p className="sg-admin-empty">No releases match the current filters.</p>}
    </>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className={`sg-admin-inventory-field ${mono ? "font-mono" : ""}`}>
      <label>{label}</label>
      <span>{value}</span>
    </div>
  );
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value))
    : "Not available";
}
