import { NextResponse } from "next/server";

import { activityCorrelation, enrichActivityUpdateCommands, type DeviceActivity, type DeviceActivityCommand } from "@/lib/activity/device-activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const commandColumns =
  "id, device_id, command_type, status, created_at, requested_by, dispatched_at, acknowledged_at, started_at, completed_at, result, payload, error_code, error_message, update_transaction_id";

function isUuid(value: string | null | undefined): value is string {
  return Boolean(
    value &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
  );
}

function organizationIdFromDevice(device: {
  clients?: { organization_id?: string | null } | Array<{ organization_id?: string | null }> | null;
}) {
  const client = Array.isArray(device.clients) ? device.clients[0] : device.clients;
  return client?.organization_id ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id, clients!inner(organization_id)")
    .eq("id", deviceId)
    .maybeSingle();

  if (deviceError || !device) {
    return NextResponse.json({ error: "DEVICE_NOT_FOUND" }, { status: 404 });
  }

  const organizationId = organizationIdFromDevice(device);
  if (!organizationId) {
    return NextResponse.json({ error: "ORGANIZATION_NOT_FOUND" }, { status: 404 });
  }

  const activityErrors: string[] = [];

  const [auditResult, commandResult] = await Promise.all([
    supabase
      .from("audit_logs")
      .select("id, action, status, target_id, created_at, metadata, actor_email, user_id")
      .eq("organization_id", organizationId)
      .eq("target_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("device_commands")
      .select(commandColumns)
      .eq("organization_id", organizationId)
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (auditResult.error) {
    console.error("Device activity audit query failed:", auditResult.error);
    activityErrors.push("Audit events could not be loaded.");
  }

  if (commandResult.error) {
    console.error("Device activity command query failed:", commandResult.error);
    activityErrors.push("Command details could not be loaded.");
  }

  const activity = (auditResult.data ?? []) as DeviceActivity[];
  let commands = (commandResult.data ?? []) as DeviceActivityCommand[];

  if (!commandResult.error) {
    const loadedIds = new Set(commands.map((command) => command.id));
    const loadedTransactions = new Set(
      commands.map((command) => command.update_transaction_id)
    );
    const correlations = activity.map((event) => activityCorrelation(event.metadata));

    const missingIds = [
      ...new Set(
        correlations
          .map(({ commandId }) => commandId)
          .filter(isUuid)
          .filter((id) => !loadedIds.has(id))
      ),
    ];

    const missingTransactions = [
      ...new Set(
        correlations
          .map(({ transactionId }) => transactionId)
          .filter(isUuid)
          .filter((id) => !loadedTransactions.has(id))
      ),
    ];

    const correlationFilters = [
      missingIds.length ? `id.in.(${missingIds.join(",")})` : null,
      missingTransactions.length
        ? `update_transaction_id.in.(${missingTransactions.join(",")})`
        : null,
    ].filter((value): value is string => value !== null);

    if (correlationFilters.length) {
      const { data: correlated, error } = await supabase
        .from("device_commands")
        .select(commandColumns)
        .eq("organization_id", organizationId)
        .eq("device_id", deviceId)
        .or(correlationFilters.join(","));

      if (error) {
        console.error("Device activity correlation query failed:", error);
        activityErrors.push("Some related command details could not be loaded.");
      } else {
        commands = [
          ...commands,
          ...(correlated ?? []).filter((command) => !loadedIds.has(command.id)),
        ] as DeviceActivityCommand[];
      }
    }

    const transactionIds = [
      ...new Set(
        commands
          .filter((command) => command.command_type === "update_agent")
          .map((command) => command.update_transaction_id)
          .filter(isUuid)
      ),
    ];

    if (transactionIds.length) {
      try {
        const { data: transactions, error } = await createAdminClient()
          .from("agent_update_transactions")
          .select("id, device_id, target_version, devices!inner(clients!inner(organization_id))")
          .eq("devices.clients.organization_id", organizationId)
          .eq("device_id", deviceId)
          .in("id", transactionIds)
          .abortSignal(AbortSignal.timeout(3_000));

        if (error) throw error;
        commands = enrichActivityUpdateCommands(commands, transactions ?? []);
      } catch (error) {
        console.error(
          "Device activity update transaction enrichment failed:",
          error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
        );
      }
    }
  }

  return NextResponse.json(
    {
      activity,
      activityCommands: commands,
      activityError: activityErrors.length ? activityErrors.join(" ") : undefined,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  );
}
