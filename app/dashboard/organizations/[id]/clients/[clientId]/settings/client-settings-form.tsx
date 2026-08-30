"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  MapPin,
  Monitor,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

/* =========================
   TYPES
========================= */

type Client = {
  id: string;

  name: string;

  description:
    | string
    | null;

  status:
    | "active"
    | "inactive";
};

type Site = {
  id: string;

  name: string;

  location:
    | string
    | null;

  description:
    | string
    | null;

  client_id:
    | string
    | null;
};

type Device = {
  id: string;

  hostname: string;

  display_name:
    | string
    | null;

  site_id:
    | string
    | null;

  status: string;
};

type Props = {
  organizationId: string;

  client: Client;

  initialSites: Site[];

  initialDevices: Device[];
};

/* =========================
   COMPONENT
========================= */

export default function ClientSettingsForm({
  organizationId,
  client,
  initialSites,
  initialDevices,
}: Props) {
  const router =
    useRouter();

  const supabase =
    createClient();

  /* =========================
     GENERAL
  ========================= */

  const [
    name,
    setName,
  ] = useState(
    client.name
  );

  const [
    description,
    setDescription,
  ] = useState(
    client.description ?? ""
  );

  const [
    status,
    setStatus,
  ] = useState<
    "active" | "inactive"
  >(client.status);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    messageType,
    setMessageType,
  ] = useState<
    "success" | "error" | null
  >(null);

  /* =========================
     SITES
  ========================= */

  const [
    sites,
    setSites,
  ] = useState<Site[]>(
    initialSites
  );

  const [
    siteModalOpen,
    setSiteModalOpen,
  ] = useState(false);

  const [
    editingSite,
    setEditingSite,
  ] =
    useState<Site | null>(
      null
    );

  const [
    siteName,
    setSiteName,
  ] = useState("");

  const [
    siteLocation,
    setSiteLocation,
  ] = useState("");

  const [
    siteDescription,
    setSiteDescription,
  ] = useState("");

  const [
    savingSite,
    setSavingSite,
  ] = useState(false);

  const [
    siteError,
    setSiteError,
  ] = useState("");

  /* =========================
     DEVICES
  ========================= */

  const [
    devices,
    setDevices,
  ] = useState<Device[]>(
    initialDevices
  );

  const [
    manageSite,
    setManageSite,
  ] =
    useState<Site | null>(
      null
    );

  const [
    selectedDevices,
    setSelectedDevices,
  ] = useState<string[]>(
    []
  );

  const [
    savingDevices,
    setSavingDevices,
  ] = useState(false);

  /* =========================
     DELETE SITE
  ========================= */

  const [
    deleteSite,
    setDeleteSite,
  ] =
    useState<Site | null>(
      null
    );

  const [
    deletingSite,
    setDeletingSite,
  ] = useState(false);

  /* =========================
     DELETE CLIENT
  ========================= */

  const [
    deleteOpen,
    setDeleteOpen,
  ] = useState(false);

  const [
    deleteConfirm,
    setDeleteConfirm,
  ] = useState("");

  const [
    deleting,
    setDeleting,
  ] = useState(false);

  /* =========================
     SAVE CLIENT
  ========================= */

  async function saveClient() {
    if (!name.trim()) {
      setMessage(
        "Client name is required."
      );

      setMessageType(
        "error"
      );

      return;
    }

    setSaving(true);

    setMessage("");

    setMessageType(null);

    const {
      error,
    } = await supabase
      .from("clients")
      .update({
        name:
          name.trim(),

        description:
          description.trim() ||
          null,

        status,

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        client.id
      )
      .eq(
        "organization_id",
        organizationId
      );

    if (error) {
      console.error(error);

      setMessage(
        "Could not update client."
      );

      setMessageType(
        "error"
      );

      setSaving(false);

      return;
    }

    setMessage(
      "Client updated successfully."
    );

    setMessageType(
      "success"
    );

    setSaving(false);

    router.refresh();
  }

  /* =========================
     CREATE SITE
  ========================= */

  function openCreateSite() {
    setEditingSite(null);

    setSiteName("");

    setSiteLocation("");

    setSiteDescription("");

    setSiteError("");

    setSiteModalOpen(true);
  }

  /* =========================
     EDIT SITE
  ========================= */

  function openEditSite(
    site: Site
  ) {
    setEditingSite(site);

    setSiteName(
      site.name
    );

    setSiteLocation(
      site.location ?? ""
    );

    setSiteDescription(
      site.description ?? ""
    );

    setSiteError("");

    setSiteModalOpen(true);
  }

  function closeSiteModal() {
    if (savingSite) {
      return;
    }

    setSiteModalOpen(false);

    setEditingSite(null);

    setSiteError("");
  }

  /* =========================
     SAVE SITE
  ========================= */

  async function saveSite() {
    if (!siteName.trim()) {
      setSiteError(
        "Site name is required."
      );

      return;
    }

    setSavingSite(true);

    setSiteError("");

    /* =========================
       EDIT
    ========================= */

    if (editingSite) {
      const {
        data,
        error,
      } = await supabase
        .from("sites")
        .update({
          name:
            siteName.trim(),

          location:
            siteLocation.trim() ||
            null,

          description:
            siteDescription.trim() ||
            null,

          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          editingSite.id
        )
        .eq(
          "client_id",
          client.id
        )
        .select(`
          id,
          name,
          location,
          description,
          client_id
        `)
        .single();

      if (error) {
        console.error(error);

        if (
          error.code ===
          "23505"
        ) {
          setSiteError(
            "A site with this name already exists."
          );
        } else {
          setSiteError(
            "Could not update site."
          );
        }

        setSavingSite(false);

        return;
      }

      setSites(
        (current) =>
          current
            .map(
              (site) =>
                site.id ===
                editingSite.id
                  ? data
                  : site
            )
            .sort(
              (a, b) =>
                a.name.localeCompare(
                  b.name
                )
            )
      );

      setSavingSite(false);

      setSiteModalOpen(false);

      setEditingSite(null);

      router.refresh();

      return;
    }

    /* =========================
       CREATE
    ========================= */

    const {
      data,
      error,
    } = await supabase
      .from("sites")
      .insert({
        organization_id:
          organizationId,

        client_id:
          client.id,

        name:
          siteName.trim(),

        location:
          siteLocation.trim() ||
          null,

        description:
          siteDescription.trim() ||
          null,
      })
      .select(`
        id,
        name,
        location,
        description,
        client_id
      `)
      .single();

    if (error) {
      console.error(error);

      if (
        error.code ===
        "23505"
      ) {
        setSiteError(
          "A site with this name already exists."
        );
      } else {
        setSiteError(
          "Could not create site."
        );
      }

      setSavingSite(false);

      return;
    }

    setSites(
      (current) =>
        [
          ...current,
          data,
        ].sort(
          (a, b) =>
            a.name.localeCompare(
              b.name
            )
        )
    );

    setSavingSite(false);

    setSiteModalOpen(false);

    router.refresh();
  }

  /* =========================
     MANAGE DEVICES
  ========================= */

  function openManageDevices(
    site: Site
  ) {
    setManageSite(site);

    setSelectedDevices(
      devices
        .filter(
          (device) =>
            device.site_id ===
            site.id
        )
        .map(
          (device) =>
            device.id
        )
    );
  }

  /* =========================
     SAVE SITE DEVICES
  ========================= */

  async function saveSiteDevices() {
    if (!manageSite) {
      return;
    }

    setSavingDevices(true);

    const currentlyAssigned =
      devices.filter(
        (device) =>
          device.site_id ===
          manageSite.id
      );

    const removeIds =
      currentlyAssigned
        .filter(
          (device) =>
            !selectedDevices.includes(
              device.id
            )
        )
        .map(
          (device) =>
            device.id
        );

    if (
      removeIds.length >
      0
    ) {
      const {
        error,
      } = await supabase
        .from("devices")
        .update({
          site_id: null,
        })
        .in(
          "id",
          removeIds
        )
        .eq(
          "client_id",
          client.id
        );

      if (error) {
        console.error(
          error
        );

        setSavingDevices(
          false
        );

        return;
      }
    }

    if (
      selectedDevices.length >
      0
    ) {
      const {
        error,
      } = await supabase
        .from("devices")
        .update({
          site_id:
            manageSite.id,
        })
        .in(
          "id",
          selectedDevices
        )
        .eq(
          "client_id",
          client.id
        );

      if (error) {
        console.error(
          error
        );

        setSavingDevices(
          false
        );

        return;
      }
    }

    setDevices(
      (current) =>
        current.map(
          (device) => {
            if (
              selectedDevices.includes(
                device.id
              )
            ) {
              return {
                ...device,

                site_id:
                  manageSite.id,
              };
            }

            if (
              device.site_id ===
              manageSite.id
            ) {
              return {
                ...device,

                site_id:
                  null,
              };
            }

            return device;
          }
        )
    );

    setSavingDevices(false);

    setManageSite(null);

    router.refresh();
  }

  /* =========================
     DELETE SITE
  ========================= */

  async function confirmDeleteSite() {
    if (!deleteSite) {
      return;
    }

    setDeletingSite(true);

    const {
      error,
    } = await supabase
      .from("sites")
      .delete()
      .eq(
        "id",
        deleteSite.id
      )
      .eq(
        "client_id",
        client.id
      );

    if (error) {
      console.error(error);

      setDeletingSite(false);

      return;
    }

    setSites(
      (current) =>
        current.filter(
          (site) =>
            site.id !==
            deleteSite.id
        )
    );

    setDevices(
      (current) =>
        current.map(
          (device) =>
            device.site_id ===
            deleteSite.id
              ? {
                  ...device,

                  site_id:
                    null,
                }
              : device
        )
    );

    setDeleteSite(null);

    setDeletingSite(false);

    router.refresh();
  }

  /* =========================
     DELETE CLIENT
  ========================= */

  async function deleteClient() {
    if (
      deleteConfirm.trim() !==
      client.name
    ) {
      return;
    }

    setDeleting(true);

    const {
      error,
    } = await supabase
      .from("clients")
      .delete()
      .eq(
        "id",
        client.id
      )
      .eq(
        "organization_id",
        organizationId
      );

    if (error) {
      console.error(error);

      setDeleting(false);

      return;
    }

    router.push(
      `/dashboard/organizations/${organizationId}`
    );

    router.refresh();
  }

  /* =========================
     SITE NAME HELPER
  ========================= */

  function getSiteName(
    siteId:
      | string
      | null
  ) {
    if (!siteId) {
      return null;
    }

    return (
      sites.find(
        (site) =>
          site.id ===
          siteId
      )?.name ?? null
    );
  }

  return (
    <div className="space-y-6">

      {/* =========================
          GENERAL
      ========================= */}

      <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">

        <div className="border-b border-zinc-800 px-6 py-5">

          <div className="flex items-center gap-3">

            <Building2
              size={18}
              className="text-zinc-500"
            />

            <div>

              <h2 className="font-semibold">
                General
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Basic information about this client.
              </p>

            </div>

          </div>

        </div>

        <div className="space-y-5 p-6">

          {/* NAME */}

          <div>

            <label className="mb-2 block text-sm font-medium text-zinc-300">
              Client name
            </label>

            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(
                  e.target.value
                );

                if (message) {
                  setMessage("");
                  setMessageType(null);
                }
              }}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition hover:border-zinc-700 focus:border-zinc-600"
            />

          </div>

          {/* DESCRIPTION */}

          <div>

            <label className="mb-2 block text-sm font-medium text-zinc-300">
              Description
            </label>

            <textarea
              value={
                description
              }
              onChange={(e) => {
                setDescription(
                  e.target.value
                );

                if (message) {
                  setMessage("");
                  setMessageType(null);
                }
              }}
              rows={3}
              className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition hover:border-zinc-700 focus:border-zinc-600"
            />

          </div>

          {/* STATUS */}

          <div>

            <label
              htmlFor="status"
              className="mb-2 block text-sm font-medium text-zinc-300"
            >
              Status
            </label>

            <div className="relative">

              <select
                id="status"
                name="status"
                value={status}
                onChange={(e) => {
                  setStatus(
                    e.target.value as
                      | "active"
                      | "inactive"
                  );

                  if (message) {
                    setMessage("");
                    setMessageType(null);
                  }
                }}
                className="
                  w-full
                  appearance-none
                  rounded-xl
                  border
                  border-zinc-800
                  bg-zinc-950
                  px-4
                  py-3
                  pr-11
                  text-sm
                  text-white
                  outline-none
                  transition
                  hover:border-zinc-700
                  focus:border-blue-500/50
                  focus:ring-2
                  focus:ring-blue-500/10
                "
              >
                <option value="active">
                  Active
                </option>

                <option value="inactive">
                  Inactive
                </option>

              </select>

              <ChevronDown
                size={16}
                className="
                  pointer-events-none
                  absolute
                  right-4
                  top-1/2
                  -translate-y-1/2
                  text-zinc-500
                "
              />

            </div>

          </div>

        </div>

        {/* =========================
            GENERAL FOOTER
        ========================= */}

        <div className="flex min-h-[78px] flex-wrap items-center justify-between gap-4 border-t border-zinc-800 px-6 py-5">

          {/* MESSAGE */}

          <div className="min-h-5">

            {message && (
              <div
                className={`flex items-center gap-2 text-sm ${
                  messageType ===
                  "success"
                    ? "text-emerald-400"
                    : "text-red-400"
                }`}
              >

                {messageType ===
                "success" ? (
                  <CheckCircle2
                    size={16}
                    className="shrink-0"
                  />
                ) : (
                  <CircleAlert
                    size={16}
                    className="shrink-0"
                  />
                )}

                <span>
                  {message}
                </span>

              </div>
            )}

          </div>

          {/* SAVE */}

          <button
            type="button"
            onClick={
              saveClient
            }
            disabled={
              saving
            }
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >

            <Save
              size={16}
            />

            {saving
              ? "Saving..."
              : "Save changes"}

          </button>

        </div>

      </section>

      {/* =========================
          SITES
      ========================= */}

      <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">

        <div className="flex flex-wrap items-center justify-between gap-5 border-b border-zinc-800 px-6 py-5">

          <div className="flex items-center gap-3">

            <MapPin
              size={18}
              className="text-zinc-500"
            />

            <div>

              <h2 className="font-semibold">
                Sites
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Locations used to organize and filter devices.
              </p>

            </div>

          </div>

          <button
            type="button"
            onClick={
              openCreateSite
            }
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
          >
            <Plus size={16} />
            Add site
          </button>

        </div>

        {sites.length === 0 ? (

          <div className="flex items-center gap-4 px-6 py-6">

            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-600">
              <MapPin size={18} />
            </div>

            <div>

              <p className="text-sm font-medium">
                No sites configured
              </p>

              <p className="mt-1 text-xs text-zinc-500">
                Add a site to group and filter devices.
              </p>

            </div>

          </div>

        ) : (

          <div className="divide-y divide-zinc-800">

            {sites.map(
              (site) => {
                const siteDevices =
                  devices.filter(
                    (device) =>
                      device.site_id ===
                      site.id
                  );

                return (
                  <div
                    key={
                      site.id
                    }
                    className="flex flex-wrap items-center justify-between gap-5 px-6 py-4"
                  >

                    <div className="flex min-w-0 items-center gap-4">

                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-500">
                        <MapPin
                          size={18}
                        />
                      </div>

                      <div className="min-w-0">

                        <p className="truncate text-sm font-medium">
                          {site.name}
                        </p>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">

                          <span>
                            {site.location ||
                              "No location specified"}
                          </span>

                          <span className="text-zinc-700">
                            •
                          </span>

                          <span>
                            {siteDevices.length}{" "}
                            {siteDevices.length ===
                            1
                              ? "device"
                              : "devices"}
                          </span>

                        </div>

                      </div>

                    </div>

                    <div className="flex items-center gap-2">

                      <button
                        type="button"
                        onClick={() =>
                          openManageDevices(
                            site
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                      >
                        <Monitor
                          size={14}
                        />

                        Manage devices
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          openEditSite(
                            site
                          )
                        }
                        title="Edit site"
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-white"
                      >
                        <Pencil
                          size={16}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setDeleteSite(
                            site
                          )
                        }
                        title="Delete site"
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-red-950/40 hover:text-red-400"
                      >
                        <Trash2
                          size={16}
                        />
                      </button>

                    </div>

                  </div>
                );
              }
            )}

          </div>

        )}

      </section>

      {/* =========================
          DANGER ZONE
      ========================= */}

      <section className="overflow-hidden rounded-2xl border border-red-950 bg-red-950/10">

        <div className="flex flex-wrap items-center justify-between gap-6 p-6">

          <div className="flex items-start gap-4">

            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-950 bg-red-950/20 text-red-500">
              <AlertTriangle
                size={18}
              />
            </div>

            <div>

              <h2 className="font-semibold text-red-400">
                Delete client
              </h2>

              <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500">
                Permanently delete this client and all associated sites, devices and data.
              </p>

            </div>

          </div>

          <button
            type="button"
            onClick={() => {
              setDeleteConfirm("");

              setDeleteOpen(
                true
              );
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-red-900 bg-red-950/30 px-4 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-950/60"
          >
            <Trash2 size={16} />
            Delete client
          </button>

        </div>

      </section>

      {/* =========================
          CREATE / EDIT SITE MODAL
      ========================= */}

      {siteModalOpen && (
        <>

          <button
            type="button"
            aria-label="Close site modal"
            onClick={
              closeSiteModal
            }
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />

          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">

            <div className="flex items-start justify-between gap-5 border-b border-zinc-800 px-6 py-5">

              <div>

                <h2 className="text-lg font-semibold">
                  {editingSite
                    ? "Edit site"
                    : "Add site"}
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {editingSite
                    ? "Update this site."
                    : "Create a location used to group devices."}
                </p>

              </div>

              <button
                type="button"
                onClick={
                  closeSiteModal
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-900 hover:text-white"
              >
                <X size={18} />
              </button>

            </div>

            <div className="space-y-5 p-6">

              <div>

                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Site name
                </label>

                <input
                  type="text"
                  value={
                    siteName
                  }
                  onChange={(e) =>
                    setSiteName(
                      e.target.value
                    )
                  }
                  placeholder="Lisbon Office"
                  autoFocus
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                />

              </div>

              <div>

                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Location
                </label>

                <input
                  type="text"
                  value={
                    siteLocation
                  }
                  onChange={(e) =>
                    setSiteLocation(
                      e.target.value
                    )
                  }
                  placeholder="Lisbon, Portugal"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                />

              </div>

              <div>

                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Description
                </label>

                <textarea
                  value={
                    siteDescription
                  }
                  onChange={(e) =>
                    setSiteDescription(
                      e.target.value
                    )
                  }
                  rows={3}
                  placeholder="Optional notes..."
                  className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                />

              </div>

              {siteError && (
                <div className="rounded-xl border border-red-950 bg-red-950/20 px-4 py-3 text-sm text-red-400">
                  {siteError}
                </div>
              )}

            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-800 px-6 py-5">

              <button
                type="button"
                onClick={
                  closeSiteModal
                }
                className="rounded-xl border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-900"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  saveSite
                }
                disabled={
                  savingSite
                }
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={16} />

                {savingSite
                  ? "Saving..."
                  : editingSite
                  ? "Save site"
                  : "Add site"}
              </button>

            </div>

          </div>

        </>
      )}

      {/* =========================
          MANAGE DEVICES MODAL
      ========================= */}

      {manageSite && (
        <>

          <button
            type="button"
            aria-label="Close manage devices"
            onClick={() =>
              setManageSite(
                null
              )
            }
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />

          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">

            <div className="flex items-start justify-between gap-5 border-b border-zinc-800 px-6 py-5">

              <div>

                <h2 className="text-lg font-semibold">
                  Manage devices
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Assign devices to{" "}

                  <span className="text-zinc-300">
                    {manageSite.name}
                  </span>
                  .
                </p>

              </div>

              <button
                type="button"
                onClick={() =>
                  setManageSite(
                    null
                  )
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-900 hover:text-white"
              >
                <X size={18} />
              </button>

            </div>

            <div className="max-h-[450px] overflow-y-auto p-4">

              {devices.length === 0 ? (

                <div className="py-12 text-center">

                  <Monitor
                    size={23}
                    className="mx-auto text-zinc-600"
                  />

                  <p className="mt-4 text-sm font-medium">
                    No devices available
                  </p>

                  <p className="mt-2 text-xs text-zinc-500">
                    Devices must first be registered for this client.
                  </p>

                </div>

              ) : (

                <div className="space-y-2">

                  {devices.map(
                    (device) => {
                      const checked =
                        selectedDevices.includes(
                          device.id
                        );

                      const currentSite =
                        getSiteName(
                          device.site_id
                        );

                      const belongsToAnotherSite =
                        device.site_id &&
                        device.site_id !==
                          manageSite.id;

                      return (
                        <label
                          key={
                            device.id
                          }
                          className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl border px-4 py-3 transition ${
                            checked
                              ? "border-zinc-600 bg-zinc-900"
                              : "border-zinc-800 hover:bg-zinc-900/60"
                          }`}
                        >

                          <div className="flex min-w-0 items-center gap-3">

                            <div
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                checked
                                  ? "border-white bg-white text-black"
                                  : "border-zinc-700 bg-zinc-950"
                              }`}
                            >
                              {checked && (
                                <Check
                                  size={13}
                                />
                              )}
                            </div>

                            <input
                              type="checkbox"
                              className="hidden"
                              checked={
                                checked
                              }
                              onChange={(e) => {
                                if (
                                  e.target
                                    .checked
                                ) {
                                  setSelectedDevices(
                                    (
                                      current
                                    ) => [
                                      ...current,
                                      device.id,
                                    ]
                                  );
                                } else {
                                  setSelectedDevices(
                                    (
                                      current
                                    ) =>
                                      current.filter(
                                        (
                                          id
                                        ) =>
                                          id !==
                                          device.id
                                      )
                                  );
                                }
                              }}
                            />

                            <div className="min-w-0">

                              <p className="truncate text-sm font-medium">
                                {device.display_name ||
                                  device.hostname}
                              </p>

                              <p className="mt-1 truncate text-xs text-zinc-500">
                                {device.hostname}
                              </p>

                            </div>

                          </div>

                          <div className="shrink-0 text-right">

                            {belongsToAnotherSite ? (
                              <>
                                <p className="text-xs text-zinc-600">
                                  Currently
                                </p>

                                <p className="mt-1 text-xs text-zinc-400">
                                  {currentSite}
                                </p>
                              </>
                            ) : device.site_id ===
                              manageSite.id ? (
                              <span className="text-xs text-emerald-400">
                                Assigned
                              </span>
                            ) : (
                              <span className="text-xs text-zinc-600">
                                No site
                              </span>
                            )}

                          </div>

                        </label>
                      );
                    }
                  )}

                </div>

              )}

            </div>

            <div className="flex items-center justify-between gap-4 border-t border-zinc-800 px-6 py-5">

              <p className="text-xs text-zinc-600">
                {selectedDevices.length}{" "}
                selected
              </p>

              <div className="flex gap-3">

                <button
                  type="button"
                  onClick={() =>
                    setManageSite(
                      null
                    )
                  }
                  className="rounded-xl border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-900"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={
                    saveSiteDevices
                  }
                  disabled={
                    savingDevices
                  }
                  className="rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDevices
                    ? "Saving..."
                    : "Save devices"}
                </button>

              </div>

            </div>

          </div>

        </>
      )}

      {/* =========================
          DELETE SITE MODAL
      ========================= */}

      {deleteSite && (
        <>

          <button
            type="button"
            aria-label="Close delete site"
            onClick={() =>
              setDeleteSite(
                null
              )
            }
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />

          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">

            <div className="p-6">

              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-red-950 bg-red-950/20 text-red-500">
                <Trash2
                  size={18}
                />
              </div>

              <h2 className="mt-5 text-lg font-semibold">
                Delete site?
              </h2>

              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Delete{" "}

                <span className="font-medium text-zinc-200">
                  {deleteSite.name}
                </span>

                ? Devices assigned to this site will remain registered, but will no longer have a site.
              </p>

            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-800 px-6 py-5">

              <button
                type="button"
                onClick={() =>
                  setDeleteSite(
                    null
                  )
                }
                className="rounded-xl border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-900"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  confirmDeleteSite
                }
                disabled={
                  deletingSite
                }
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                <Trash2
                  size={16}
                />

                {deletingSite
                  ? "Deleting..."
                  : "Delete site"}
              </button>

            </div>

          </div>

        </>
      )}

      {/* =========================
          DELETE CLIENT MODAL
      ========================= */}

      {deleteOpen && (
        <>

          <button
            type="button"
            aria-label="Close confirmation"
            onClick={() =>
              setDeleteOpen(
                false
              )
            }
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />

          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-red-950 bg-zinc-950 shadow-2xl">

            <div className="flex items-start justify-between gap-5 border-b border-zinc-800 px-6 py-5">

              <div>

                <h2 className="text-lg font-semibold">
                  Delete{" "}
                  {client.name}?
                </h2>

                <p className="mt-2 text-sm text-zinc-500">
                  This action cannot be undone.
                </p>

              </div>

              <button
                type="button"
                onClick={() =>
                  setDeleteOpen(
                    false
                  )
                }
                className="text-zinc-500 transition hover:text-white"
              >
                <X size={19} />
              </button>

            </div>

            <div className="p-6">

              <div className="rounded-xl border border-red-950 bg-red-950/20 p-4">

                <div className="flex gap-3">

                  <AlertTriangle
                    size={18}
                    className="mt-0.5 shrink-0 text-red-500"
                  />

                  <p className="text-sm leading-6 text-red-300">
                    All devices, sites and related data belonging to this client may be permanently deleted.
                  </p>

                </div>

              </div>

              <div className="mt-6">

                <label className="mb-2 block text-sm text-zinc-400">
                  Type{" "}

                  <span className="font-semibold text-white">
                    {client.name}
                  </span>{" "}

                  to confirm.
                </label>

                <input
                  type="text"
                  value={
                    deleteConfirm
                  }
                  onChange={(e) =>
                    setDeleteConfirm(
                      e.target.value
                    )
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white outline-none transition focus:border-red-900"
                />

              </div>

            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-800 px-6 py-5">

              <button
                type="button"
                onClick={() =>
                  setDeleteOpen(
                    false
                  )
                }
                className="rounded-xl border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-900"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  deleteClient
                }
                disabled={
                  deleting ||
                  deleteConfirm.trim() !==
                    client.name
                }
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2
                  size={16}
                />

                {deleting
                  ? "Deleting..."
                  : "Delete client"}
              </button>

            </div>

          </div>

        </>
      )}

    </div>
  );
}