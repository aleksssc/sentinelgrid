"use server";

import { createAuditLog } from "@/lib/audit/create-audit-log";
import {
  accessHasPermission,
  getOrganizationAccessForUser,
} from "@/lib/organization-access";
import { createClient } from "@/lib/supabase/server";

type UpdateDeviceSettingsInput = {
  deviceId: string;
  displayName: string;
  siteId: string | null;
};

export async function updateDeviceSettingsAction({
  deviceId,
  displayName,
  siteId,
}: UpdateDeviceSettingsInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, error: "Unauthorized." };
  }

  const normalizedDisplayName = displayName.trim();
  if (normalizedDisplayName.length > 120) {
    return { ok: false as const, error: "Device name must be 120 characters or fewer." };
  }

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id, hostname, display_name, site_id, client_id")
    .eq("id", deviceId)
    .maybeSingle();

  if (deviceError) {
    console.error("Device settings lookup failed:", deviceError);
    return { ok: false as const, error: "Could not update device settings." };
  }

  if (!device) {
    return { ok: false as const, error: "Device not found." };
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("organization_id")
    .eq("id", device.client_id)
    .maybeSingle();

  if (clientError) {
    console.error("Device settings client lookup failed:", clientError);
    return { ok: false as const, error: "Could not update device settings." };
  }

  if (!client) {
    return { ok: false as const, error: "Client not found." };
  }

  const access = await getOrganizationAccessForUser(client.organization_id, user.id);
  if (!access || !accessHasPermission(access, "devices.manage")) {
    return { ok: false as const, error: "You do not have permission to update this device." };
  }

  let site: { id: string; name: string } | null = null;
  if (siteId) {
    const { data, error } = await supabase
      .from("sites")
      .select("id, name")
      .eq("id", siteId)
      .eq("client_id", device.client_id)
      .maybeSingle();

    if (error) {
      console.error("Device settings site lookup failed:", error);
      return { ok: false as const, error: "Could not update device settings." };
    }

    if (!data) {
      return { ok: false as const, error: "Selected site is not available for this client." };
    }

    site = data;
  }

  const nextDisplayName = normalizedDisplayName || null;
  const { error: updateError } = await supabase
    .from("devices")
    .update({ display_name: nextDisplayName, site_id: site?.id ?? null })
    .eq("id", device.id)
    .eq("client_id", device.client_id);

  if (updateError) {
    console.error("Device settings update failed:", updateError);
    return { ok: false as const, error: "Could not update device settings." };
  }

  await createAuditLog({
    organizationId: client.organization_id,
    action: "device.settings_updated",
    targetType: "device",
    targetId: device.id,
    targetName: nextDisplayName ?? device.hostname,
    metadata: {
      previousDisplayName: device.display_name,
      displayName: nextDisplayName,
      previousSiteId: device.site_id,
      siteId: site?.id ?? null,
    },
  });

  return {
    ok: true as const,
    device: {
      id: device.id,
      display_name: nextDisplayName,
      site_id: site?.id ?? null,
      sites: site,
    },
  };
}
