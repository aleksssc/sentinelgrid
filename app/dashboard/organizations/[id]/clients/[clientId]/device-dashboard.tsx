"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  ChevronDown,
  CircleAlert,
  Command,
  ExternalLink,
  HardDrive,
  MapPin,
  MemoryStick,
  Monitor,
  Network,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  Wifi,
  X,
} from "lucide-react";

type Site = {
  id: string;
  name: string;
};

type Device = {
  id: string;

  hostname: string;

  display_name:
    | string
    | null;

  os:
    | string
    | null;

  os_version:
    | string
    | null;

  local_ip:
    | string
    | null;

  public_ip:
    | string
    | null;

  mac_address:
    | string
    | null;

  status:
    | "online"
    | "offline"
    | "warning";

  agent_id:
    | string
    | null;

  last_seen:
    | string
    | null;

  site_id:
    | string
    | null;

  sites:
    | Site
    | Site[]
    | null;
};

type Props = {
  devices: Device[];

  sites: Site[];

  canManage: boolean;
};

export default function DeviceDashboard({
  devices,
  sites,
  canManage,
}: Props) {
  const [
    search,
    setSearch,
  ] = useState("");

  const [
    siteFilter,
    setSiteFilter,
  ] = useState("all");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("all");

  const [
    selectedDevice,
    setSelectedDevice,
  ] =
    useState<Device | null>(
      null
    );

  const [
    actionMessage,
    setActionMessage,
  ] = useState("");

  /* =========================
     HELPERS
  ========================= */

  function getSite(
    device: Device
  ): Site | null {
    if (!device.sites) {
      return null;
    }

    if (
      Array.isArray(
        device.sites
      )
    ) {
      return (
        device.sites[0] ??
        null
      );
    }

    return device.sites;
  }

  /* =========================
     FILTERED DEVICES
  ========================= */

  const filteredDevices =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      return devices.filter(
        (device) => {
          const site =
            getSite(
              device
            );

          const matchesSearch =
            !query ||
            device.hostname
              .toLowerCase()
              .includes(
                query
              ) ||
            device.display_name
              ?.toLowerCase()
              .includes(
                query
              ) ||
            device.local_ip
              ?.toLowerCase()
              .includes(
                query
              ) ||
            device.public_ip
              ?.toLowerCase()
              .includes(
                query
              ) ||
            device.os
              ?.toLowerCase()
              .includes(
                query
              ) ||
            site?.name
              .toLowerCase()
              .includes(
                query
              );

          const matchesSite =
            siteFilter ===
              "all" ||
            device.site_id ===
              siteFilter ||
            site?.id ===
              siteFilter;

          const matchesStatus =
            statusFilter ===
              "all" ||
            device.status ===
              statusFilter;

          return (
            matchesSearch &&
            matchesSite &&
            matchesStatus
          );
        }
      );
    }, [
      devices,
      search,
      siteFilter,
      statusFilter,
    ]);

  /* =========================
     ACTION PLACEHOLDER
  ========================= */

  function runAction(
    action: string
  ) {
    if (!canManage) {
      return;
    }

    setActionMessage(
      `${action} is ready for the SentinelGrid Agent integration.`
    );
  }

  return (
    <>
      {/* =========================
          TOOLBAR
      ========================= */}

      <div className="mb-5 flex flex-wrap items-center gap-3">

        {/* SEARCH */}

        <div className="relative min-w-64 flex-1">

          <Search
            size={17}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600"
          />

          <input
            type="text"
            placeholder="Search devices..."
            value={search}
            onChange={(e) =>
              setSearch(
                e.target.value
              )
            }
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-600 hover:border-zinc-700 focus:border-zinc-600"
          />

        </div>

        {/* =========================
            SITE FILTER
        ========================= */}

        <div className="relative">

          <MapPin
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
          />

          <select
            value={siteFilter}
            onChange={(e) =>
              setSiteFilter(
                e.target.value
              )
            }
            className="appearance-none rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 pl-9 pr-10 text-sm text-zinc-300 outline-none transition hover:border-zinc-700 focus:border-zinc-600"
          >
            <option value="all">
              All sites
            </option>

            {sites.map(
              (site) => (
                <option
                  key={
                    site.id
                  }
                  value={
                    site.id
                  }
                >
                  {site.name}
                </option>
              )
            )}

          </select>

          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600"
          />

        </div>

        {/* =========================
            STATUS FILTER
        ========================= */}

        <div className="relative">

          <select
            value={
              statusFilter
            }
            onChange={(e) =>
              setStatusFilter(
                e.target.value
              )
            }
            className="appearance-none rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 pl-4 pr-10 text-sm text-zinc-300 outline-none transition hover:border-zinc-700 focus:border-zinc-600"
          >
            <option value="all">
              All status
            </option>

            <option value="online">
              Online
            </option>

            <option value="offline">
              Offline
            </option>

            <option value="warning">
              Warning
            </option>
          </select>

          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600"
          />

        </div>

      </div>

      {/* =========================
          RESULT COUNT
      ========================= */}

      <div className="mb-4 flex items-center justify-between">

        <p className="text-xs text-zinc-600">
          Showing{" "}
          {filteredDevices.length}{" "}
          of{" "}
          {devices.length}{" "}
          devices
        </p>

        {(search ||
          siteFilter !==
            "all" ||
          statusFilter !==
            "all") && (
          <button
            type="button"
            onClick={() => {
              setSearch("");

              setSiteFilter(
                "all"
              );

              setStatusFilter(
                "all"
              );
            }}
            className="text-xs text-zinc-500 transition hover:text-white"
          >
            Clear filters
          </button>
        )}

      </div>

      {/* =========================
          EMPTY
      ========================= */}

      {devices.length === 0 ? (

        <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-800 px-6 py-16 text-center">

          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-500">
            <Monitor
              size={21}
            />
          </div>

          <h3 className="mt-5 font-semibold">
            No devices registered
          </h3>

          <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-500">
            Devices will appear here once a SentinelGrid agent is deployed and linked to this client.
          </p>

          {sites.length > 0 && (
            <p className="mt-3 text-xs text-zinc-600">
              {sites.length}{" "}
              {sites.length === 1
                ? "site is"
                : "sites are"}{" "}
              currently configured for this client.
            </p>
          )}

        </div>

      ) : filteredDevices.length ===
        0 ? (

        <div className="rounded-2xl border border-dashed border-zinc-800 px-6 py-12 text-center">

          <Search
            size={22}
            className="mx-auto text-zinc-600"
          />

          <h3 className="mt-4 font-medium">
            No devices found
          </h3>

          <p className="mt-2 text-sm text-zinc-500">
            Try changing your search or filters.
          </p>

        </div>

      ) : (

        /* =========================
            DEVICE TABLE
        ========================= */

        <div className="overflow-hidden rounded-2xl border border-zinc-800">

          {/* HEADER */}

          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(150px,1fr)_120px] gap-6 border-b border-zinc-800 bg-zinc-900 px-5 py-3 text-xs uppercase tracking-wide text-zinc-600 lg:grid">

            <span>
              Device
            </span>

            <span>
              Site
            </span>

            <span>
              Operating System
            </span>

            <span>
              Status
            </span>

          </div>

          {/* ROWS */}

          <div className="divide-y divide-zinc-800">

            {filteredDevices.map(
              (device) => {
                const site =
                  getSite(
                    device
                  );

                return (
                  <button
                    key={
                      device.id
                    }
                    type="button"
                    onClick={() => {
                      setSelectedDevice(
                        device
                      );

                      setActionMessage(
                        ""
                      );
                    }}
                    className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-5 py-4 text-left transition hover:bg-zinc-800/50 lg:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(150px,1fr)_120px]"
                  >

                    {/* DEVICE */}

                    <div className="flex min-w-0 items-center gap-4">

                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400">
                        <Monitor
                          size={18}
                        />
                      </div>

                      <div className="min-w-0">

                        <p className="truncate text-sm font-medium text-zinc-100">
                          {device.display_name ||
                            device.hostname}
                        </p>

                        <p className="mt-1 truncate text-xs text-zinc-500">
                          {
                            device.hostname
                          }

                          {device.local_ip
                            ? ` · ${device.local_ip}`
                            : ""}
                        </p>

                      </div>

                    </div>

                    {/* SITE */}

                    <p className="hidden truncate text-sm text-zinc-400 lg:block">
                      {site?.name ||
                        "No site"}
                    </p>

                    {/* OS */}

                    <p className="hidden truncate text-sm text-zinc-400 lg:block">

                      {device.os
                        ? `${device.os}${
                            device.os_version
                              ? ` ${device.os_version}`
                              : ""
                          }`
                        : "Unknown OS"}

                    </p>

                    {/* STATUS */}

                    <div className="flex justify-end lg:justify-start">

                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          device.status ===
                          "online"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : device.status ===
                              "warning"
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {device.status ===
                        "online"
                          ? "Online"
                          : device.status ===
                            "warning"
                          ? "Warning"
                          : "Offline"}
                      </span>

                    </div>

                  </button>
                );
              }
            )}

          </div>

        </div>

      )}

      {/* =========================
          DEVICE DRAWER
      ========================= */}

      {selectedDevice && (
        <>

      {/* OVERLAY */}

      <button
        type="button"
        aria-label="Close device"
        onClick={() =>
          setSelectedDevice(null)
        }
        className="fixed bottom-0 left-0 right-0 top-16 z-30 bg-black/40 backdrop-blur-[2px]"
      />

      {/* DRAWER */}

      <aside className="fixed bottom-0 right-0 top-16 z-40 w-full overflow-y-auto border-l border-zinc-800 bg-zinc-950 shadow-2xl sm:w-[520px]">
            {/* HEADER */}

            <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-6 py-5 backdrop-blur">

              <div className="flex items-start justify-between gap-5">

                <div className="flex min-w-0 items-start gap-4">

                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400">
                    <Monitor
                      size={19}
                    />
                  </div>

                  <div className="min-w-0">

                    <h2 className="truncate text-lg font-semibold">
                      {selectedDevice.display_name ||
                        selectedDevice.hostname}
                    </h2>

                    <p className="mt-1 truncate text-sm text-zinc-500">
                      {
                        selectedDevice.hostname
                      }
                    </p>

                  </div>

                </div>

                <button
                  type="button"
                  onClick={() =>
                    setSelectedDevice(
                      null
                    )
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-900 hover:text-white"
                >
                  <X
                    size={18}
                  />
                </button>

              </div>

            </div>

            <div className="space-y-6 p-6">

              {/* STATUS */}

              <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4">

                <div>

                  <p className="text-xs text-zinc-600">
                    Device status
                  </p>

                  <div className="mt-2 flex items-center gap-2">

                    <span
                      className={`h-2 w-2 rounded-full ${
                        selectedDevice.status ===
                        "online"
                          ? "bg-emerald-400"
                          : selectedDevice.status ===
                            "warning"
                          ? "bg-amber-400"
                          : "bg-zinc-600"
                      }`}
                    />

                    <span className="text-sm font-medium capitalize">
                      {
                        selectedDevice.status
                      }
                    </span>

                  </div>

                </div>

                <Wifi
                  size={19}
                  className={
                    selectedDevice.status ===
                    "online"
                      ? "text-emerald-500"
                      : "text-zinc-700"
                  }
                />

              </div>

              {/* =========================
                  QUICK ACTIONS
                  OWNER + ADMIN ONLY
              ========================= */}

              {canManage && (
                <div>

                  <h3 className="text-sm font-semibold">
                    Quick actions
                  </h3>

                  <p className="mt-1 text-xs text-zinc-600">
                    Remote management tools for this endpoint.
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-3">

                    <button
                      type="button"
                      onClick={() =>
                        runAction(
                          "Remote Desktop"
                        )
                      }
                      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left transition hover:border-zinc-700 hover:bg-zinc-800"
                    >
                      <ExternalLink
                        size={18}
                      />

                      <span className="text-sm font-medium">
                        Remote Desktop
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        runAction(
                          "PowerShell"
                        )
                      }
                      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left transition hover:border-zinc-700 hover:bg-zinc-800"
                    >
                      <Terminal
                        size={18}
                      />

                      <span className="text-sm font-medium">
                        PowerShell
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        runAction(
                          "CMD"
                        )
                      }
                      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left transition hover:border-zinc-700 hover:bg-zinc-800"
                    >
                      <Command
                        size={18}
                      />

                      <span className="text-sm font-medium">
                        CMD
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        runAction(
                          "Restart"
                        )
                      }
                      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left transition hover:border-zinc-700 hover:bg-zinc-800"
                    >
                      <RotateCcw
                        size={18}
                      />

                      <span className="text-sm font-medium">
                        Restart
                      </span>
                    </button>

                  </div>

                  {actionMessage && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-xs text-zinc-500">

                      <CircleAlert
                        size={15}
                        className="mt-0.5 shrink-0"
                      />

                      {
                        actionMessage
                      }

                    </div>
                  )}

                </div>
              )}

              {/* =========================
                  SYSTEM INFO
              ========================= */}

              <div>

                <h3 className="mb-4 text-sm font-semibold">
                  System information
                </h3>

                <div className="overflow-hidden rounded-xl border border-zinc-800">

                  <InfoRow
                    icon={
                      <Monitor
                        size={16}
                      />
                    }
                    label="Operating system"
                    value={
                      selectedDevice.os
                        ? `${selectedDevice.os}${
                            selectedDevice.os_version
                              ? ` ${selectedDevice.os_version}`
                              : ""
                          }`
                        : "Unknown"
                    }
                  />

                  <InfoRow
                    icon={
                      <Network
                        size={16}
                      />
                    }
                    label="Local IP"
                    value={
                      selectedDevice.local_ip ||
                      "—"
                    }
                  />

                  <InfoRow
                    icon={
                      <Wifi
                        size={16}
                      />
                    }
                    label="Public IP"
                    value={
                      selectedDevice.public_ip ||
                      "—"
                    }
                  />

                  <InfoRow
                    icon={
                      <Server
                        size={16}
                      />
                    }
                    label="MAC address"
                    value={
                      selectedDevice.mac_address ||
                      "—"
                    }
                  />

                  <InfoRow
                    icon={
                      <MapPin
                        size={16}
                      />
                    }
                    label="Site"
                    value={
                      getSite(
                        selectedDevice
                      )?.name ||
                      "No site"
                    }
                  />

                  <InfoRow
                    icon={
                      <ShieldCheck
                        size={16}
                      />
                    }
                    label="Agent ID"
                    value={
                      selectedDevice.agent_id ||
                      "Not registered"
                    }
                  />

                </div>

              </div>

              {/* =========================
                  PERFORMANCE
              ========================= */}

              <div>

                <h3 className="mb-4 text-sm font-semibold">
                  Performance
                </h3>

                <div className="grid grid-cols-3 gap-3">

                  <MetricCard
                    icon={
                      <Server
                        size={16}
                      />
                    }
                    label="CPU"
                    value="—"
                  />

                  <MetricCard
                    icon={
                      <MemoryStick
                        size={16}
                      />
                    }
                    label="RAM"
                    value="—"
                  />

                  <MetricCard
                    icon={
                      <HardDrive
                        size={16}
                      />
                    }
                    label="Disk"
                    value="—"
                  />

                </div>

              </div>

              {/* =========================
                  LAST SEEN
              ========================= */}

              <div className="border-t border-zinc-800 pt-5">

                <p className="text-xs text-zinc-600">
                  Last seen
                </p>

                <p className="mt-1 text-sm text-zinc-400">
                  {selectedDevice.last_seen
                    ? new Date(
                        selectedDevice.last_seen
                      ).toLocaleString()
                    : "Never"}
                </p>

              </div>

            </div>

          </aside>

        </>
      )}
    </>
  );
}

/* =========================
   INFO ROW
========================= */

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-zinc-800 px-4 py-3.5 last:border-b-0">

      <div className="flex items-center gap-3 text-zinc-500">
        {icon}

        <span className="text-sm">
          {label}
        </span>
      </div>

      <span className="max-w-[55%] truncate text-right text-sm text-zinc-300">
        {value}
      </span>

    </div>
  );
}

/* =========================
   METRIC
========================= */

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">

      <div className="flex items-center gap-2 text-zinc-600">
        {icon}

        <span className="text-xs">
          {label}
        </span>
      </div>

      <p className="mt-3 text-xl font-semibold">
        {value}
      </p>

    </div>
  );
}