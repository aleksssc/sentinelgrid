"use client";

import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  MonitorDown,
  RefreshCw,
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

export default function DeviceEnrollment({
  organizationId,
  clientId,
  sites,
}: Props) {
  const [
    siteId,
    setSiteId,
  ] =
    useState("");

  const [
    token,
    setToken,
  ] =
    useState("");

  const [
    expiresAt,
    setExpiresAt,
  ] =
    useState("");

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    copied,
    setCopied,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  /* =========================
     INSTALL COMMAND
  ========================= */

  const command =
    useMemo(() => {
      if (!token) {
        return "";
      }

      if (
        typeof window ===
        "undefined"
      ) {
        return "";
      }

      const server =
        window.location.origin;

      return `.\\SentinelGridAgent.exe -server "${server}" -token "${token}"`;
    }, [token]);

  /* =========================
     GENERATE TOKEN
  ========================= */

  async function generateToken() {
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
            "Could not generate enrollment token."
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
        "Enrollment token error:",
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
     GENERATE NEW TOKEN
  ========================= */

  function resetToken() {
    setToken("");
    setExpiresAt("");
    setCopied(false);
    setError("");
  }

  /* =========================
     COPY COMMAND
  ========================= */

  async function copyCommand() {
    if (!command) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        command
      );

      setCopied(true);

      window.setTimeout(
        () => {
          setCopied(false);
        },
        2000
      );
    } catch (error) {
      console.error(
        "Copy error:",
        error
      );
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d0f12]">

      {/* =========================
          HEADER
      ========================= */}

      <div className="border-b border-zinc-800 bg-[#0d0f12] px-6 py-5">

        <div className="flex items-start gap-3">

          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-[#08090b] text-zinc-500">
            <KeyRound
              size={18}
            />
          </div>

          <div>

            <h2 className="font-semibold text-white">
              Agent enrollment
            </h2>

            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Generate a temporary
              enrollment token and run
              the SentinelGrid Agent on
              the device.
            </p>

          </div>

        </div>

      </div>

      {/* =========================
          CONTENT
      ========================= */}

      <div className="p-6">

        {/* =========================
            SITE
        ========================= */}

        <div>

          <label
            htmlFor="site"
            className="text-sm font-medium text-zinc-300"
          >
            Site
          </label>

          <p className="mt-1 text-xs leading-5 text-zinc-600">
            Assign this device to a
            site during enrollment.
            This is optional.
          </p>

          <select
            id="site"
            value={siteId}
            onChange={(
              event
            ) =>
              setSiteId(
                event.target.value
              )
            }
            disabled={
              Boolean(token)
            }
            className="mt-3 w-full rounded-xl border border-zinc-800 bg-[#08090b] px-4 py-3 text-sm text-zinc-300 outline-none transition hover:border-zinc-700 focus:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">
              No site
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

          {sites.length === 0 && (
            <p className="mt-2 text-xs text-zinc-600">
              No sites are currently
              configured for this
              client.
            </p>
          )}

        </div>

        {/* =========================
            ERROR
        ========================= */}

        {error && (
          <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* =========================
            GENERATE
        ========================= */}

        {!token && (
          <button
            type="button"
            onClick={
              generateToken
            }
            disabled={
              loading
            }
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
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
              : "Generate enrollment token"}
          </button>
        )}

        {/* =========================
            GENERATED
        ========================= */}

        {token && (
          <div className="mt-6">

            {/* SUCCESS */}

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">

              <div className="flex items-start gap-3">

                <Check
                  size={18}
                  className="mt-0.5 shrink-0 text-emerald-400"
                />

                <div>

                  <p className="text-sm font-medium text-emerald-400">
                    Enrollment token
                    ready
                  </p>

                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    This token can only
                    be used once and is
                    valid for 30
                    minutes.
                  </p>

                  {expiresAt && (
                    <p className="mt-1 text-xs text-zinc-600">
                      Expires:{" "}
                      {new Date(
                        expiresAt
                      ).toLocaleString()}
                    </p>
                  )}

                </div>

              </div>

            </div>

            {/* =========================
                INSTALL COMMAND
            ========================= */}

            <div className="mt-6">

              <div className="mb-3 flex items-center gap-2">

                <MonitorDown
                  size={16}
                  className="text-zinc-500"
                />

                <p className="text-sm font-medium text-zinc-300">
                  Run on the device
                </p>

              </div>

              <p className="mb-3 text-xs leading-5 text-zinc-600">
                Place
                SentinelGridAgent.exe
                on the target device,
                open PowerShell and run:
              </p>

              <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-[#08090b] p-3">

                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2 font-mono text-xs text-zinc-400">
                  {command}
                </code>

                <button
                  type="button"
                  onClick={
                    copyCommand
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
                TOKEN
            ========================= */}

            <div className="mt-5">

              <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-zinc-600">
                Enrollment token
              </p>

              <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-[#08090b] px-4 py-3">

                <code className="whitespace-nowrap font-mono text-xs text-zinc-500">
                  {token}
                </code>

              </div>

            </div>

            {/* =========================
                NEW TOKEN
            ========================= */}

            <div className="mt-6 border-t border-zinc-800 pt-5">

              <button
                type="button"
                onClick={
                  resetToken
                }
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-[#111214] px-4 py-2.5 text-sm font-medium text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
              >
                <RefreshCw
                  size={15}
                />

                Generate another token
              </button>

            </div>

          </div>
        )}

      </div>

    </div>
  );
}