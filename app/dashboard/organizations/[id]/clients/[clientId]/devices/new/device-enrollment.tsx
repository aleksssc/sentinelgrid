"use client";

import {
  Check,
  ChevronDown,
  Copy,
  Download,
  KeyRound,
  Laptop,
  Loader2,
  MonitorDown,
  RefreshCw,
  TerminalSquare,
} from "lucide-react";

import {
  useMemo,
  useState,
} from "react";

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
  const [siteId, setSiteId] =
    useState("");

  const [
    operatingSystem,
    setOperatingSystem,
  ] =
    useState<OperatingSystem>(
      "windows"
    );

  const [token, setToken] =
    useState("");

  const [
    expiresAt,
    setExpiresAt,
  ] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [copied, setCopied] =
    useState(false);

  const [error, setError] =
    useState("");

  const [siteOpen, setSiteOpen] =
  useState(false);

  /* =========================
     INSTALL LINK
  ========================= */

  const installLink =
    useMemo(() => {
      if (
        !token ||
        typeof window ===
          "undefined"
      ) {
        return "";
      }

      return `${window.location.origin}/install/${token}`;
    }, [token]);

  /* =========================
     DEVELOPMENT COMMAND
  ========================= */

  const developmentCommand =
    useMemo(() => {
      if (
        !token ||
        typeof window ===
          "undefined"
      ) {
        return "";
      }

      return `.\\SentinelGridAgent.exe -server "${window.location.origin}" -token "${token}"`;
    }, [token]);

  /* =========================
     GENERATE INSTALLER
  ========================= */

  async function generatePackage() {
    setLoading(true);
    setError("");
    setCopied(false);

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

            body:
              JSON.stringify({
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
        error instanceof
          Error
          ? error.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  /* =========================
     COPY LINK
  ========================= */

  async function copyInstallLink() {
    if (!installLink) {
      return;
    }

    await navigator.clipboard.writeText(
      installLink
    );

    setCopied(true);

    window.setTimeout(
      () => {
        setCopied(false);
      },
      2000
    );
  }

  /* =========================
     RESET
  ========================= */

  function resetPackage() {
    setToken("");
    setExpiresAt("");
    setCopied(false);
    setError("");
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d0f12]">

      {/* =========================
          HEADER
      ========================= */}

      <div className="border-b border-zinc-800 px-6 py-5">

        <div className="flex items-start gap-4">

          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-[#08090b] text-zinc-500">
            <Laptop
              size={19}
            />
          </div>

          <div>

            <h2 className="text-base font-semibold text-white">
              Deploy SentinelGrid Agent
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Generate an installer
              and deploy the
              SentinelGrid Agent to a
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

              <p className="mt-1 text-xs text-zinc-600">
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
                      ? "border-zinc-600 bg-[#1b1c1f] text-white"
                      : "border-zinc-800 bg-[#090a0c] text-zinc-500 hover:border-zinc-700 hover:bg-[#101114] hover:text-zinc-300"
                  }`}
                >

                  <span className="text-sm font-medium">
                    Windows
                  </span>

                  <span className="mt-1 text-xs text-zinc-600">
                    MSI · x64
                  </span>

                </button>

                {/* MACOS */}

                <button
                  type="button"
                  disabled
                  className="flex min-h-[76px] cursor-not-allowed flex-col justify-center rounded-xl border border-zinc-800 bg-[#090a0c] px-4 py-3 text-left opacity-45"
                >

                  <span className="text-sm font-medium text-zinc-400">
                    macOS
                  </span>

                  <span className="mt-1 text-xs text-zinc-600">
                    Coming soon
                  </span>

                </button>

                {/* LINUX */}

                <button
                  type="button"
                  disabled
                  className="flex min-h-[76px] cursor-not-allowed flex-col justify-center rounded-xl border border-zinc-800 bg-[#090a0c] px-4 py-3 text-left opacity-45"
                >

                  <span className="text-sm font-medium text-zinc-400">
                    Linux
                  </span>

                  <span className="mt-1 text-xs text-zinc-600">
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

              <p className="mt-1 text-xs text-zinc-600">
                Assign the device to a site during enrollment.
              </p>

              <div className="relative mt-3">

                <button
                  type="button"
                  onClick={() =>
                    setSiteOpen(
                      (value) => !value
                    )
                  }
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition ${
                    siteOpen
                      ? "border-zinc-600 bg-[#101114]"
                      : "border-zinc-800 bg-[#090a0c] hover:border-zinc-700"
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
                  <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-[#111214] shadow-2xl">

                    <button
                      type="button"
                      onClick={() => {
                        setSiteId("");
                        setSiteOpen(false);
                      }}
                      className={`flex w-full items-center px-4 py-3 text-left text-sm transition ${
                        siteId === ""
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-400 hover:bg-zinc-800/70 hover:text-white"
                      }`}
                    >
                      No site
                    </button>

                    {sites.map(
                      (site) => (

                        <button
                          key={site.id}
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
                              ? "bg-zinc-800 text-white"
                              : "text-zinc-400 hover:bg-zinc-800/70 hover:text-white"
                          }`}
                        >
                          {site.name}
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

              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>

            )}

            {/* =========================
                FOOTER
            ========================= */}

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-800 pt-5">

              <p className="text-xs text-zinc-600">
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
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
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

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">

              <div className="flex items-start gap-3">

                <Check
                  size={18}
                  className="mt-0.5 shrink-0 text-emerald-400"
                />

                <div>

                  <p className="text-sm font-medium text-emerald-400">
                    Installer ready
                  </p>

                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    This enrollment
                    package is valid
                    for 30 minutes and
                    can only be used
                    once.
                  </p>

                  {expiresAt && (

                    <p className="mt-1 text-xs text-zinc-600">
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
                INSTALL LINK
            ========================= */}

            <div className="mt-6">

              <p className="text-sm font-medium text-zinc-300">
                Installation link
              </p>

              <p className="mt-1 text-xs text-zinc-600">
                Send this link to the
                person installing the
                agent.
              </p>

              <div className="mt-3 flex items-center gap-3 rounded-xl border border-zinc-800 bg-[#08090b] p-3">

                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2 font-mono text-xs text-zinc-400">
                  {installLink}
                </code>

                <button
                  type="button"
                  onClick={
                    copyInstallLink
                  }
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-zinc-800 bg-[#111214] px-3 text-xs font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-white"
                >

                  {copied ? (

                    <>
                      <Check
                        size={14}
                      />

                      Copied
                    </>

                  ) : (

                    <>
                      <Copy
                        size={14}
                      />

                      Copy
                    </>

                  )}

                </button>

              </div>

            </div>

            {/* =========================
                DOWNLOAD MSI
            ========================= */}

            <div className="mt-5 rounded-xl border border-zinc-800 bg-[#090a0c] p-4">

              <div className="flex flex-wrap items-center justify-between gap-4">

                <div className="flex items-center gap-4">

                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-[#08090b] text-zinc-500">

                    <MonitorDown
                      size={18}
                    />

                  </div>

                  <div>

                    <p className="text-sm font-medium text-zinc-200">
                      Windows Installer
                    </p>

                    <p className="mt-1 text-xs text-zinc-600">
                      SentinelGrid
                      Agent · x64 · MSI
                    </p>

                  </div>

                </div>

                <a
                  href={`/api/agent/download?token=${encodeURIComponent(
                    token
                  )}`}
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
                >
                  <Download
                    size={16}
                  />

                  Download .MSI
                </a>

              </div>

            </div>

            {/* =========================
                ADVANCED
            ========================= */}

            <details className="mt-5 overflow-hidden rounded-xl border border-zinc-800 bg-[#090a0c]">

              <summary className="cursor-pointer px-4 py-3 text-sm text-zinc-500 transition hover:text-zinc-300">
                Advanced installation
              </summary>

              <div className="border-t border-zinc-800 p-4">

                <div className="mb-3 flex items-center gap-2">

                  <TerminalSquare
                    size={15}
                    className="text-zinc-600"
                  />

                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-600">
                    Development command
                  </p>

                </div>

                <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-[#08090b] px-4 py-3">

                  <code className="whitespace-nowrap font-mono text-xs text-zinc-500">
                    {
                      developmentCommand
                    }
                  </code>

                </div>

              </div>

            </details>

            {/* =========================
                RESET
            ========================= */}

            <div className="mt-5 flex justify-end border-t border-zinc-800 pt-5">

              <button
                type="button"
                onClick={
                  resetPackage
                }
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-[#111214] px-4 py-2.5 text-sm font-medium text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
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