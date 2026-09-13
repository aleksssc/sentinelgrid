"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  deleteDeviceAction,
} from "./device-actions";

import { useRouter } from "next/navigation";

import DeviceTerminal, {
  type TerminalShell,
} from "@/components/dashboard/devices/device-terminal";
import DeviceRDP from "@/components/dashboard/devices/device-rdp";
import { RemoteFeatureGate } from "@/components/dashboard/devices/remote-feature-gate";
import type { RemoteFeatureAccess } from "@/lib/remote-feature-access";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import DeviceActivityTimeline from "@/components/dashboard/devices/device-activity";
import DevicePerformance from "@/components/dashboard/devices/device-performance";
import ActionsMenu from "@/components/dashboard/devices/device-actions-menu";
import { ACTIVE_COMMAND_STATUSES } from "@/lib/remote/action-definitions";
import DeviceActionNotice from "@/components/dashboard/devices/device-action-notice";
import { ActionSubmissionError, completionNotice, progressNotice, record, statusUnavailableNotice, submissionNotice, submitDeviceAction, type ActionNotice } from "@/lib/remote/action-feedback";
import type { DeviceActivity, DeviceActivityCommand } from "@/lib/activity/device-activity";

import {
  Activity,
  Check,
  ChevronDown,
  CircleAlert,
  Cpu,
  HardDrive,
  Laptop,
  MapPin,
  MemoryStick,
  Monitor,
  Network,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { SectionHeader, EmptyState } from "@/components/dashboard/dashboard-primitives";
import DeviceTabs from "@/components/dashboard/devices/device-tabs";
import DeviceSettingsPanel from "@/components/dashboard/devices/device-settings-panel";

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

  os_build:
    | string
    | null;

  arch:
    | string
    | null;

  device_type:
    | "desktop"
    | "laptop"
    | "server"
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

  agent_version:
    | string
    | null;

  capabilities:
    | Record<string, boolean>
    | null;

  last_inventory_at:
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

  clientName: string;

  canManage: boolean;
  rdpConfigured: boolean;
  remoteAccess: {
    actions: RemoteFeatureAccess;
    terminal: RemoteFeatureAccess;
    rdp: RemoteFeatureAccess;
  };

  activity: DeviceActivity[];
  activityCommands: DeviceActivityCommand[];
  activityError?: string;
};

type DeviceTab =
  | "overview"
  | "performance"
  | "inventory"
  | "software"
  | "services"
  | "settings"
  | "activity";

/* =========================
   COMPONENT
========================= */

export default function DeviceDashboard({
  devices,
  sites,
  clientName,
  canManage,
  rdpConfigured,
  remoteAccess,
  activity,
  activityCommands,
  activityError,
}: Props) {
  const router =
    useRouter();

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

  const [
    drawerOpen,
    setDrawerOpen,
  ] =
    useState(false);

  const [
    activeTab,
    setActiveTab,
  ] =
    useState<DeviceTab>(
      "overview"
    );

  const [
    actionsOpen,
    setActionsOpen,
  ] =
    useState(false);

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
  ] =
    useState(
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
  ] =
    useState("");

  const [
    siteFilter,
    setSiteFilter,
  ] =
    useState("all");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState("all");

  const [
    siteFilterOpen,
    setSiteFilterOpen,
  ] =
    useState(false);

  const [
    statusFilterOpen,
    setStatusFilterOpen,
  ] =
    useState(false);

  /* =========================
     ACTION MESSAGE
  ========================= */

  const [
    actionMessage,
    setActionMessage,
  ] =
    useState<ActionNotice | null>(null);

  const [
    actionBusy,
    setActionBusy,
  ] =
    useState<string | null>(null);

  const actionController = useRef<AbortController | null>(null);
  useEffect(() => {
    actionController.current?.abort();
    actionController.current = null;
    setActionBusy(null);
    return () => { actionController.current?.abort(); };
  }, [selectedDevice?.id]);

  /* =========================
     REMOTE TERMINAL
  ========================= */

  const [
    terminalOpen,
    setTerminalOpen,
  ] =
    useState(false);

  const [
    terminalShell,
    setTerminalShell,
  ] =
    useState<TerminalShell>(
      "powershell"
    );

  /* =========================
     DELETE
  ========================= */

  const [
    deleteOpen,
    setDeleteOpen,
  ] =
    useState(false);

  const [
    deletingDevice,
    setDeletingDevice,
  ] =
    useState(false);

  const [
    deleteError,
    setDeleteError,
  ] =
    useState("");

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

  const selectedCapabilities =
    selectedDevice?.capabilities ?? {};

  const terminalAvailable =
    selectedDeviceStatus === "online" &&
    selectedCapabilities.terminal !== false;

  const rdpAvailable =
    Boolean(
      rdpConfigured && selectedDeviceStatus === "online" &&
      selectedCapabilities.rdp &&
      selectedCapabilities.tcp_tunnel
    );

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
            device.device_type
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
     OPEN DEVICE
  ========================= */

  function openDevice(
    device: Device
  ) {
    setSelectedDevice(
      device
    );

    setActionMessage(null);

    setActiveTab("overview");

    setActionsOpen(false);

    setSiteFilterOpen(
      false
    );

    setStatusFilterOpen(
      false
    );

    setDrawerOpen(
      false
    );

    window.requestAnimationFrame(
      () => {
        window.requestAnimationFrame(
          () => {
            setDrawerOpen(
              true
            );
          }
        );
      }
    );
  }

  /* =========================
     CLOSE DEVICE
  ========================= */

  function closeDevice() {
    closeRemoteTerminal();

    setActionsOpen(false);

    setDrawerOpen(
      false
    );

    window.setTimeout(
      () => {
        setSelectedDevice(
          null
        );

        setActionMessage(null);
      },
      280
    );
  }

  /* =========================
     TERMINAL
  ========================= */

  function openRemoteTerminal(
    shell: TerminalShell
  ) {
    if (
      !remoteAccess.terminal.canUse ||
      !selectedDevice
    ) {
      return;
    }

    setTerminalShell(
      shell
    );

    setTerminalOpen(
      true
    );
  }

  function closeRemoteTerminal() {
    setTerminalOpen(
      false
    );
  }

  async function runQuickAction(
    action: string,
    options?: {
      confirm?: string;
      payload?: Record<string, unknown>;
    }
  ) {
    if (!remoteAccess.actions.canUse || !selectedDevice || actionBusy) {
      return;
    }

    if (
      options?.confirm &&
      !window.confirm(options.confirm)
    ) {
      return;
    }

    setActionBusy(action);
    const controller = new AbortController();
    actionController.current = controller;
    setActionMessage(progressNotice(action, "sending"));

    try {
      const result = await submitDeviceAction(selectedDevice.id, action, options?.payload ?? {});
      if (controller.signal.aborted) return;
      setActionMessage(progressNotice(action, result.status));
      await watchQuickAction(selectedDevice.id, result.commandId, action, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      setActionMessage(submissionNotice(action,
        error instanceof ActionSubmissionError ? error.code : "NETWORK_ERROR",
        error instanceof ActionSubmissionError ? error.status : undefined));
    } finally {
      if (actionController.current === controller) setActionBusy(null);
    }
  }

  async function watchQuickAction(
    deviceId: string,
    commandId: string,
    action: string,
    signal: AbortSignal
  ) {
    let refreshFailures = 0;
    for (let attempt = 0; attempt < 1050; attempt += 1) {
      await new Promise((resolve) => { window.setTimeout(resolve, 2000); });
      if (signal.aborted) return;

      try {
        const response = await fetch(
          `/api/devices/${deviceId}/commands?command_id=${commandId}`,
          { cache: "no-store", signal }
        );
        if (signal.aborted) return;
        if (!response.ok) {
          setActionMessage(statusUnavailableNotice(action));
          refreshFailures += 1;
          if ([401, 403, 404].includes(response.status) || refreshFailures >= 3) return;
          continue;
        }
        const command = record(await response.json());
        if (signal.aborted) return;
        if (typeof command.status !== "string" ||
            ![...ACTIVE_COMMAND_STATUSES, "succeeded", "failed", "expired"].includes(command.status)) {
          setActionMessage(statusUnavailableNotice(action));
          return;
        }
        refreshFailures = 0;
        if (["succeeded", "failed", "expired"].includes(command.status)) {
          setActionMessage(completionNotice(action, command));
          router.refresh();
          return;
        }
        setActionMessage(progressNotice(action, command.status));
      } catch {
        if (signal.aborted) return;
        setActionMessage(statusUnavailableNotice(action));
        refreshFailures += 1;
        if (refreshFailures >= 3) return;
      }
    }
    setActionMessage(statusUnavailableNotice(action));
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

    try {
      const result =
        await deleteDeviceAction(
          deviceId
        );

      if (!result.ok) {
        setDeleteError(
          result.error ||
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

      setDrawerOpen(
        false
      );

      window.setTimeout(
        () => {
          setSelectedDevice(
            null
          );
        },
        280
      );

      setActionMessage(null);

      router.refresh();
    } catch (error) {
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
    }
  }

  return (
    <>
      {/* =========================
          TOOLBAR
      ========================= */}

      <div className="sg-toolbar">

        {/* SEARCH */}

        <div className="relative min-w-0 basis-64 flex-1">

          <Search
            size={17}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-muted"
          />

          <input
            type="text"
            aria-label="Search devices"
            placeholder="Search devices..."
            value={search}
            onChange={(e) =>
              setSearch(
                e.target.value
              )
            }
            className="sg-control w-full py-2.5 pl-10 pr-4"
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
            aria-expanded={siteFilterOpen}
            aria-label="Filter by site"
            className={`sg-control flex min-w-[160px] items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm outline-none transition focus:outline-none ${
              siteFilterOpen
                ? "border-surface-accent-edge bg-surface-selected"
                : "border-zinc-800 bg-surface-inset hover:border-surface-accent-edge"
            }`}
          >

            <div className="flex min-w-0 items-center gap-2.5">

              <MapPin
                size={15}
                className="shrink-0 text-surface-muted"
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
              className={`shrink-0 text-surface-muted transition-transform duration-200 ${
                siteFilterOpen
                  ? "rotate-180"
                  : ""
              }`}
            />

          </button>

          {siteFilterOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 min-w-full overflow-hidden rounded-xl border border-surface-edge bg-surface-raised shadow-2xl">

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
                className={`sg-filter-option flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm outline-none transition focus:outline-none ${
                  siteFilter ===
                  "all"
                    ? "bg-surface-selected text-surface-accent"
                    : "text-zinc-400 hover:bg-surface-hover hover:text-white"
                }`}
              >

                <div className="flex items-center gap-3">

                  <MapPin
                    size={15}
                    className="text-surface-muted"
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
                    className={`sg-filter-option flex w-full items-center justify-between gap-4 border-t border-surface-edge px-4 py-3 text-left text-sm outline-none transition focus:outline-none ${
                      siteFilter ===
                      site.id
                        ? "bg-surface-selected text-surface-accent"
                        : "text-zinc-400 hover:bg-surface-hover hover:text-white"
                    }`}
                  >

                    <div className="flex items-center gap-3">

                      <MapPin
                        size={15}
                        className="text-surface-muted"
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
            aria-expanded={statusFilterOpen}
            aria-label="Filter by status"
            className={`sg-control flex min-w-[150px] items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm outline-none transition focus:outline-none ${
              statusFilterOpen
                ? "border-surface-accent-edge bg-surface-selected"
                : "border-zinc-800 bg-surface-inset hover:border-surface-accent-edge"
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
            <div className="absolute right-0 top-full z-30 mt-2 min-w-[180px] overflow-hidden rounded-xl border border-surface-edge bg-surface-raised shadow-2xl">

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

        <p className="text-xs text-surface-muted">
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
            className="text-xs text-surface-muted outline-none transition hover:text-white focus:outline-none"
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
        <div className="sg-surface flex flex-col items-center border-dashed px-6 py-16 text-center">

          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-surface-edge bg-surface-inset text-surface-muted">
            <Monitor
              size={21}
            />
          </div>

          <h3 className="mt-5 font-semibold">
            No devices registered
          </h3>

          <p className="mt-2 max-w-lg text-sm leading-6 text-surface-muted">
            Devices will appear here once a SentinelGrid agent is deployed and linked to this client.
          </p>

        </div>
      ) : filteredDevices.length ===
        0 ? (
        <div className="sg-surface border-dashed px-6 py-12 text-center">

          <Search
            size={22}
            className="mx-auto text-surface-muted"
          />

          <h3 className="mt-4 font-medium">
            No devices found
          </h3>

          <p className="mt-2 text-sm text-surface-muted">
            Try changing your search or filters.
          </p>

        </div>
      ) : (
        /* =========================
            DEVICE TABLE
        ========================= */

        <div className="sg-surface overflow-hidden">

          <div className="sg-table-heading hidden grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(150px,1fr)_120px] gap-6 border-b border-surface-edge bg-surface-raised px-5 py-3 text-xs uppercase tracking-wide text-surface-muted lg:grid">

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

          <div className="divide-y divide-surface-edge">

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
                    onClick={() =>
                      openDevice(
                        device
                      )
                    }
                    className="sg-row group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-6 bg-surface px-5 py-4 text-left outline-none transition hover:bg-surface-hover focus:outline-none focus-visible:outline-none lg:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(150px,1fr)_120px]"
                  >

                    {/* DEVICE */}

                    <div className="flex min-w-0 items-center gap-4">

                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-surface-edge bg-surface-inset text-zinc-400">

                        <DeviceTypeIcon
                          type={
                            device.device_type
                          }
                          size={18}
                        />

                      </div>

                      <div className="min-w-0">

                        <p className="truncate text-sm font-medium text-zinc-100">
                          {device.display_name ||
                            device.hostname}
                        </p>

                        <p className="mt-1 truncate text-xs text-surface-muted">
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
                      {
                        formatOSName(
                          device.os
                        )
                      }
                    </p>

                    {/* STATUS */}

                    <div className="flex flex-col items-end lg:items-start">

                      <StatusBadge status={effectiveStatus} />

                      <span className="mt-1.5 text-[11px] text-surface-muted">
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
            onClick={
              closeDevice
            }
            className={`sg-drawer-overlay fixed bottom-0 left-0 right-0 top-16 z-30 bg-black/45 backdrop-blur-[2px] outline-none transition-opacity duration-300 focus:outline-none ${
              drawerOpen
                ? "opacity-100"
                : "opacity-0"
            }`}
          />

          {/* DRAWER */}

          <aside
            className={`sg-drawer fixed bottom-0 right-0 top-16 z-40 w-full overflow-y-auto border-l border-surface-edge bg-[#070809] shadow-2xl transition-transform duration-300 ease-out sm:w-[calc(100vw-64px)] lg:w-[760px] xl:w-[820px] ${
              drawerOpen
                ? "translate-x-0"
                : "translate-x-full"
            }`}
          >

            {/* =========================
                HEADER
            ========================= */}

            <div className="sg-drawer-header sticky top-0 z-20 border-b border-surface-edge bg-[#070809]/95 px-5 py-4 backdrop-blur">

              <div className="flex items-center justify-between gap-5">

                <div className="flex min-w-0 items-center gap-4">

                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-surface-edge bg-surface text-zinc-400">

                    <DeviceTypeIcon
                      type={
                        selectedDevice.device_type
                      }
                      size={19}
                    />

                  </div>

                  <div className="min-w-0">

                    <h2 className="sg-section-title truncate text-white">
                      {selectedDevice.display_name ||
                        selectedDevice.hostname}
                    </h2>

                    <p className="mt-0.5 truncate text-sm text-surface-muted">
                      {
                        selectedDevice.hostname
                      }
                    </p>

                  </div>

                </div>

                <button
                  type="button"
                  onClick={
                    closeDevice
                  }
                  aria-label="Close device details"
                  className="sg-button sg-button-ghost sg-button-icon w-9 shrink-0 text-surface-muted"
                >
                  <X
                    size={18}
                  />
                </button>

              </div>

              <div className="sg-device-meta mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-muted">
                <span className="text-zinc-300">{formatOSName(selectedDevice.os)}</span>
                <span className="text-zinc-700">/</span>
                <span>{clientName}</span>
                <span className="text-zinc-700">/</span>
                <span>{getSite(selectedDevice)?.name || "No site"}</span>
                <span className="text-zinc-700">/</span>
                <span>{selectedDevice.last_seen ? `Last seen ${getRelativeLastSeen(selectedDevice.last_seen, now)}` : "Never seen"}</span>
              </div>

              <div className="sg-device-toolbar mt-4 flex flex-wrap items-center gap-2">
                <DeviceRDP key={`rdp-${selectedDevice.id}`} deviceId={selectedDevice.id} available={rdpAvailable} access={remoteAccess.rdp} />

                <RemoteFeatureGate access={remoteAccess.terminal} feature="Terminal">
                  <button
                    type="button"
                    onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); openRemoteTerminal("powershell"); }}
                    disabled={!terminalAvailable}
                    title={terminalAvailable ? "Open remote terminal" : "The device is offline or terminal access is unavailable."}
                    className="sg-button sg-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Terminal size={16} />
                    Terminal
                  </button>
                </RemoteFeatureGate>

                <ActionsMenu
                  key={`actions-${selectedDevice.id}`}
                  device={selectedDevice}
                  busy={Boolean(actionBusy)}
                  online={selectedDeviceStatus === "online"}
                  access={remoteAccess.actions}
                  open={actionsOpen}
                  onOpenChange={setActionsOpen}
                  onAction={(action, options) => {
                    setActionsOpen(false);
                    void runQuickAction(action, options);
                  }}
                />
              </div>

            </div>

            {/* =========================
                DRAWER CONTENT
            ========================= */}

            <div className="sg-drawer-content p-5">

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <StatusBadge status={selectedDeviceStatus ?? "unknown"} />

                <span className="text-surface-muted">
                  {selectedDevice.last_seen
                    ? `Last seen ${getRelativeLastSeen(selectedDevice.last_seen, now)}`
                    : "Never seen"}
                </span>
              </div>

              {actionMessage && (
                <DeviceActionNotice notice={actionMessage} onDismiss={() => setActionMessage(null)} />
              )}

              <DeviceTabs
                tabs={DEVICE_TABS}
                value={activeTab}
                onChange={setActiveTab}
              />

              {/* =========================
                  DEVICE DETAILS
              ========================= */}

                {activeTab === "overview" ? (
                <div className="mt-6 space-y-4">

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <MetricCard
                      icon={<Cpu size={15} />}
                      label="CPU"
                      value={formatPercentage(selectedDevice.cpu_usage)}
                      percentage={selectedDevice.cpu_usage}
                    />

                    <MetricCard
                      icon={<MemoryStick size={15} />}
                      label="RAM"
                      value={formatPercentage(selectedDevice.ram_usage)}
                      detail={formatUsedTotal(
                        selectedDevice.ram_used_bytes,
                        selectedDevice.ram_total_bytes
                      )}
                      percentage={selectedDevice.ram_usage}
                    />

                    <MetricCard
                      icon={<HardDrive size={15} />}
                      label="Disk"
                      value={formatPercentage(selectedDevice.disk_usage)}
                      detail={formatUsedTotal(
                        selectedDevice.disk_used_bytes,
                        selectedDevice.disk_total_bytes
                      )}
                      percentage={selectedDevice.disk_usage}
                    />

                    <MetricCard
                      icon={<Activity size={15} />}
                      label="Uptime"
                      value={formatUptime(selectedDevice.uptime_seconds)}
                      percentage={null}
                    />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">

                    <OverviewCard
                      title="System"
                      subtitle="Core endpoint information"
                      icon={<Monitor size={17} />}
                    >
                      <OverviewInfoRow
                        label="Device type"
                        value={formatDeviceType(selectedDevice.device_type)}
                      />
                      <OverviewInfoRow
                        label="Operating system"
                        value={formatOSName(selectedDevice.os)}
                      />
                      <OverviewInfoRow
                        label="Processor"
                        value={selectedDevice.cpu_name || "Unknown"}
                      />
                      <OverviewInfoRow
                        label="Memory"
                        value={formatBytes(selectedDevice.ram_total_bytes)}
                      />
                      <OverviewInfoRow
                        label="Model"
                        value={cleanInventoryValue(selectedDevice.model)}
                      />
                    </OverviewCard>

                    <OverviewCard
                      title="Remote access"
                      subtitle="Live management availability"
                      icon={<Terminal size={17} />}
                    >
                      <RemoteAccessRow
                        label="Agent"
                        available={selectedDeviceStatus === "online"}
                        value={
                          selectedDeviceStatus === "online"
                            ? "Connected"
                            : "Disconnected"
                        }
                      />
                      <RemoteAccessRow
                        label="Terminal"
                        available={terminalAvailable}
                        value={terminalAvailable ? "Available" : "Unavailable"}
                      />
                      <RemoteAccessRow
                        label="Remote Desktop"
                        available={rdpAvailable}
                        value={rdpAvailable ? "Available" : "Not configured"}
                      />
                      <RemoteAccessRow
                        label="Relay"
                        available={false}
                        value="Not configured"
                      />
                    </OverviewCard>

                    <OverviewCard
                      title="Network"
                      subtitle="Current endpoint addressing"
                      icon={<Network size={17} />}
                    >
                      <OverviewInfoRow
                        label="Local IP"
                        value={selectedDevice.local_ip || "Unknown"}
                      />
                      <OverviewInfoRow
                        label="Public IP"
                        value={selectedDevice.public_ip || "Unknown"}
                      />
                      <OverviewInfoRow
                        label="MAC address"
                        value={selectedDevice.mac_address || "Unknown"}
                      />
                      <OverviewInfoRow
                        label="Site"
                        value={getSite(selectedDevice)?.name || "No site"}
                      />
                    </OverviewCard>

                    <OverviewCard
                      title="SentinelGrid Agent"
                      subtitle="Endpoint management agent"
                      icon={<ShieldCheck size={17} />}
                    >
                      <OverviewInfoRow
                        label="Version"
                        value={
                          selectedDevice.agent_version
                            ? `v${selectedDevice.agent_version}`
                            : "Unknown"
                        }
                      />
                      <OverviewInfoRow
                        label="Agent ID"
                        value={selectedDevice.agent_id || "Not registered"}
                      />
                      <OverviewInfoRow
                        label="Last communication"
                        value={
                          selectedDevice.last_seen
                            ? new Date(selectedDevice.last_seen).toLocaleString()
                            : "Never"
                        }
                      />
                      <OverviewInfoRow
                        label="Last inventory"
                        value={
                          selectedDevice.last_inventory_at
                            ? new Date(
                                selectedDevice.last_inventory_at
                              ).toLocaleString()
                            : "Not recorded"
                        }
                      />
                    </OverviewCard>

                  </div>

                </div>
              ) : (
                <DeviceTabPanel
                  tab={activeTab}
                  device={selectedDevice}
                  activity={activity}
                  activityCommands={activityCommands}
                  activityError={activityError}
                  now={now}
                  sites={sites}
                  canManage={canManage}
                  onDeviceUpdated={(updated) => {
                    setDeviceList((current) => current.map((device) => device.id === updated.id ? { ...device, ...updated } : device));
                    setSelectedDevice((current) => current?.id === updated.id ? { ...current, ...updated } : current);
                    router.refresh();
                  }}
                />
              )}

              {/* =========================
                  DELETE DEVICE
              ========================= */}

              {canManage && (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-surface-edge pt-5">

                  <div>

                    <p className="text-sm font-medium text-zinc-300">
                      Remove device
                    </p>

                    <p className="mt-0.5 text-xs text-surface-muted">
                      Permanently remove this endpoint.
                    </p>

                  </div>

                  <button
                    type="button"
                    onClick={
                      openDeleteDevice
                    }
                    className="sg-button sg-button-danger text-red-400 outline-none focus:outline-none focus-visible:outline-none"
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
          REMOTE TERMINAL
      ========================= */}

      <DeviceTerminal
        open={
          terminalOpen
        }
        initialShell={
          terminalShell
        }
        device={
          selectedDevice
        }
        canManage={remoteAccess.terminal.canUse}
        onClose={
          closeRemoteTerminal
        }
      />

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

          <div className="sg-dialog fixed left-1/2 top-1/2 z-[70] w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-surface-edge bg-surface shadow-2xl">

            <div className="flex items-start justify-between gap-5 border-b border-surface-edge px-6 py-5">

              <div className="flex items-start gap-4">

                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-950 bg-[#160c0f] text-red-500">

                  <Trash2
                    size={17}
                  />

                </div>

                <div>

                  <h2 className="sg-section-title">
                    Delete device?
                  </h2>

                  <p className="mt-1 text-sm text-surface-muted">
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
                className="sg-button sg-button-ghost sg-button-icon w-9 text-surface-muted outline-none focus:outline-none disabled:opacity-50"
              >
                <X
                  size={18}
                />
              </button>

            </div>

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

            <div className="flex justify-end gap-3 border-t border-surface-edge px-6 py-5">

              <button
                type="button"
                onClick={
                  closeDeleteDevice
                }
                disabled={
                  deletingDevice
                }
                className="sg-button sg-button-secondary outline-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
                className="sg-button sg-button-danger-solid outline-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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

const DEVICE_TABS: Array<{ id: DeviceTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "inventory", label: "Inventory" },
  { id: "software", label: "Software" },
  { id: "services", label: "Services" },
  { id: "settings", label: "Settings" },
  { id: "activity", label: "Activity" },
];

function DeviceTabPanel({
  tab,
  device,
  activity,
  activityCommands,
  activityError,
  now,
  sites,
  canManage,
  onDeviceUpdated,
}: {
  tab: DeviceTab;
  device: Device;
  activity?: DeviceActivity[];
  activityCommands: DeviceActivityCommand[];
  activityError?: string;
  now: number;
  sites: Site[];
  canManage: boolean;
  onDeviceUpdated: (updated: Pick<Device, "id" | "display_name" | "site_id" | "sites">) => void;
}) {
  if (tab === "inventory") {
    return (
      <div className="mt-6 space-y-4">
        <InventoryGroup title="Hardware" rows={[
          ["Device type", formatDeviceType(device.device_type)],
          ["Manufacturer", cleanInventoryValue(device.manufacturer)],
          ["Model", cleanInventoryValue(device.model)],
          ["Serial number", cleanInventoryValue(device.serial_number)],
          ["Processor", device.cpu_name || "Unknown"],
          ["Memory", formatBytes(device.ram_total_bytes)],
        ]} />
        <InventoryGroup title="Operating system" rows={[
          ["Operating system", device.os || "Unknown"],
          ["Version", device.os_version || "Unknown"],
          ["Build", device.os_build || "Unknown"],
          ["Architecture", formatArchitecture(device.arch)],
        ]} />
        <InventoryGroup title="Network" rows={[
          ["Local IP", device.local_ip || "Unknown"],
          ["Public IP", device.public_ip || "Unknown"],
          ["MAC address", device.mac_address || "Unknown"],
        ]} />
        <InventoryGroup title="Agent" rows={[
          ["Version", device.agent_version ? `v${device.agent_version}` : "Unknown"],
          ["Last inventory", device.last_inventory_at ? new Date(device.last_inventory_at).toLocaleString() : "Not recorded"],
        ]} />
      </div>
    );
  }

  if (tab === "activity") {
    return (
      <DeviceActivityTimeline
        key={device.id}
        deviceId={device.id}
        events={activity ?? []}
        commands={activityCommands}
        error={activityError}
        now={now}
      />
    );
  }

  if (tab === "performance") {
    return <DevicePerformance key={device.id} deviceId={device.id} />;
  }

  if (tab === "settings") {
    return <DeviceSettingsPanel device={device} sites={sites} canManage={canManage} onDeviceUpdated={onDeviceUpdated} />;
  }

  const labels: Record<Exclude<DeviceTab, "overview" | "performance" | "inventory" | "activity" | "settings">, [string, string]> = {
    software: ["Software inventory is not available", "This Agent version does not collect installed software yet."],
    services: ["Services inventory is not available", "Windows service collection and actions are not available from this Agent version yet."],
  };

  const unsupportedTab = tab as "software" | "services";

  return <DeviceTabEmpty title={labels[unsupportedTab][0]} description={labels[unsupportedTab][1]} />;
}

function InventoryGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="sg-surface overflow-hidden">
      <SectionHeader title={title} level={3} />
      <div className="divide-y divide-surface-edge">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
            <span className="text-surface-muted">{label}</span>
            <span className="min-w-0 max-w-[65%] break-words text-right text-zinc-300">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeviceTabEmpty({ title, description }: { title: string; description: string }) {
  return <EmptyState className="sg-surface mt-6" title={title} description={description} icon={<Wrench size={22} />} />;
}

function OverviewCard({
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
  return (
    <section className="sg-surface overflow-hidden">
      <SectionHeader title={title} description={subtitle} icon={icon} level={3} />

      <div className="divide-y divide-surface-edge">
        {children}
      </div>
    </section>
  );
}

function OverviewInfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-5 px-4 py-3 text-sm">
      <span className="shrink-0 text-surface-muted">{label}</span>
      <span
        title={value}
        className="min-w-0 max-w-[68%] break-words text-right text-zinc-300"
      >
        {value}
      </span>
    </div>
  );
}

function RemoteAccessRow({
  label,
  available,
  value,
}: {
  label: string;
  available: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <div className="flex items-center gap-2.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            available ? "bg-emerald-400" : "bg-zinc-600"
          }`}
        />
        <span className="text-zinc-400">{label}</span>
      </div>

      <span className={available ? "text-emerald-400" : "text-zinc-600"}>
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
    <div className="sg-drawer-metric min-w-0">

      <div className="flex items-center gap-2 text-surface-muted">

        {icon}

        <span className="text-[11px]">
          {label}
        </span>

      </div>

      <p className="mt-1.5 text-lg font-semibold text-white">
        {value}
      </p>

      {detail && (
        <p
          title={
            detail
          }
          className="mt-0.5 truncate text-[10px] text-surface-muted"
        >
          {detail}
        </p>
      )}

      {safePercentage !== null && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              safePercentage >= 90
                ? "bg-red-500"
                : safePercentage >= 75
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            }`}
            style={{
              width: `${safePercentage}%`,
            }}
          />
        </div>
      )}

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
      className={`sg-filter-option flex w-full items-center justify-between gap-5 border-b border-surface-edge px-4 py-3 text-left text-sm outline-none transition last:border-b-0 focus:outline-none ${
        active
          ? "bg-surface-selected text-surface-accent"
          : "text-zinc-400 hover:bg-surface-hover hover:text-white"
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

  if (
    diff >
    90_000
  ) {
    return "offline";
  }

  return device.status;
}

/* =========================
   FORMAT OS NAME
========================= */

function formatOSName(
  os:
    | string
    | null
) {
  if (!os) {
    return "Unknown OS";
  }

  const normalized =
    os.trim();

  if (
    normalized
      .toLowerCase()
      .includes(
        "windows 11"
      )
  ) {
    return "Microsoft Windows 11";
  }

  if (
    normalized
      .toLowerCase()
      .includes(
        "windows 10"
      )
  ) {
    return "Microsoft Windows 10";
  }

  return normalized;
}

/* =========================
   CLEAN INVENTORY VALUE
========================= */

function cleanInventoryValue(
  value:
    | string
    | null
) {
  if (!value) {
    return "—";
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  const invalidValues = [
    "to be filled by o.e.m.",
    "to be filled by oem",
    "default string",
    "system product name",
    "system manufacturer",
    "not specified",
    "unknown",
    "none",
  ];

  if (
    invalidValues.includes(
      normalized
    )
  ) {
    return "Not provided";
  }

  return value.trim();
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

/* =========================
   DEVICE TYPE
========================= */

function formatDeviceType(
  type:
    | "desktop"
    | "laptop"
    | "server"
    | null
) {
  switch (type) {
    case "server":
      return "Server";

    case "laptop":
      return "Laptop";

    case "desktop":
      return "Desktop";

    default:
      return "Unknown";
  }
}

/* =========================
   DEVICE TYPE ICON
========================= */

function DeviceTypeIcon({
  type,
  size = 16,
}: {
  type:
    | "desktop"
    | "laptop"
    | "server"
    | null;

  size?: number;
}) {
  switch (type) {
    case "server":
      return (
        <Server
          size={size}
        />
      );

    case "laptop":
      return (
        <Laptop
          size={size}
        />
      );

    default:
      return (
        <Monitor
          size={size}
        />
      );
  }
}