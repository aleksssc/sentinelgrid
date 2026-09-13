"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Database, Download, Lock, Network, Power, RotateCcw, ShieldCheck } from "lucide-react";
import { DEVICE_ACTIONS, type ActionAvailability } from "@/lib/remote/action-definitions";

const icons = { inventory: Database, network: Network, policy: ShieldCheck, restart: RotateCcw, update: Download, lock: Lock, power: Power };

export default function DeviceActionsMenu({ device, busy, online, open, onOpenChange, onAction }: {
  device: { id: string; hostname: string; display_name: string | null };
  busy: boolean; online: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: string, options?: { confirm?: string }) => void;
}) {
  const [availability, setAvailability] = useState<ActionAvailability | null>(null);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const lastCheck = useRef<{ deviceId: string; busy: boolean; online: boolean; at: number } | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: Event) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) onOpenChange(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    if (lastCheck.current && lastCheck.current.deviceId !== device.id) {
      setAvailability(null);
      setError("");
    }
    async function refresh() {
      if (loading || document.visibilityState === "hidden") return;
      const previous = lastCheck.current;
      const checkedAt = Date.now();
      if (previous?.deviceId === device.id && previous.busy === busy && previous.online === online && checkedAt - previous.at < 5000) return;
      loading = true;
      try {
        const response = await fetch(`/api/devices/${device.id}/commands`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 403 ? "You do not have permission for device actions" : "Could not check action availability");
        const body = await response.json() as { actions: ActionAvailability };
        if (controller.signal.aborted) return;
        lastCheck.current = { deviceId: device.id, busy, online, at: checkedAt };
        setAvailability(body.actions);
        setError("");
      } catch (cause) {
        if (!controller.signal.aborted) { setAvailability(null); setError(cause instanceof Error ? cause.message : "Could not check action availability"); }
      } finally { loading = false; }
    }
    // Keep the initial prefetch, but only repeat while the menu can actually be used.
    void refresh();
    if (!open) return () => controller.abort();
    const onVisible = () => { void refresh(); };
    const timer = setInterval(onVisible, 5000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [device.id, busy, online, open]);
  const name = device.display_name || device.hostname;
  return (
    <div ref={containerRef} className="relative">
      <button ref={triggerRef} type="button" aria-expanded={open} aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className="sg-button sg-button-secondary">
        Actions
        <ChevronDown size={15} aria-hidden="true" className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Device actions" className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] origin-top-right overflow-hidden rounded-xl border border-surface-edge bg-surface p-1.5 shadow-2xl animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          {["Maintenance", "Agent", "Power"].map((group, index) => (
            <div key={group} className={index ? "mt-1 border-t border-zinc-800/70 pt-1" : ""}>
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-muted">{group}</p>
              {DEVICE_ACTIONS.filter((action) => action.group === group).map((action) => {
                const Icon = icons[action.icon];
                // Availability is advisory; the command POST always revalidates authorization and safety.
                const reason = !online ? "Device is offline" : busy ? "Another device command is already running" : error || availability?.[action.type];
                const confirmation = action.type === "reboot" ? `Restart ${name}? Open work may be lost. Windows will restart in 30 seconds.` :
                  action.type === "shutdown" ? `Shut down ${name}? Open work may be lost. Windows will shut down in 30 seconds; physical access may be needed to turn it on again.` :
                  action.type === "restart_agent" ? `Restart SentinelGrid Agent on ${name}? Monitoring will briefly disconnect.` :
                  action.type === "update_agent" ? `Check for and install the newest permitted Agent release on ${name}?` : undefined;
                return (
                  <div key={action.type} title={reason || undefined} tabIndex={reason ? 0 : undefined} aria-label={reason ? `${action.label}: ${reason}` : undefined}>
                    <button type="button" disabled={Boolean(reason)} onClick={() => onAction(action.type, { confirm: confirmation })}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-surface-focus disabled:pointer-events-none disabled:opacity-35 ${action.type === "shutdown" ? "text-red-300" : "text-zinc-300"}`}>
                      <Icon size={15} className="shrink-0 opacity-70" aria-hidden="true" />{action.label}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          {error && <p role="alert" className="px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}
