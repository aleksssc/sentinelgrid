"use server";

import { createClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/lib/audit/create-audit-log";

export async function deleteDeviceAction(
  deviceId: string
) {
  const supabase =
    await createClient();

  /* =========================
     USER
  ========================= */

  const {
    data: { user },
  } =
    await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: "Unauthorized.",
    };
  }

  /* =========================
     DEVICE
  ========================= */

  const {
    data: device,
    error: deviceError,
  } =
    await supabase
      .from("devices")
      .select(`
        id,
        hostname,
        display_name,
        client_id
      `)
      .eq("id", deviceId)
      .maybeSingle();

  if (
    deviceError ||
    !device
  ) {
    return {
      ok: false,
      error:
        "Device not found.",
    };
  }

  /* =========================
     CLIENT
  ========================= */

  const {
    data: client,
    error: clientError,
  } =
    await supabase
      .from("clients")
      .select(`
        id,
        organization_id
      `)
      .eq(
        "id",
        device.client_id
      )
      .maybeSingle();

  if (
    clientError ||
    !client
  ) {
    return {
      ok: false,
      error:
        "Client not found.",
    };
  }

  const organizationId =
    client.organization_id;

  /* =========================
     ORGANIZATION
  ========================= */

  const {
    data: organization,
  } =
    await supabase
      .from("organizations")
      .select(`
        id,
        owner_id
      `)
      .eq(
        "id",
        organizationId
      )
      .maybeSingle();

  if (!organization) {
    return {
      ok: false,
      error:
        "Organization not found.",
    };
  }

  /* =========================
     PERMISSIONS
  ========================= */

  const isOwner =
    organization.owner_id ===
    user.id;

  let isAdmin =
    false;

  if (!isOwner) {
    const {
      data: membership,
    } =
      await supabase
        .from(
          "organization_members"
        )
        .select("role")
        .eq(
          "organization_id",
          organizationId
        )
        .eq(
          "user_id",
          user.id
        )
        .maybeSingle();

    isAdmin =
      membership?.role ===
      "admin";
  }

  if (
    !isOwner &&
    !isAdmin
  ) {
    return {
      ok: false,
      error:
        "You do not have permission to delete this device.",
    };
  }

  /* =========================
     DEVICE NAME
  ========================= */

  const deviceName =
    device.display_name ||
    device.hostname;

  /* =========================
     DELETE
  ========================= */

  const {
    error: deleteError,
  } =
    await supabase
      .from("devices")
      .delete()
      .eq(
        "id",
        device.id
      );

  if (deleteError) {
    await createAuditLog({
      organizationId,

      action:
        "device.deleted",

      targetType:
        "device",

      targetId:
        device.id,

      targetName:
        deviceName,

      status:
        "failed",

      metadata: {
        clientId:
          device.client_id,

        reason:
          deleteError.message,
      },
    });

    console.error(
      "Could not delete device:",
      deleteError
    );

    return {
      ok: false,
      error:
        "Could not delete this device.",
    };
  }

  /* =========================
     AUDIT
  ========================= */

  await createAuditLog({
    organizationId,

    action:
      "device.deleted",

    targetType:
      "device",

    targetId:
      device.id,

    targetName:
      deviceName,

    status:
      "success",

    metadata: {
      clientId:
        device.client_id,
    },
  });

  return {
    ok: true,
  };
}