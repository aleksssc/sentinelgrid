"use client";

import {
  Check,
  ChevronDown,
  Download,
  KeyRound,
  Laptop,
  Loader2,
  MonitorDown,
  RefreshCw,
} from "lucide-react";

import { useState } from "react";

type Site = {
  id: string;
  name: string;
};

type Props = {
  organizationId: string;
  clientId: string;
  sites: Site[];
};

type OperatingSystem =
  | "windows"
  | "macos"
  | "linux";

export default function DeviceEnrollment({
  organizationId,
  clientId,
  sites,
}: Props) {
  const [
    siteId,
    setSiteId,
  ] = useState("");

  const [
    operatingSystem,
    setOperatingSystem,
  ] =
    useState<OperatingSystem>(
      "windows"
    );

  const [
    token,
    setToken,
  ] = useState("");

  const [
    expiresAt,
    setExpiresAt,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    siteOpen,
    setSiteOpen,
  ] = useState(false);

  /* =========================
     GENERATE INSTALLER
  ========================= */

  async function generatePackage() {
    setLoading(true);
    setError("");

    try {
      const response =
        await fetch(
          "/api/agent/enrollment-token",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              organizationId,
              clientId,

              siteId:
                siteId ||
                null,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Could not generate installer."
        );
      }

      setToken(
        data.token
      );

      setExpiresAt(
        data.expiresAt
      );
    } catch (error) {
      console.error(
        "Generate installer error:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  /* =========================
     RESET
  ========================= */

  function resetPackage() {
    setToken("");
    setExpiresAt("");
    setError("");
  }

  return (
    <div className="sg-surface overflow-hidden">

      {/* =========================
          HEADER
      ========================= */}

      <div className="border-b border-surface-edge px-6 py-5">

        <div className="flex items-start gap-4">

          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-surface-edge bg-surface-inset text-surface-muted">

            <Laptop
              size={19}
            />

          </div>

          <div>

            <h2 className="sg-section-title text-white">
              Deploy SentinelGrid Agent
            </h2>

            <p className="mt-1 text-sm text-surface-muted">
              Generate and download
              the SentinelGrid Agent
              installer for this
              device.
            </p>

          </div>

        </div>

      </div>

      {/* =========================
          CONTENT
      ========================= */}

      <div className="p-6">

        {!token ? (

          <div className="space-y-7">

            {/* =========================
                OPERATING SYSTEM
            ========================= */}

            <div>

              <label className="text-sm font-medium text-zinc-300">
                Operating system
              </label>

              <p className="mt-1 text-xs text-surface-muted">
                Select the operating
                system of the target
                device.
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">

                {/* WINDOWS */}

                <button
                  type="button"
                  onClick={() =>
                    setOperatingSystem(
                      "windows"
                    )
                  }
                  className={`flex min-h-[76px] flex-col justify-center rounded-xl border px-4 py-3 text-left transition ${
                    operatingSystem ===
                    "windows"
                      ? "border-surface-accent-edge bg-surface-selected text-surface-accent"
                      : "border-zinc-800 bg-surface-inset text-surface-muted hover:border-surface-accent-edge hover:bg-surface-hover hover:text-zinc-300"
                  }`}
                >

                  <span className="text-sm font-medium">
                    Windows
                  </span>

                  <span className="mt-1 text-xs text-surface-muted">
                    MSI · x64
                  </span>

                </button>

                {/* MACOS */}

                <button
                  type="button"
                  disabled
                  className="sg-button sg-button-secondary min-h-[76px] cursor-not-allowed flex-col text-left opacity-45"
                >

                  <span className="text-sm font-medium text-zinc-400">
                    macOS
                  </span>

                  <span className="mt-1 text-xs text-surface-muted">
                    Coming soon
                  </span>

                </button>

                {/* LINUX */}

                <button
                  type="button"
                  disabled
                  className="sg-button sg-button-secondary min-h-[76px] cursor-not-allowed flex-col text-left opacity-45"
                >

                  <span className="text-sm font-medium text-zinc-400">
                    Linux
                  </span>

                  <span className="mt-1 text-xs text-surface-muted">
                    Coming soon
                  </span>

                </button>

              </div>

            </div>

            {/* =========================
                SITE
            ========================= */}

            <div className="relative">

              <label className="text-sm font-medium text-zinc-300">
                Site
              </label>

              <p className="mt-1 text-xs text-surface-muted">
                Assign the device to a
                site during enrollment.
              </p>

              <div className="relative mt-3">

                <button
                  type="button"
                  onClick={() =>
                    setSiteOpen(
                      (value) =>
                        !value
                    )
                  }
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition ${
                    siteOpen
                      ? "border-surface-accent-edge bg-surface-selected"
                      : "border-zinc-800 bg-surface-inset hover:border-surface-accent-edge"
                  }`}
                >

                  <span
                    className={
                      siteId
                        ? "text-zinc-200"
                        : "text-zinc-400"
                    }
                  >

                    {siteId
                      ? sites.find(
                          (site) =>
                            site.id ===
                            siteId
                        )?.name
                      : "No site"}

                  </span>

                  <ChevronDown
                    size={16}
                    className={`text-zinc-600 transition-transform duration-200 ${
                      siteOpen
                        ? "rotate-180"
                        : ""
                    }`}
                  />

                </button>

                {siteOpen && (

                  <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-surface-edge bg-surface-raised shadow-2xl">

                    <button
                      type="button"
                      onClick={() => {
                        setSiteId("");
                        setSiteOpen(false);
                      }}
                      className={`flex w-full items-center px-4 py-3 text-left text-sm transition ${
                        siteId === ""
                          ? "bg-surface-selected text-surface-accent"
                          : "text-zinc-400 hover:bg-surface-hover hover:text-white"
                      }`}
                    >
                      No site
                    </button>

                    {sites.map(
                      (site) => (

                        <button
                          key={
                            site.id
                          }
                          type="button"
                          onClick={() => {
                            setSiteId(
                              site.id
                            );

                            setSiteOpen(
                              false
                            );
                          }}
                          className={`flex w-full items-center px-4 py-3 text-left text-sm transition ${
                            siteId ===
                            site.id
                              ? "bg-surface-selected text-surface-accent"
                              : "text-zinc-400 hover:bg-surface-hover hover:text-white"
                          }`}
                        >
                          {
                            site.name
                          }
                        </button>

                      )
                    )}

                  </div>

                )}

              </div>

            </div>

            {/* =========================
                ERROR
            ========================= */}

            {error && (

              <div className="rounded-xl border border-red-950 bg-[#120b0d] px-4 py-3 text-sm text-red-400">
                {error}
              </div>

            )}

            {/* =========================
                FOOTER
            ========================= */}

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-surface-edge pt-5">

              <p className="text-xs text-surface-muted">
                The installer will be
                linked to this client
                and site.
              </p>

              <button
                type="button"
                onClick={
                  generatePackage
                }
                disabled={
                  loading ||
                  operatingSystem !==
                    "windows"
                }
                className="sg-button sg-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              >

                {loading ? (

                  <Loader2
                    size={17}
                    className="animate-spin"
                  />

                ) : (

                  <KeyRound
                    size={17}
                  />

                )}

                {loading
                  ? "Generating..."
                  : "Generate installer"}

              </button>

            </div>

          </div>

        ) : (

          <>

            {/* =========================
                READY
            ========================= */}

            <div className="rounded-xl border border-emerald-950 bg-[#07130f] p-4">

              <div className="flex items-start gap-3">

                <Check
                  size={18}
                  className="mt-0.5 shrink-0 text-emerald-400"
                />

                <div>

                  <p className="text-sm font-medium text-emerald-400">
                    Installer ready
                  </p>

                  <p className="mt-1 text-xs leading-5 text-surface-muted">
                    This installer is
                    valid for 30
                    minutes and can
                    only be used once.
                  </p>

                  {expiresAt && (

                    <p className="mt-1 text-xs text-surface-muted">
                      Expires{" "}
                      {new Date(
                        expiresAt
                      ).toLocaleString()}
                    </p>

                  )}

                </div>

              </div>

            </div>

            {/* =========================
                WINDOWS INSTALLER
            ========================= */}

            <div className="mt-5 rounded-xl border border-surface-edge bg-surface-inset p-4">

              <div className="flex flex-wrap items-center justify-between gap-4">

                <div className="flex items-center gap-4">

                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-surface-edge bg-surface-inset text-surface-muted">

                    <MonitorDown
                      size={18}
                    />

                  </div>

                  <div>

                    <p className="text-sm font-medium text-zinc-200">
                      Windows Installer
                    </p>

                    <p className="mt-1 text-xs text-surface-muted">
                      SentinelGrid Agent
                      · x64 · MSI
                    </p>

                  </div>

                </div>

                <a
                  href={`/api/agent/download?token=${encodeURIComponent(
                    token
                  )}`}
                  className="sg-button sg-button-primary"
                >

                  <Download
                    size={16}
                  />

                  Download .MSI

                </a>

              </div>

            </div>

            {/* =========================
                RESET
            ========================= */}

            <div className="mt-5 flex justify-end border-t border-surface-edge pt-5">

              <button
                type="button"
                onClick={
                  resetPackage
                }
                className="sg-button sg-button-secondary"
              >

                <RefreshCw
                  size={15}
                />

                Generate another installer

              </button>

            </div>

          </>

        )}

      </div>

    </div>
  );
}