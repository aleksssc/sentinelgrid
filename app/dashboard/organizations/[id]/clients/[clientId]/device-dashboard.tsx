"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/client";

import {
  Check,
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
     LOCAL DEVICES
  ========================= */

  const [
    deviceList,
    setDeviceList,
  ] =
    useState<Device[]>(
      devices
    );

  /*
    When router.refresh() gets fresh data
    from the server, update our local list.
  */

  useEffect(() => {
    setDeviceList(
      devices
    );

    /*
      Also update the currently opened
      device with fresh last_seen etc.
    */

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

  /*
    Re-render relative times every 10 sec.
  */

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

  /*
    Fetch fresh last_seen/status values
    from the server every 30 seconds.

    The Agent heartbeat is also currently
    running every 30 seconds.
  */

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
     DEVICE DRAWER
  ========================= */

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
     DELETE DEVICE
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
     SELECTED DEVICE STATUS
  ========================= */

  const selectedDeviceStatus =
    selectedDevice
      ? getEffectiveStatus(
          selectedDevice,
          now
        )
      : null;

  /* =========================
     FILTERED DEVICES
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
    } = await supabase
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

    /*
      Remove immediately from the UI.
    */

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
                    className="text-zinc-300"
                  />
                )}

              </button>

              {sites.map(
                (site) => (

                  <button
                    key={site.id}
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
                        className="text-zinc-300"
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

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d0f12]">

          {/* HEADER */}

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

          {/* ROWS */}

          <div className="divide-y divide-zinc-800 bg-[#0d0f12]">

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

              {/* =========================
                  STATUS
              ========================= */}

              <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4">

                <div>

                  <p className="text-xs text-zinc-600">
                    Device status
                  </p>

                  <div className="mt-2 flex items-center gap-2">

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

                    <span className="text-sm font-medium capitalize">
                      {
                        selectedDeviceStatus
                      }
                    </span>

                  </div>

                  <p className="mt-1.5 text-xs text-zinc-500">
                    {selectedDevice.last_seen
                      ? `Last seen ${getRelativeLastSeen(
                          selectedDevice.last_seen,
                          now
                        )}`
                      : "Never seen"}
                  </p>

                </div>

                <Wifi
                  size={19}
                  className={
                    selectedDeviceStatus ===
                    "online"
                      ? "text-emerald-500"
                      : selectedDeviceStatus ===
                        "warning"
                      ? "text-amber-500"
                      : "text-zinc-700"
                  }
                />

              </div>

              {/* =========================
                  QUICK ACTIONS
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
                  LAST SEEN DETAIL
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

              {/* =========================
                  DELETE DEVICE
              ========================= */}

              {canManage && (

                <div className="border-t border-zinc-800 pt-6">

                  <div className="flex items-center justify-between gap-5">

                    <div>

                      <p className="text-sm font-medium text-red-400">
                        Delete device
                      </p>

                      <p className="mt-1 text-xs leading-5 text-zinc-600">
                        Remove this device from SentinelGrid.
                      </p>

                    </div>

                    <button
                      type="button"
                      onClick={
                        openDeleteDevice
                      }
                      className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-red-950 bg-[#120b0d] px-4 py-2.5 text-sm font-medium text-red-400 transition hover:border-red-900 hover:bg-[#1a0d10] hover:text-red-300"
                    >
                      <Trash2
                        size={15}
                      />

                      Delete
                    </button>

                  </div>

                </div>

              )}

            </div>

          </aside>

        </>
      )}

      {/* =========================
          DELETE DEVICE MODAL
      ========================= */}

      {deleteOpen &&
        selectedDevice && (
        <>

          {/* MODAL OVERLAY */}

          <button
            type="button"
            aria-label="Close delete confirmation"
            onClick={
              closeDeleteDevice
            }
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
          />

          {/* MODAL */}

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
                  {deleteError}
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
   DEVICE STATUS HELPERS
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
    if (minutes === 1) {
      return "1 min ago";
    }

    return `${minutes} min ago`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    if (hours === 1) {
      return "1h ago";
    }

    return `${hours}h ago`;
  }

  const days =
    Math.floor(
      hours / 24
    );

  if (days === 1) {
    return "1d ago";
  }

  return `${days}d ago`;
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

    We allow three missed heartbeats
    before considering the device offline.
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
   METRIC CARD
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