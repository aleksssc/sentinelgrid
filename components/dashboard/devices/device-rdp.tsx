"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Monitor, Play, RotateCcw, X } from "lucide-react";
import ViewportDialog from "@/components/dashboard/viewport-dialog";
import { RemoteFeatureGate } from "@/components/dashboard/devices/remote-feature-gate";
import type { RemoteFeatureAccess } from "@/lib/remote-feature-access";
import { remoteErrorMessage } from "@/lib/remote-feature-errors";

type Session = { sessionId: string; expiresAt: string; status: string };
type Props = { deviceId: string; available: boolean; access: RemoteFeatureAccess };

function errorMessage(error: unknown, fallback: string) {
  return remoteErrorMessage(error instanceof Error ? error.message : error, fallback);
}

export default function DeviceRDP({ deviceId, available, access }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const sessionId = session?.sessionId;

  useEffect(() => {
    if (!access.canUse) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/devices/${deviceId}/rdp`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 204) return;
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "SESSION_LOOKUP_FAILED");
        setSession(body);
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessage(errorMessage(error, "Remote Desktop session status is unavailable."));
        }
      }
    })();
    return () => controller.abort();
  }, [deviceId, access.canUse]);

  useEffect(() => {
    if (!access.canUse || !sessionId) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/devices/${deviceId}/rdp/${sessionId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "SESSION_LOOKUP_FAILED");
        if (["closed", "failed"].includes(body.status) || Date.parse(body.expiresAt) <= Date.now()) {
          setSession(null);
        } else {
          setSession(body);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessage(errorMessage(error, "Remote Desktop session status is unavailable."));
        }
      }
    }, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [deviceId, sessionId, access.canUse]);

  async function closeSession(current: Session) {
    const response = await fetch(`/api/devices/${deviceId}/rdp/${current.sessionId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || "SESSION_CLOSE_FAILED");
    }
    setSession(null);
  }

  async function start() {
    if (!available || busy) return;
    setBusy(true);
    setMessage("");
    try {
      // A browser protocol launch can fail without consuming the RDP session.
      // Reconnect always starts from a fresh one-use launch token.
      if (session) await closeSession(session);

      const response = await fetch(`/api/devices/${deviceId}/rdp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "SESSION_CREATE_FAILED");

      setSession({
        sessionId: body.sessionId,
        expiresAt: body.expiresAt,
        status: "requested",
      });

      // Keep the dialog open. Browsers do not expose a reliable API for testing
      // whether a custom protocol handler exists, so the UI must not guess.
      window.location.href = body.launchUrl;
    } catch (error) {
      setMessage(errorMessage(error, "Remote Desktop request failed."));
    } finally {
      setBusy(false);
    }
  }

  if (!access.canUse) {
    return (
      <RemoteFeatureGate access={access} feature="Remote Desktop">
        <button type="button" className="sg-button sg-button-secondary">
          <ExternalLink size={16} />
          Remote Desktop
        </button>
      </RemoteFeatureGate>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMessage("");
          setDialogOpen(true);
        }}
        className="sg-button sg-button-secondary"
      >
        <ExternalLink size={16} />
        Remote Desktop
      </button>

      {dialogOpen && (
        <ViewportDialog label="SentinelGrid Remote" onDismiss={() => setDialogOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="remote-title"
            aria-describedby="remote-description"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--sg-border)] bg-[var(--sg-surface)] shadow-[0_24px_64px_rgb(0_0_0_/_45%)] animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--sg-border)] px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--sg-accent)_30%,var(--sg-border))] bg-[color-mix(in_srgb,var(--sg-accent)_12%,var(--sg-inset))] text-[var(--sg-accent-text)]">
                  <Monitor size={19} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">SentinelGrid Remote</p>
                  <p className="mt-0.5 text-xs text-[var(--sg-muted)]">
                    {session ? "Remote session ready to reconnect" : "Secure remote access"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="-mr-2 -mt-2 rounded-lg p-2 text-[var(--sg-muted)] transition hover:bg-[var(--sg-raised)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sg-accent)]"
                aria-label="Close dialog"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="px-6 py-5">
              <h2 id="remote-title" className="text-base font-semibold text-white">
                Open this device with SentinelGrid Remote
              </h2>
              <p id="remote-description" className="mt-2 text-sm leading-6 text-zinc-400">
                {available
                  ? "Open the installed Remote viewer. If it is missing or damaged, download it again and run the file once to install or repair it."
                  : "This device is not currently available for Remote Desktop."}
              </p>
              {message && (
                <p role="status" className="mt-3 rounded-lg border border-[var(--sg-border)] bg-[var(--sg-inset)] px-3 py-2 text-xs leading-5 text-[var(--sg-muted)]">
                  {message}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-[var(--sg-border)] bg-[var(--sg-inset)] px-6 py-4 sm:flex-row sm:justify-end">
              <a
                className="sg-button sg-button-secondary"
                href={`/api/remote/rdp/download?deviceId=${encodeURIComponent(deviceId)}`}
              >
                <Download size={15} aria-hidden="true" />
                Download / Repair
              </a>
              <button
                type="button"
                className="sg-button sg-button-primary"
                disabled={busy || !available}
                onClick={() => void start()}
              >
                {session ? <RotateCcw size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                {busy ? "Opening..." : session ? "Reconnect" : "Open Remote"}
              </button>
            </div>
          </section>
        </ViewportDialog>
      )}
    </>
  );
}
