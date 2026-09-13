"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Save } from "lucide-react";

import { updateDeviceSettingsAction } from "@/app/dashboard/organizations/[id]/clients/[clientId]/device-settings-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Site = {
  id: string;
  name: string;
};

type DeviceSettings = {
  id: string;
  hostname: string;
  display_name: string | null;
  site_id: string | null;
};

type UpdatedDevice = {
  id: string;
  display_name: string | null;
  site_id: string | null;
  sites: Site | null;
};

type Props = {
  device: DeviceSettings;
  sites: Site[];
  canManage: boolean;
  onDeviceUpdated: (updated: UpdatedDevice) => void;
};

export default function DeviceSettingsPanel({
  device,
  sites,
  canManage,
  onDeviceUpdated,
}: Props) {
  const [displayName, setDisplayName] = useState(device.display_name ?? "");
  const [siteId, setSiteId] = useState(device.site_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDisplayName(device.display_name ?? "");
    setSiteId(device.site_id ?? "");
    setError("");
    setSaved(false);
  }, [device.id, device.display_name, device.site_id]);

  const hasChanges = displayName.trim() !== (device.display_name ?? "") || siteId !== (device.site_id ?? "");
  const selectedSiteName = sites.find((site) => site.id === siteId)?.name ?? "No site";

  async function saveSettings() {
    setSaving(true);
    setError("");
    setSaved(false);

    const result = await updateDeviceSettingsAction({
      deviceId: device.id,
      displayName,
      siteId: siteId || null,
    });

    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onDeviceUpdated(result.device);
    setSaved(true);
  }

  function updateSite(value: string) {
    setSiteId(value);
    setSaved(false);
  }

  return (
    <section className="mt-6 max-w-4xl" aria-labelledby="device-settings-heading">
      <div className="pb-5">
        <p className="sg-eyebrow">Configuration</p>
        <h2 id="device-settings-heading" className="text-base font-semibold tracking-tight text-zinc-100">Device settings</h2>
        <p className="sg-section-description">Manage how this endpoint is identified and organized in SentinelGrid.</p>
      </div>

      <div className="border-y border-surface-edge">
        <label className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)] sm:items-center sm:gap-8">
          <span>
            <span className="block text-sm font-medium text-zinc-200">Display name</span>
            <span className="mt-1 block text-xs leading-5 text-surface-muted">A custom name shown in SentinelGrid. Leave it blank to use <strong className="font-medium text-zinc-300">{device.hostname}</strong>.</span>
          </span>
          <input
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setSaved(false);
            }}
            disabled={!canManage || saving}
            maxLength={120}
            placeholder={device.hostname}
            className="sg-control w-full px-3"
          />
        </label>

        <div className="grid gap-3 border-t border-surface-edge py-5 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)] sm:items-center sm:gap-8">
          <div>
            <span className="block text-sm font-medium text-zinc-200">Site</span>
            <span className="mt-1 block text-xs leading-5 text-surface-muted">Assign this endpoint to a site for clearer organization.</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!canManage || saving}
                aria-label="Site"
                className="sg-control flex w-full items-center justify-between gap-3 px-3 text-left"
              >
                <span className="min-w-0 truncate">{selectedSiteName}</span>
                <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-surface-muted" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[var(--radix-dropdown-menu-trigger-width)] p-1">
              <DropdownMenuRadioGroup value={siteId} onValueChange={updateSite}>
                <DropdownMenuRadioItem hideIndicator value="">No site</DropdownMenuRadioItem>
                {sites.map((site) => (
                  <DropdownMenuRadioItem hideIndicator key={site.id} value={site.id}>{site.name}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 pt-4" aria-live="polite">
        <div>
          {!canManage && <p className="sg-meta">You do not have permission to update this device.</p>}
          {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
          {saved && <p role="status" className="flex items-center gap-1.5 text-xs text-emerald-400"><Check size={14} aria-hidden="true" /> Changes saved</p>}
        </div>
        {canManage && (
          <button type="button" onClick={saveSettings} disabled={!hasChanges || saving} className="sg-button sg-button-primary">
            <Save size={15} aria-hidden="true" />
            {saving ? "Saving..." : "Save changes"}
          </button>
        )}
      </div>
    </section>
  );
}
