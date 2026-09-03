"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/client";

import {
  Activity,
  Check,
  ChevronDown,
  CircleAlert,
  Command,
  Cpu,
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
  Trash2,
  Wifi,
  X,
} from "lucide-react";

/* =========================
   TYPES
========================= */

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

  /* =========================
     SYSTEM
  ========================= */

  os:
    | string
    | null;

  os_version:
    | string
    | null;

  os_build:
    | string
    | null;

  arch:
    | string
    | null;

  manufacturer:
    | string
    | null;

  model:
    | string
    | null;

  serial_number:
    | string
    | null;

  cpu_name:
    | string
    | null;

  /* =========================
     PERFORMANCE
  ========================= */

  cpu_usage:
    | number
    | null;

  ram_usage:
    | number
    | null;

  ram_total_bytes:
    | number
    | null;

  ram_used_bytes:
    | number
    | null;

  disk_usage:
    | number
    | null;

  disk_total_bytes:
    | number
    | null;

  disk_used_bytes:
    | number
    | null;

  uptime_seconds:
    | number
    | null;

  /* =========================
     NETWORK
  ========================= */

  local_ip:
    | string
    | null;

  public_ip:
    | string
    | null;

  mac_address:
    | string
    | null;

  /* =========================
     AGENT
  ========================= */

  status:
    | "online"
    | "offline"
    | "warning";

  agent_id:
    | string
    | null;

  agent_version:
    | string
    | null;

  last_seen:
    | string
    | null;

  /* =========================
     SITE
  ========================= */

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

/* =========================
   COMPONENT
========================= */

export default function DeviceDashboard({
  devices,
  sites,
  canManage,
}: Props) {
  const router =
    useRouter();

  const supabase =
    createClient();

  /* =========================
     DEVICES
  ========================= */

  const [
    deviceList,
    setDeviceList,
  ] =
    useState<Device[]>(
      devices
    );

  const [
    selectedDevice,
    setSelectedDevice,
  ] =
    useState<Device | null>(
      null
    );

  /* =========================
     SYNC DEVICES
  ========================= */

  useEffect(() => {
    setDeviceList(
      devices
    );

    setSelectedDevice(
      (current) => {
        if (!current) {
          return null;
        }

        return (
          devices.find(
            (device) =>
              device.id ===
              current.id
          ) ?? current
        );
      }
    );
  }, [devices]);

  /* =========================
     LIVE CLOCK
  ========================= */

  const [
    now,
    setNow,
  ] = useState(
    Date.now()
  );

  useEffect(() => {
    const interval =
      window.setInterval(
        () => {
          setNow(
            Date.now()
          );
        },
        10_000
      );

    return () => {
      window.clearInterval(
        interval
      );
    };
  }, []);

  /* =========================
     AUTO REFRESH
  ========================= */

  useEffect(() => {
    const interval =
      window.setInterval(
        () => {
          router.refresh();
        },
        30_000
      );

    return () => {
      window.clearInterval(
        interval
      );
    };
  }, [router]);

  /* =========================
     FILTERS
  ========================= */

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
    siteFilterOpen,
    setSiteFilterOpen,
  ] = useState(false);

  const [
    statusFilterOpen,
    setStatusFilterOpen,
  ] = useState(false);

  /* =========================
     ACTION MESSAGE
  ========================= */

  const [
    actionMessage,
    setActionMessage,
  ] = useState("");

  /* =========================
     DELETE
  ========================= */

  const [
    deleteOpen,
    setDeleteOpen,
  ] = useState(false);

  const [
    deletingDevice,
    setDeletingDevice,
  ] = useState(false);

  const [
    deleteError,
    setDeleteError,
  ] = useState("");

  /* =========================
     SITE HELPER
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
     SELECTED STATUS
  ========================= */

  const selectedDeviceStatus =
    selectedDevice
      ? getEffectiveStatus(
          selectedDevice,
          now
        )
      : null;

  /* =========================
     FILTER DEVICES
  ========================= */

  const filteredDevices =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      return deviceList.filter(
        (device) => {
          const site =
            getSite(
              device
            );

          const effectiveStatus =
            getEffectiveStatus(
              device,
              now
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
            device.manufacturer
              ?.toLowerCase()
              .includes(
                query
              ) ||
            device.model
              ?.toLowerCase()
              .includes(
                query
              ) ||
            device.serial_number
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
            effectiveStatus ===
              statusFilter;

          return (
            matchesSearch &&
            matchesSite &&
            matchesStatus
          );
        }
      );
    }, [
      deviceList,
      search,
      siteFilter,
      statusFilter,
      now,
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

  /* =========================
     DELETE DEVICE
  ========================= */

  function openDeleteDevice() {
    if (
      !selectedDevice ||
      !canManage
    ) {
      return;
    }

    setDeleteError("");

    setDeleteOpen(
      true
    );
  }

  function closeDeleteDevice() {
    if (deletingDevice) {
      return;
    }

    setDeleteOpen(
      false
    );

    setDeleteError("");
  }

  async function deleteDevice() {
    if (
      !selectedDevice ||
      !canManage ||
      deletingDevice
    ) {
      return;
    }

    const deviceId =
      selectedDevice.id;

    setDeletingDevice(
      true
    );

    setDeleteError("");

    const {
      error,
    } =
      await supabase
        .from("devices")
        .delete()
        .eq(
          "id",
          deviceId
        );

    if (error) {
      console.error(
        "Could not delete device:",
        error
      );

      setDeleteError(
        "Could not delete this device."
      );

      setDeletingDevice(
        false
      );

      return;
    }

    setDeviceList(
      (current) =>
        current.filter(
          (device) =>
            device.id !==
            deviceId
        )
    );

    setDeletingDevice(
      false
    );

    setDeleteOpen(
      false
    );

    setSelectedDevice(
      null
    );

    setActionMessage("");

    router.refresh();
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

          <button
            type="button"
            onClick={() => {
              setSiteFilterOpen(
                (current) =>
                  !current
              );

              setStatusFilterOpen(
                false
              );
            }}
            className={`flex min-w-[160px] items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition ${
              siteFilterOpen
                ? "border-zinc-600 bg-[#101114]"
                : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
            }`}
          >

            <div className="flex min-w-0 items-center gap-2.5">

              <MapPin
                size={15}
                className="shrink-0 text-zinc-600"
              />

              <span className="max-w-[150px] truncate text-zinc-300">
                {siteFilter ===
                "all"
                  ? "All sites"
                  : sites.find(
                      (site) =>
                        site.id ===
                        siteFilter
                    )?.name ??
                    "All sites"}
              </span>

            </div>

            <ChevronDown
              size={14}
              className={`shrink-0 text-zinc-600 transition-transform duration-200 ${
                siteFilterOpen
                  ? "rotate-180"
                  : ""
              }`}
            />

          </button>

          {siteFilterOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 min-w-full overflow-hidden rounded-xl border border-zinc-800 bg-[#111214] shadow-2xl">

              <button
                type="button"
                onClick={() => {
                  setSiteFilter(
                    "all"
                  );

                  setSiteFilterOpen(
                    false
                  );
                }}
                className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm transition ${
                  siteFilter ===
                  "all"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                }`}
              >

                <div className="flex items-center gap-3">

                  <MapPin
                    size={15}
                    className="text-zinc-600"
                  />

                  <span>
                    All sites
                  </span>

                </div>

                {siteFilter ===
                  "all" && (
                  <Check
                    size={14}
                  />
                )}

              </button>

              {sites.map(
                (site) => (
                  <button
                    key={
                      site.id
                    }
                    type="button"
                    onClick={() => {
                      setSiteFilter(
                        site.id
                      );

                      setSiteFilterOpen(
                        false
                      );
                    }}
                    className={`flex w-full items-center justify-between gap-4 border-t border-zinc-800 px-4 py-3 text-left text-sm transition ${
                      siteFilter ===
                      site.id
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                    }`}
                  >

                    <div className="flex items-center gap-3">

                      <MapPin
                        size={15}
                        className="text-zinc-600"
                      />

                      <span className="whitespace-nowrap">
                        {
                          site.name
                        }
                      </span>

                    </div>

                    {siteFilter ===
                      site.id && (
                      <Check
                        size={14}
                      />
                    )}

                  </button>
                )
              )}

            </div>
          )}

        </div>

        {/* =========================
            STATUS FILTER
        ========================= */}

        <div className="relative">

          <button
            type="button"
            onClick={() => {
              setStatusFilterOpen(
                (current) =>
                  !current
              );

              setSiteFilterOpen(
                false
              );
            }}
            className={`flex min-w-[150px] items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition ${
              statusFilterOpen
                ? "border-zinc-600 bg-[#101114]"
                : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
            }`}
          >

            <div className="flex items-center gap-2.5">

              <span
                className={`h-2 w-2 rounded-full ${
                  statusFilter ===
                  "online"
                    ? "bg-emerald-500"
                    : statusFilter ===
                      "warning"
                    ? "bg-amber-500"
                    : statusFilter ===
                      "offline"
                    ? "bg-zinc-600"
                    : "bg-zinc-500"
                }`}
              />

              <span className="text-zinc-300">
                {statusFilter ===
                "online"
                  ? "Online"
                  : statusFilter ===
                    "offline"
                  ? "Offline"
                  : statusFilter ===
                    "warning"
                  ? "Warning"
                  : "All status"}
              </span>

            </div>

            <ChevronDown
              size={14}
              className={`text-zinc-600 transition-transform duration-200 ${
                statusFilterOpen
                  ? "rotate-180"
                  : ""
              }`}
            />

          </button>

          {statusFilterOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 min-w-[180px] overflow-hidden rounded-xl border border-zinc-800 bg-[#111214] shadow-2xl">

              <StatusFilterOption
                label="All status"
                color="bg-zinc-500"
                active={
                  statusFilter ===
                  "all"
                }
                onClick={() => {
                  setStatusFilter(
                    "all"
                  );

                  setStatusFilterOpen(
                    false
                  );
                }}
              />

              <StatusFilterOption
                label="Online"
                color="bg-emerald-500"
                active={
                  statusFilter ===
                  "online"
                }
                onClick={() => {
                  setStatusFilter(
                    "online"
                  );

                  setStatusFilterOpen(
                    false
                  );
                }}
              />

              <StatusFilterOption
                label="Warning"
                color="bg-amber-500"
                active={
                  statusFilter ===
                  "warning"
                }
                onClick={() => {
                  setStatusFilter(
                    "warning"
                  );

                  setStatusFilterOpen(
                    false
                  );
                }}
              />

              <StatusFilterOption
                label="Offline"
                color="bg-zinc-600"
                active={
                  statusFilter ===
                  "offline"
                }
                onClick={() => {
                  setStatusFilter(
                    "offline"
                  );

                  setStatusFilterOpen(
                    false
                  );
                }}
              />

            </div>
          )}

        </div>

      </div>

      {/* =========================
          RESULT COUNT
      ========================= */}

      <div className="mb-4 flex items-center justify-between">

        <p className="text-xs text-zinc-600">
          Showing{" "}
          {
            filteredDevices.length
          }{" "}
          of{" "}
          {
            deviceList.length
          }{" "}
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

              setSiteFilterOpen(
                false
              );

              setStatusFilterOpen(
                false
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

      {deviceList.length ===
      0 ? (
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

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d0f12]">

          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(150px,1fr)_120px] gap-6 border-b border-zinc-800 bg-[#111214] px-5 py-3 text-xs uppercase tracking-wide text-zinc-600 lg:grid">

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

          <div className="divide-y divide-zinc-800">

            {filteredDevices.map(
              (device) => {
                const site =
                  getSite(
                    device
                  );

                const effectiveStatus =
                  getEffectiveStatus(
                    device,
                    now
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

                      setSiteFilterOpen(
                        false
                      );

                      setStatusFilterOpen(
                        false
                      );
                    }}
                    className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-6 bg-[#0d0f12] px-5 py-4 text-left transition hover:bg-[#15171a] lg:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(150px,1fr)_120px]"
                  >

                    {/* DEVICE */}

                    <div className="flex min-w-0 items-center gap-4">

                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-[#08090b] text-zinc-400">
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

                    <div className="flex flex-col items-end lg:items-start">

                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          effectiveStatus ===
                          "online"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : effectiveStatus ===
                              "warning"
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {effectiveStatus ===
                        "online"
                          ? "Online"
                          : effectiveStatus ===
                            "warning"
                          ? "Warning"
                          : "Offline"}
                      </span>

                      <span className="mt-1.5 text-[11px] text-zinc-600">
                        {device.last_seen
                          ? `Last seen ${getRelativeLastSeen(
                              device.last_seen,
                              now
                            )}`
                          : "Never seen"}
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
              setSelectedDevice(
                null
              )
            }
            className="fixed bottom-0 left-0 right-0 top-16 z-30 bg-black/40 backdrop-blur-[2px]"
          />

          {/* DRAWER */}

          <aside className="fixed bottom-0 right-0 top-16 z-40 w-full overflow-y-auto border-l border-zinc-800 bg-[#070809] shadow-2xl sm:w-[580px]">

            {/* =========================
                HEADER
            ========================= */}

            <div className="sticky top-0 z-20 border-b border-zinc-800 bg-[#070809]/95 px-5 py-4 backdrop-blur">

              <div className="flex items-center justify-between gap-5">

                <div className="flex min-w-0 items-center gap-4">

                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400">

                    <Monitor
                      size={19}
                    />

                  </div>

                  <div className="min-w-0">

                    <h2 className="truncate text-lg font-semibold text-white">
                      {selectedDevice.display_name ||
                        selectedDevice.hostname}
                    </h2>

                    <p className="mt-0.5 truncate text-sm text-zinc-600">
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
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-zinc-900 hover:text-white"
                >
                  <X
                    size={18}
                  />
                </button>

              </div>

            </div>

            {/* =========================
                DRAWER CONTENT
            ========================= */}

            <div className="p-5">

              {/* =========================
                  STATUS
              ========================= */}

              <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-[#111317] px-4 py-3.5">

                <div>

                  <div className="flex items-center gap-2">

                    <span
                      className={`h-2 w-2 rounded-full ${
                        selectedDeviceStatus ===
                        "online"
                          ? "bg-emerald-400"
                          : selectedDeviceStatus ===
                            "warning"
                          ? "bg-amber-400"
                          : "bg-zinc-600"
                      }`}
                    />

                    <span
                      className={`text-sm font-semibold ${
                        selectedDeviceStatus ===
                        "online"
                          ? "text-emerald-400"
                          : selectedDeviceStatus ===
                            "warning"
                          ? "text-amber-400"
                          : "text-zinc-400"
                      }`}
                    >
                      {selectedDeviceStatus ===
                      "online"
                        ? "Online"
                        : selectedDeviceStatus ===
                          "warning"
                        ? "Warning"
                        : "Offline"}
                    </span>

                  </div>

                  <p className="mt-1 text-xs text-zinc-600">
                    {selectedDevice.last_seen
                      ? `Last seen ${getRelativeLastSeen(
                          selectedDevice.last_seen,
                          now
                        )}`
                      : "Never seen"}
                  </p>

                </div>

                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                    selectedDeviceStatus ===
                    "online"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : selectedDeviceStatus ===
                        "warning"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-zinc-900 text-zinc-600"
                  }`}
                >
                  <Wifi
                    size={17}
                  />
                </div>

              </div>

              {/* =========================
                  QUICK ACTIONS
              ========================= */}

              {canManage && (
                <div className="mt-5">

                  <div className="mb-3">

                    <h3 className="text-sm font-semibold text-white">
                      Quick actions
                    </h3>

                    <p className="mt-0.5 text-xs text-zinc-600">
                      Manage this endpoint remotely.
                    </p>

                  </div>

                  <div className="grid grid-cols-2 gap-2.5">

                    <QuickActionButton
                      icon={
                        <ExternalLink
                          size={17}
                        />
                      }
                      label="Remote Desktop"
                      onClick={() =>
                        runAction(
                          "Remote Desktop"
                        )
                      }
                    />

                    <QuickActionButton
                      icon={
                        <Terminal
                          size={17}
                        />
                      }
                      label="PowerShell"
                      onClick={() =>
                        runAction(
                          "PowerShell"
                        )
                      }
                    />

                    <QuickActionButton
                      icon={
                        <Command
                          size={17}
                        />
                      }
                      label="CMD"
                      onClick={() =>
                        runAction(
                          "CMD"
                        )
                      }
                    />

                    <QuickActionButton
                      icon={
                        <RotateCcw
                          size={17}
                        />
                      }
                      label="Restart"
                      onClick={() =>
                        runAction(
                          "Restart"
                        )
                      }
                    />

                  </div>

                  {actionMessage && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-zinc-800 bg-[#111317] px-3.5 py-3 text-xs text-zinc-500">

                      <CircleAlert
                        size={14}
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
                  DEVICE DETAILS
              ========================= */}

              <div className="mt-6">

                <div className="mb-3">

                  <h3 className="text-sm font-semibold text-white">
                    Device details
                  </h3>

                  <p className="mt-0.5 text-xs text-zinc-600">
                    Hardware, system and Agent information.
                  </p>

                </div>

                <div className="divide-y divide-zinc-800 overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d0f12]">

                  {/* =========================
                      PERFORMANCE
                  ========================= */}

                  <DrawerSection
                    title="Performance"
                    subtitle="CPU, memory and disk usage"
                    icon={
                      <Activity
                        size={17}
                      />
                    }
                  >

                    <div className="grid grid-cols-3 gap-2.5">

                      <MetricCard
                        icon={
                          <Cpu
                            size={15}
                          />
                        }
                        label="CPU"
                        value={
                          formatPercentage(
                            selectedDevice.cpu_usage
                          )
                        }
                        percentage={
                          selectedDevice.cpu_usage
                        }
                      />

                      <MetricCard
                        icon={
                          <MemoryStick
                            size={15}
                          />
                        }
                        label="RAM"
                        value={
                          formatPercentage(
                            selectedDevice.ram_usage
                          )
                        }
                        detail={
                          formatUsedTotal(
                            selectedDevice.ram_used_bytes,
                            selectedDevice.ram_total_bytes
                          )
                        }
                        percentage={
                          selectedDevice.ram_usage
                        }
                      />

                      <MetricCard
                        icon={
                          <HardDrive
                            size={15}
                          />
                        }
                        label="Disk"
                        value={
                          formatPercentage(
                            selectedDevice.disk_usage
                          )
                        }
                        detail={
                          formatUsedTotal(
                            selectedDevice.disk_used_bytes,
                            selectedDevice.disk_total_bytes
                          )
                        }
                        percentage={
                          selectedDevice.disk_usage
                        }
                      />

                    </div>

                  </DrawerSection>

                  {/* =========================
                      SYSTEM
                  ========================= */}

                  <DrawerSection
                    title="System information"
                    subtitle="Operating system and hardware"
                    icon={
                      <Monitor
                        size={17}
                      />
                    }
                  >

                    <div className="overflow-hidden rounded-xl border border-zinc-800">

                      <InfoRow
                        icon={
                          <Monitor
                            size={15}
                          />
                        }
                        label="Operating system"
                        value={
                          selectedDevice.os ||
                          "Unknown"
                        }
                      />

                      <InfoRow
                        icon={
                          <Activity
                            size={15}
                          />
                        }
                        label="Version"
                        value={
                          selectedDevice.os_version ||
                          "—"
                        }
                      />

                      <InfoRow
                        icon={
                          <Server
                            size={15}
                          />
                        }
                        label="Build"
                        value={
                          selectedDevice.os_build ||
                          "—"
                        }
                      />

                      <InfoRow
                        icon={
                          <Server
                            size={15}
                          />
                        }
                        label="Architecture"
                        value={
                          formatArchitecture(
                            selectedDevice.arch
                          )
                        }
                      />

                      <InfoRow
                        icon={
                          <Server
                            size={15}
                          />
                        }
                        label="Manufacturer"
                        value={
                          selectedDevice.manufacturer ||
                          "—"
                        }
                      />

                      <InfoRow
                        icon={
                          <Monitor
                            size={15}
                          />
                        }
                        label="Model"
                        value={
                          selectedDevice.model ||
                          "—"
                        }
                      />

                      <InfoRow
                        icon={
                          <ShieldCheck
                            size={15}
                          />
                        }
                        label="Serial"
                        value={
                          selectedDevice.serial_number ||
                          "—"
                        }
                      />

                      <InfoRow
                        icon={
                          <Cpu
                            size={15}
                          />
                        }
                        label="Processor"
                        value={
                          selectedDevice.cpu_name ||
                          "—"
                        }
                      />

                      <InfoRow
                        icon={
                          <MemoryStick
                            size={15}
                          />
                        }
                        label="Memory"
                        value={
                          formatBytes(
                            selectedDevice.ram_total_bytes
                          )
                        }
                      />

                      <InfoRow
                        icon={
                          <Activity
                            size={15}
                          />
                        }
                        label="Uptime"
                        value={
                          formatUptime(
                            selectedDevice.uptime_seconds
                          )
                        }
                      />

                    </div>

                  </DrawerSection>

                  {/* =========================
                      NETWORK
                  ========================= */}

                  <DrawerSection
                    title="Network"
                    subtitle={
                      selectedDevice.local_ip ||
                      "Network information"
                    }
                    icon={
                      <Network
                        size={17}
                      />
                    }
                  >

                    <div className="overflow-hidden rounded-xl border border-zinc-800">

                      <InfoRow
                        icon={
                          <Network
                            size={15}
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
                            size={15}
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
                            size={15}
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
                            size={15}
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

                    </div>

                  </DrawerSection>

                  {/* =========================
                      AGENT
                  ========================= */}

                  <DrawerSection
                    title="SentinelGrid Agent"
                    subtitle={
                      selectedDevice.agent_version
                        ? `Version ${selectedDevice.agent_version}`
                        : "Agent information"
                    }
                    icon={
                      <ShieldCheck
                        size={17}
                      />
                    }
                  >

                    <div className="overflow-hidden rounded-xl border border-zinc-800">

                      <InfoRow
                        icon={
                          <ShieldCheck
                            size={15}
                          />
                        }
                        label="Version"
                        value={
                          selectedDevice.agent_version
                            ? `v${selectedDevice.agent_version}`
                            : "—"
                        }
                      />

                      <InfoRow
                        icon={
                          <Server
                            size={15}
                          />
                        }
                        label="Agent ID"
                        value={
                          selectedDevice.agent_id ||
                          "Not registered"
                        }
                      />

                      <InfoRow
                        icon={
                          <Activity
                            size={15}
                          />
                        }
                        label="Last communication"
                        value={
                          selectedDevice.last_seen
                            ? new Date(
                                selectedDevice.last_seen
                              ).toLocaleString()
                            : "Never"
                        }
                      />

                    </div>

                  </DrawerSection>

                </div>

              </div>

              {/* =========================
                  DELETE DEVICE
              ========================= */}

              {canManage && (
                <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-5">

                  <div>

                    <p className="text-sm font-medium text-zinc-300">
                      Remove device
                    </p>

                    <p className="mt-0.5 text-xs text-zinc-600">
                      Permanently remove this endpoint.
                    </p>

                  </div>

                  <button
                    type="button"
                    onClick={
                      openDeleteDevice
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-red-950 bg-[#120b0d] px-3.5 py-2 text-sm font-medium text-red-400 transition hover:border-red-900 hover:bg-red-950/30 hover:text-red-300"
                  >

                    <Trash2
                      size={14}
                    />

                    Delete

                  </button>

                </div>
              )}

            </div>

          </aside>

        </>
      )}

      {/* =========================
          DELETE MODAL
      ========================= */}

      {deleteOpen &&
        selectedDevice && (
        <>

          <button
            type="button"
            aria-label="Close delete confirmation"
            onClick={
              closeDeleteDevice
            }
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
          />

          <div className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d0f12] shadow-2xl">

            {/* HEADER */}

            <div className="flex items-start justify-between gap-5 border-b border-zinc-800 px-6 py-5">

              <div className="flex items-start gap-4">

                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-950 bg-[#160c0f] text-red-500">

                  <Trash2
                    size={17}
                  />

                </div>

                <div>

                  <h2 className="font-semibold">
                    Delete device?
                  </h2>

                  <p className="mt-1 text-sm text-zinc-500">
                    This action cannot be undone.
                  </p>

                </div>

              </div>

              <button
                type="button"
                onClick={
                  closeDeleteDevice
                }
                disabled={
                  deletingDevice
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-900 hover:text-white disabled:opacity-50"
              >
                <X
                  size={18}
                />
              </button>

            </div>

            {/* CONTENT */}

            <div className="p-6">

              <p className="text-sm leading-6 text-zinc-400">
                You are about to remove{" "}

                <span className="font-medium text-white">
                  {selectedDevice.display_name ||
                    selectedDevice.hostname}
                </span>{" "}

                from SentinelGrid.
              </p>

              <div className="mt-5 rounded-xl border border-red-950 bg-[#120b0d] px-4 py-3">

                <div className="flex items-start gap-3">

                  <CircleAlert
                    size={17}
                    className="mt-0.5 shrink-0 text-red-500"
                  />

                  <p className="text-xs leading-5 text-red-300">
                    The device record and its SentinelGrid agent credentials will be removed.
                  </p>

                </div>

              </div>

              {deleteError && (
                <div className="mt-4 rounded-xl border border-red-950 bg-[#120b0d] px-4 py-3 text-sm text-red-400">
                  {
                    deleteError
                  }
                </div>
              )}

            </div>

            {/* FOOTER */}

            <div className="flex justify-end gap-3 border-t border-zinc-800 px-6 py-5">

              <button
                type="button"
                onClick={
                  closeDeleteDevice
                }
                disabled={
                  deletingDevice
                }
                className="rounded-xl border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  deleteDevice
                }
                disabled={
                  deletingDevice
                }
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >

                <Trash2
                  size={15}
                />

                {deletingDevice
                  ? "Deleting..."
                  : "Delete device"}

              </button>

            </div>

          </div>

        </>
      )}
    </>
  );
}

/* =========================
   QUICK ACTION BUTTON
========================= */

function QuickActionButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className="group flex h-12 items-center gap-3 rounded-xl border border-zinc-800 bg-[#111317] px-4 text-left transition hover:border-zinc-700 hover:bg-[#17191d]"
    >

      <span className="text-zinc-500 transition group-hover:text-white">
        {icon}
      </span>

      <span className="truncate text-sm font-medium text-zinc-200 transition group-hover:text-white">
        {label}
      </span>

    </button>
  );
}

/* =========================
   DRAWER SECTION
========================= */

function DrawerSection({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const [
    open,
    setOpen,
  ] = useState(false);

  return (
    <div>

      <button
        type="button"
        onClick={() =>
          setOpen(
            (current) =>
              !current
          )
        }
        className="group flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition hover:bg-[#121417]"
      >

        <div className="flex min-w-0 items-center gap-3">

          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-500 transition group-hover:text-zinc-300">
            {icon}
          </div>

          <div className="min-w-0">

            <p className="text-sm font-medium text-zinc-200">
              {title}
            </p>

            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-zinc-600">
                {subtitle}
              </p>
            )}

          </div>

        </div>

        <ChevronDown
          size={15}
          className={`shrink-0 text-zinc-600 transition-transform duration-200 group-hover:text-zinc-400 ${
            open
              ? "rotate-180"
              : ""
          }`}
        />

      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open
            ? "grid-rows-[1fr]"
            : "grid-rows-[0fr]"
        }`}
      >

        <div className="overflow-hidden">

          <div className="border-t border-zinc-800 bg-[#090b0d] p-4">
            {
              children
            }
          </div>

        </div>

      </div>

    </div>
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
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-zinc-800 bg-[#0d0f12] px-4 py-3 last:border-b-0">

      <div className="flex shrink-0 items-center gap-3 text-zinc-600">

        {icon}

        <span className="text-sm">
          {label}
        </span>

      </div>

      <span
        title={value}
        className="min-w-0 max-w-[60%] truncate text-right text-sm text-zinc-300"
      >
        {value}
      </span>

    </div>
  );
}

/* =========================
   METRIC CARD
========================= */

function MetricCard({
  icon,
  label,
  value,
  detail,
  percentage,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  percentage:
    | number
    | null;
}) {
  const safePercentage =
    percentage ===
      null ||
    percentage ===
      undefined ||
    !Number.isFinite(
      percentage
    )
      ? null
      : Math.min(
          100,
          Math.max(
            0,
            percentage
          )
        );

  return (
    <div className="min-w-0 rounded-xl border border-zinc-800 bg-[#111317] p-3">

      <div className="flex items-center gap-2 text-zinc-600">

        {icon}

        <span className="text-[11px]">
          {label}
        </span>

      </div>

      <p className="mt-2 text-lg font-semibold text-white">
        {value}
      </p>

      {detail && (
        <p
          title={detail}
          className="mt-0.5 truncate text-[10px] text-zinc-600"
        >
          {detail}
        </p>
      )}

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-800">

        {safePercentage !==
          null && (
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              safePercentage >=
              90
                ? "bg-red-500"
                : safePercentage >=
                  75
                ? "bg-amber-500"
                : "bg-emerald-500"
            }`}
            style={{
              width: `${safePercentage}%`,
            }}
          />
        )}

      </div>

    </div>
  );
}

/* =========================
   STATUS FILTER OPTION
========================= */

function StatusFilterOption({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`flex w-full items-center justify-between gap-5 border-b border-zinc-800 px-4 py-3 text-left text-sm transition last:border-b-0 ${
        active
          ? "bg-zinc-800 text-white"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
      }`}
    >

      <div className="flex items-center gap-3">

        <span
          className={`h-2 w-2 rounded-full ${color}`}
        />

        <span>
          {label}
        </span>

      </div>

      {active && (
        <Check
          size={14}
          className="text-zinc-300"
        />
      )}

    </button>
  );
}

/* =========================
   LAST SEEN
========================= */

function getRelativeLastSeen(
  lastSeen: string | null,
  now: number
) {
  if (!lastSeen) {
    return "never";
  }

  const lastSeenTime =
    new Date(
      lastSeen
    ).getTime();

  if (
    Number.isNaN(
      lastSeenTime
    )
  ) {
    return "unknown";
  }

  const diff =
    Math.max(
      0,
      now -
        lastSeenTime
    );

  const seconds =
    Math.floor(
      diff / 1000
    );

  if (seconds < 10) {
    return "just now";
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  if (minutes < 60) {
    return minutes === 1
      ? "1 min ago"
      : `${minutes} min ago`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    return hours === 1
      ? "1h ago"
      : `${hours}h ago`;
  }

  const days =
    Math.floor(
      hours / 24
    );

  return days === 1
    ? "1d ago"
    : `${days}d ago`;
}

/* =========================
   EFFECTIVE STATUS
========================= */

function getEffectiveStatus(
  device: Device,
  now: number
):
  | "online"
  | "offline"
  | "warning" {
  if (!device.last_seen) {
    return "offline";
  }

  const lastSeen =
    new Date(
      device.last_seen
    ).getTime();

  if (
    Number.isNaN(
      lastSeen
    )
  ) {
    return "offline";
  }

  const diff =
    now -
    lastSeen;

  /*
    Heartbeat = 30 seconds.
    Three missed heartbeats = offline.
  */

  if (
    diff >
    90_000
  ) {
    return "offline";
  }

  return device.status;
}

/* =========================
   FORMAT PERCENTAGE
========================= */

function formatPercentage(
  value:
    | number
    | null
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      value
    )
  ) {
    return "—";
  }

  return `${Math.round(
    value
  )}%`;
}

/* =========================
   FORMAT BYTES
========================= */

function formatBytes(
  bytes:
    | number
    | null
) {
  if (
    bytes === null ||
    bytes === undefined ||
    !Number.isFinite(
      bytes
    ) ||
    bytes < 0
  ) {
    return "—";
  }

  if (bytes === 0) {
    return "0 B";
  }

  const tb =
    bytes /
    1024 /
    1024 /
    1024 /
    1024;

  if (tb >= 1) {
    return `${tb.toFixed(
      2
    )} TB`;
  }

  const gb =
    bytes /
    1024 /
    1024 /
    1024;

  if (gb >= 1) {
    return `${gb.toFixed(
      1
    )} GB`;
  }

  const mb =
    bytes /
    1024 /
    1024;

  if (mb >= 1) {
    return `${mb.toFixed(
      0
    )} MB`;
  }

  const kb =
    bytes /
    1024;

  return `${kb.toFixed(
    0
  )} KB`;
}

/* =========================
   USED / TOTAL
========================= */

function formatUsedTotal(
  used:
    | number
    | null,
  total:
    | number
    | null
) {
  if (
    used === null ||
    used === undefined ||
    total === null ||
    total === undefined
  ) {
    return "";
  }

  return `${formatBytes(
    used
  )} / ${formatBytes(
    total
  )}`;
}

/* =========================
   UPTIME
========================= */

function formatUptime(
  seconds:
    | number
    | null
) {
  if (
    seconds === null ||
    seconds === undefined ||
    !Number.isFinite(
      seconds
    ) ||
    seconds < 0
  ) {
    return "—";
  }

  const days =
    Math.floor(
      seconds /
        86400
    );

  const hours =
    Math.floor(
      (seconds %
        86400) /
        3600
    );

  const minutes =
    Math.floor(
      (seconds %
        3600) /
        60
    );

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return "< 1m";
}

/* =========================
   ARCHITECTURE
========================= */

function formatArchitecture(
  arch:
    | string
    | null
) {
  if (!arch) {
    return "—";
  }

  switch (
    arch.toLowerCase()
  ) {
    case "amd64":
      return "64-bit (x64)";

    case "386":
      return "32-bit (x86)";

    case "arm64":
      return "64-bit (ARM)";

    default:
      return arch;
  }
}