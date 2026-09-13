"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

type Session = { sessionId: string; expiresAt: string; status: string };

export default function DeviceRDP({ deviceId, available }: { deviceId: string; available: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const sessionId = session?.sessionId;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/devices/${deviceId}/rdp`, { cache: "no-store", signal: controller.signal });
        if (response.status === 204) return;
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Session status unavailable");
        setSession(body);
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Session status unavailable");
      }
    })();
    return () => controller.abort();
  }, [deviceId]);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/devices/${deviceId}/rdp/${sessionId}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Session status unavailable");
        const expired = Date.parse(body.expiresAt) <= Date.now();
        if (["closed", "failed"].includes(body.status) || expired) {
          setSession(null);
          setMessage(expired ? "Remote Desktop session expired." : `Remote Desktop tunnel ${body.status}.`);
        } else { setSession(body); }
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Session status unavailable");
      }
    }, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [deviceId, sessionId]);

  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/devices/${deviceId}/rdp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Remote Desktop request failed");
      setSession({ sessionId: body.sessionId, expiresAt: body.expiresAt, status: "requested" });
      const blob = new Blob([JSON.stringify(body.connection)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SentinelGrid-${body.sessionId}.sgrdp`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Within 60 seconds, run SentinelGridRDP.exe -connection <download.sgrdp> on your Windows PC. Enter credentials only in Windows Remote Desktop; verify the endpoint certificate.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Remote Desktop request failed"); }
    finally { setBusy(false); }
  }

  async function close() {
    if (!session) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/devices/${deviceId}/rdp/${session.sessionId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Remote Desktop close failed");
      }
      setSession(null);
      setMessage("Session closed. The relay disconnects within 15 seconds.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Remote Desktop close failed"); }
    finally { setBusy(false); }
  }

  return <div className="max-w-xl">
    {!session && available && <input aria-label="Remote Desktop session reason" maxLength={240} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Session reason (required)" className="sg-control mb-2 block w-full px-3 py-2" />}
    <button type="button" disabled={busy || (!session && (!available || reason.trim().length < 3))} onClick={() => void (session ? close() : start())}
      title={available ? "Outbound tunnel to Windows Remote Desktop" : "Requires an online RDP/NLA-capable Agent and configured relay"}
      className="sg-button sg-button-secondary">
      <ExternalLink size={16} />{busy ? "Please wait..." : session ? "Close Remote Desktop" : "Remote Desktop"}
    </button>
    {session && <p className="mt-2 text-xs text-zinc-400">Tunnel: {session.status}. Windows sign-in is separate.</p>}
    {message && <p role="status" className="mt-2 text-xs text-zinc-400">{message}</p>}
  </div>;
}
