import { createClient } from "@/lib/supabase/server";
import OrganizationsView from "./organizations-view";

export default async function OrganizationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  /* =========================
     ORGANIZATIONS

     RLS devolve:
     - Organizations onde sou Owner
     - Organizations onde sou Member
  ========================= */

  const {
    data: organizations,
    error: organizationsError,
  } = await supabase
    .from("organizations")
    .select("*")
    .order("created_at", {
      ascending: false,
    });

  if (organizationsError) {
    console.error(
      "Organizations error:",
      organizationsError
    );
  }

  const organizationList =
    organizations ?? [];

  /* =========================
     CLIENTS
  ========================= */

  const organizationIds =
    organizationList.map(
      (organization) =>
        organization.id
    );

  let clients: {
    id: string;
    organization_id: string;
  }[] = [];

  if (organizationIds.length > 0) {
    const {
      data: clientsData,
      error: clientsError,
    } = await supabase
      .from("clients")
      .select(`
        id,
        organization_id
      `)
      .in(
        "organization_id",
        organizationIds
      );

    if (clientsError) {
      console.error(
        "Clients error:",
        clientsError
      );
    }

    clients =
      clientsData ?? [];
  }

  /* =========================
     DEVICES
  ========================= */

  const clientIds =
    clients.map(
      (client) =>
        client.id
    );

  let devices: {
    id: string;
    client_id: string;
  }[] = [];

  if (clientIds.length > 0) {
    const {
      data: devicesData,
      error: devicesError,
    } = await supabase
      .from("devices")
      .select(`
        id,
        client_id
      `)
      .in(
        "client_id",
        clientIds
      );

    if (devicesError) {
      console.error(
        "Devices error:",
        devicesError
      );
    }

    devices =
      devicesData ?? [];
  }

  /* =========================
     COUNTS
  ========================= */

  const organizationsWithCounts =
    organizationList.map(
      (organization) => {
        const organizationClients =
          clients.filter(
            (client) =>
              client.organization_id ===
              organization.id
          );

        const organizationClientIds =
          organizationClients.map(
            (client) =>
              client.id
          );

        const organizationDevices =
          devices.filter(
            (device) =>
              organizationClientIds.includes(
                device.client_id
              )
          );

        return {
          ...organization,

          clients_count:
            organizationClients.length,

          devices_count:
            organizationDevices.length,
        };
      }
    );

  return (
    <OrganizationsView
      organizations={
        organizationsWithCounts
      }
    />
  );
}