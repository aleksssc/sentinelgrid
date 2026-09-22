import type { WebSocket, RawData as WebSocketData } from "ws";
import type { LocalPresence } from "./local-presence";

import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

import {
  accessHasFeature,
  accessHasPermission,
  resolveOrganizationAccessForUser,
} from "../organization-access-core";
import { getRedis } from "./redis";
import {
  agentCommandChannel,
  agentPresenceKey,
  browserResultChannel,
  publishRealtimeMessage,
  subscribeRealtimeChannel,
  type RealtimeSubscription,
} from "./pubsub";

type BrowserMessage = {
  type?: string;
  access_token?: string;
  device_id?: string;
  shell?: string;
  command?: string;
};

type CommandResult = {
  type: "command_result";
  command_id: string;
  session_id: string;
  device_id: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  completed_at?: string;
};

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing.");
  if (!serviceRole) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function userCanControlDevice(userId: string, deviceId: string) {
  const supabase = createAdminClient();
  const { data: device, error: deviceError } = await supabase
    .from("devices").select("id, client_id").eq("id", deviceId).maybeSingle();
  if (deviceError || !device) return false;

  const { data: client, error: clientError } = await supabase
    .from("clients").select("id, organization_id").eq("id", device.client_id).maybeSingle();
  if (clientError || !client) return false;

  const access = await resolveOrganizationAccessForUser(
    supabase,
    client.organization_id,
    userId,
  );

  return Boolean(
    access &&
    accessHasPermission(access, "devices.terminal") &&
    accessHasFeature(access, "terminal"),
  );
}

export function attachBrowserSocket(ws: WebSocket, localPresence?: LocalPresence) {
  let authenticated = false;
  let authenticating = false;
  let deviceId = "";
  let userId = "";
  let sessionId = "";
  let subscription: RealtimeSubscription | null = null;

  const authTimer = setTimeout(() => {
    if (authenticated) return;
    try { ws.close(4401, "Authentication timeout"); } catch { /* Ignore. */ }
  }, 10_000);

  let closed = false;
  function cleanup() {
    closed = true;
    authenticated = false;
    clearTimeout(authTimer);
    if (subscription) {
      subscription.abort();
      subscription = null;
    }
  }

  ws.on("message", async (data: WebSocketData) => {
    try {
      if (closed) return;
      const message = JSON.parse(data.toString()) as BrowserMessage;

      if (!authenticated) {
        if (authenticating) return;
        if (message.type !== "browser_auth") {
          ws.close(4401, "Authentication required");
          return;
        }
        const accessToken = typeof message.access_token === "string" ? message.access_token.trim() : "";
        const requestedDeviceId = typeof message.device_id === "string" ? message.device_id.trim() : "";
        if (!accessToken || !requestedDeviceId) {
          ws.close(4401, "Missing credentials");
          return;
        }
        authenticating = true;
        const supabase = createAdminClient();
        const { data: authData, error } = await supabase.auth.getUser(accessToken);
        if (error || !authData.user) {
          ws.close(4401, "Invalid session");
          return;
        }
        const allowed = await userCanControlDevice(authData.user.id, requestedDeviceId);
        if (!allowed) {
          ws.close(4403, "Not allowed");
          return;
        }

        userId = authData.user.id;
        deviceId = requestedDeviceId;
        sessionId = randomUUID();
        if (closed || ws.readyState !== ws.OPEN) return;
        authenticated = true;
        authenticating = false;
        clearTimeout(authTimer);

        subscription = subscribeRealtimeChannel<CommandResult>(
          browserResultChannel(sessionId),
          async (result) => {
            if (result.type !== "command_result" || result.device_id !== deviceId) return;
            try { ws.send(JSON.stringify(result)); }
            catch (error) { console.error("[Realtime Browser] Could not send result:", error); }
          },
        );
        void subscription.done.catch((error) => {
          console.error(`[Realtime Browser] Redis subscription failed: ${sessionId}`, error);
          try { ws.close(1011, "Realtime broker unavailable"); } catch { /* Ignore. */ }
        });

        const presence = localPresence?.has(deviceId)
          ? true
          : Boolean(await getRedis().get<string>(agentPresenceKey(deviceId)));
        ws.send(JSON.stringify({
          type: "browser_authenticated",
          device_id: deviceId,
          session_id: sessionId,
          online: Boolean(presence),
          server_time: new Date().toISOString(),
        }));
        console.log(`[Realtime Browser] Connected: user=${userId} device=${deviceId}`);
        return;
      }

      if (message.type === "ping") {
        const presence = localPresence?.has(deviceId)
          ? true
          : Boolean(await getRedis().get<string>(agentPresenceKey(deviceId)));
        ws.send(JSON.stringify({ type: "pong", online: Boolean(presence), server_time: new Date().toISOString() }));
        return;
      }

      if (message.type === "command") {
        const shell = typeof message.shell === "string" ? message.shell.trim().toLowerCase() : "";
        const command = typeof message.command === "string" ? message.command.trim() : "";
        if (shell !== "cmd" && shell !== "powershell") {
          ws.send(JSON.stringify({ type: "error", code: "INVALID_SHELL", message: "Shell must be cmd or powershell." }));
          return;
        }
        if (!command) return;
        if (command.length > 16_384) {
          ws.send(JSON.stringify({ type: "error", code: "COMMAND_TOO_LARGE", message: "Command is too large." }));
          return;
        }
        const presence = localPresence?.has(deviceId)
          ? true
          : Boolean(await getRedis().get<string>(agentPresenceKey(deviceId)));
        if (!presence) {
          ws.send(JSON.stringify({ type: "error", code: "DEVICE_OFFLINE", message: "Device is offline." }));
          return;
        }
        const commandId = randomUUID();
        await publishRealtimeMessage(agentCommandChannel(deviceId), {
          type: "command",
          command_id: commandId,
          session_id: sessionId,
          shell,
          command,
          requested_by: userId,
          created_at: new Date().toISOString(),
        });
        ws.send(JSON.stringify({ type: "command_accepted", command_id: commandId, shell, command }));
        console.log(`[Realtime Browser] Command published: user=${userId} device=${deviceId} command=${commandId}`);
      }
    } catch (error) {
      console.error("[Realtime Browser] Message error:", error);
    }
  });

  ws.on("close", (code, reason) => {
    cleanup();
    console.log(`[Realtime Browser] Disconnected: session=${sessionId || "unauthenticated"} | ${code} | ${reason.toString()}`);
  });
  ws.on("error", (error) => {
    console.error(`[Realtime Browser] Socket error: ${sessionId || "unauthenticated"}`, error);
  });
}
