"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Database, Download, Lock, Network, Power, RotateCcw, ShieldCheck } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { RemoteFeatureGate } from "@/components/dashboard/devices/remote-feature-gate";
import { DEVICE_ACTIONS, type ActionAvailability } from "@/lib/remote/action-definitions";
import type { RemoteFeatureAccess } from "@/lib/remote-feature-access";

const icons = { inventory: Database, network: Network, policy: ShieldCheck, restart: RotateCcw, update: Download, lock: Lock, power: Power };

export default function DeviceActionsMenu({ device, busy, online, access, open, onOpenChange, onAction }: {
  device: { id: string; hostname: string; display_name: string | null };
  busy: boolean; online: boolean;
  access: RemoteFeatureAccess;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: string, options?: { confirm?: string }) => void;
}) {
  const [availability, setAvailability] = useState<ActionAvailability | null>(null);
  const [error, setError] = useState("");
  const lastCheck = useRef<{ deviceId: string; busy: boolean; online: boolean; at: number } | null>(null);

  useEffect(() => {
    if (!access.canUse) return;
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
  }, [device.id, busy, online, open, access.canUse]);

  const name = device.display_name || device.hostname;
  if (!access.canUse) {
    return <RemoteFeatureGate access={access} feature="Device Actions">
      <button type="button" className="sg-button sg-button-secondary">Actions</button>
    </RemoteFeatureGate>;
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="sg-button sg-button-secondary">
          Actions
          <ChevronDown size={15} aria-hidden="true" className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} collisionPadding={12} sticky="always"
        aria-label="Device actions" className="sg-device-actions-menu w-64 p-1.5 shadow-2xl duration-200 motion-reduce:animate-none">
        {["Maintenance", "Agent", "Power"].map((group, index) => (
          <DropdownMenuGroup key={group} className={index ? "mt-1 border-t border-surface-edge pt-1" : ""}>
            <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-muted">{group}</DropdownMenuLabel>
            {DEVICE_ACTIONS.filter((action) => action.group === group).map((action) => {
              const Icon = icons[action.icon];
              const reason = !online ? "Device is offline" : busy ? "Another device command is already running" : error || availability?.[action.type];
              const confirmation = action.type === "reboot" ? `Restart ${name}? Open work may be lost. Windows will restart in 30 seconds.` :
                action.type === "shutdown" ? `Shut down ${name}? Open work may be lost. Windows will shut down in 30 seconds; physical access may be needed to turn it on again.` :
                action.type === "restart_agent" ? `Restart SentinelGrid Agent on ${name}? Monitoring will briefly disconnect.` :
                action.type === "update_agent" ? `Check for and install the newest permitted Agent release on ${name}?` : undefined;
              return (
                <DropdownMenuItem key={action.type} aria-disabled={Boolean(reason)} title={reason || undefined}
                  aria-label={reason ? `${action.label}: ${reason}` : undefined}
                  onSelect={(event) => {
                    if (reason) { event.preventDefault(); return; }
                    onAction(action.type, { confirm: confirmation });
                  }}
                  className={`gap-3 rounded-lg px-3 py-2 text-xs aria-disabled:opacity-35 ${action.type === "shutdown" ? "text-red-300" : "text-zinc-300"}`}>
                  <Icon size={15} className="shrink-0 opacity-70" aria-hidden="true" />{action.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
        {error && <p role="alert" className="px-3 py-2 text-xs text-red-300">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
