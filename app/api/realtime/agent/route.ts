import {
  experimental_upgradeWebSocket,
  type WebSocketData,
} from "@vercel/functions";

import { createHash } from "crypto";
import { connection } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ======================================================
// TYPES
// ======================================================

type AgentMessage = {
  type?: string;

  agent_token?: string;

  device_id?: string;

  agent_id?: string;
};

// ======================================================
// SUPABASE ADMIN
// ======================================================

function createAdminClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    throw new Error(
      "Missing Supabase server environment variables."
    );
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

// ======================================================
// WEBSOCKET ROUTE
// ======================================================

export async function GET() {
  await connection();

  return experimental_upgradeWebSocket(
    (ws) => {
      // ==================================================
      // CONNECTION STATE
      // ==================================================

      let authenticated =
        false;

      let authenticating =
        false;

      let deviceId:
        | string
        | null = null;

      let hostname:
        | string
        | null = null;

      // ==================================================
      // CONNECTED
      // ==================================================

      console.log(
        "[Realtime] New Agent connection."
      );

      // ==================================================
      // AUTH TIMEOUT
      // ==================================================

      const authenticationTimeout =
        setTimeout(
          () => {
            if (
              authenticated
            ) {
              return;
            }

            console.warn(
              "[Realtime] Authentication timeout."
            );

            ws.close(
              4401,
              "Authentication required"
            );
          },
          10_000
        );

      // ==================================================
      // MESSAGE
      // ==================================================

      ws.on(
        "message",
        async (
          data: WebSocketData
        ) => {
          try {
            // ============================================
            // PARSE MESSAGE
            // ============================================

            const raw =
              data.toString();

            const message =
              JSON.parse(
                raw
              ) as AgentMessage;

            // ============================================
            // AGENT NOT AUTHENTICATED
            // ============================================

            if (
              !authenticated
            ) {
              // Prevent simultaneous auth requests.

              if (
                authenticating
              ) {
                return;
              }

              // First message MUST be agent_auth.

              if (
                message.type !==
                "agent_auth"
              ) {
                console.warn(
                  "[Realtime] First message was not agent_auth."
                );

                ws.close(
                  4401,
                  "Authentication required"
                );

                return;
              }

              // ==========================================
              // TOKEN
              // ==========================================

              const agentToken =
                typeof message.agent_token ===
                "string"
                  ? message.agent_token.trim()
                  : "";

              if (
                !agentToken
              ) {
                console.warn(
                  "[Realtime] Missing Agent token."
                );

                ws.close(
                  4401,
                  "Missing agent token"
                );

                return;
              }

              authenticating =
                true;

              // ==========================================
              // HASH TOKEN
              //
              // Same concept used by the Agent API:
              // raw AgentToken never needs to be stored.
              // ==========================================

              const agentTokenHash =
                createHash(
                  "sha256"
                )
                  .update(
                    agentToken
                  )
                  .digest(
                    "hex"
                  );

              // ==========================================
              // SUPABASE
              // ==========================================

              const supabase =
                createAdminClient();

              // ==========================================
              // FIND DEVICE
              // ==========================================

              const {
                data:
                  device,

                error:
                  deviceError,
              } =
                await supabase
                  .from(
                    "devices"
                  )
                  .select(`
                    id,
                    hostname,
                    agent_id
                  `)
                  .eq(
                    "agent_token_hash",
                    agentTokenHash
                  )
                  .maybeSingle();

              // ==========================================
              // DATABASE ERROR
              // ==========================================

              if (
                deviceError
              ) {
                console.error(
                  "[Realtime] Device lookup error:",
                  deviceError
                );

                ws.close(
                  4500,
                  "Device validation failed"
                );

                return;
              }

              // ==========================================
              // INVALID TOKEN
              // ==========================================

              if (
                !device
              ) {
                console.warn(
                  "[Realtime] Invalid Agent token."
                );

                ws.close(
                  4401,
                  "Invalid Agent token"
                );

                return;
              }

              // ==========================================
              // DEVICE ID VALIDATION
              // ==========================================

              const claimedDeviceId =
                typeof message.device_id ===
                "string"
                  ? message.device_id.trim()
                  : "";

              if (
                claimedDeviceId &&
                claimedDeviceId !==
                  device.id
              ) {
                console.warn(
                  "[Realtime] Device ID mismatch."
                );

                ws.close(
                  4403,
                  "Device mismatch"
                );

                return;
              }

              // ==========================================
              // AGENT ID VALIDATION
              // ==========================================

              const claimedAgentId =
                typeof message.agent_id ===
                "string"
                  ? message.agent_id.trim()
                  : "";

              if (
                claimedAgentId &&
                device.agent_id &&
                claimedAgentId !==
                  device.agent_id
              ) {
                console.warn(
                  "[Realtime] Agent ID mismatch."
                );

                ws.close(
                  4403,
                  "Agent mismatch"
                );

                return;
              }

              // ==========================================
              // AUTHENTICATED
              // ==========================================

              authenticated =
                true;

              authenticating =
                false;

              deviceId =
                device.id;

              hostname =
                device.hostname;

              clearTimeout(
                authenticationTimeout
              );

              console.log(
                `[Realtime] Agent authenticated: ${
                  hostname ||
                  deviceId
                }`
              );

              // ==========================================
              // AUTH RESPONSE
              // ==========================================

              ws.send(
                JSON.stringify({
                  type:
                    "authenticated",

                  device_id:
                    deviceId,

                  hostname:
                    hostname,

                  server_time:
                    new Date()
                      .toISOString(),
                })
              );

              return;
            }

            // ============================================
            // AUTHENTICATED MESSAGES
            // ============================================

            switch (
              message.type
            ) {
              // ==========================================
              // KEEPALIVE
              // ==========================================

              case "ping": {
                ws.send(
                  JSON.stringify({
                    type:
                      "pong",

                    device_id:
                      deviceId,

                    server_time:
                      new Date()
                        .toISOString(),
                  })
                );

                break;
              }

              // ==========================================
              // UNKNOWN MESSAGE
              // ==========================================

              default: {
                console.log(
                  `[Realtime] Message from ${
                    hostname ||
                    deviceId
                  }:`,
                  message.type
                );

                break;
              }
            }
          } catch (error) {
            console.error(
              "[Realtime] Message processing error:",
              error
            );

            ws.send(
              JSON.stringify({
                type:
                  "error",

                message:
                  "Invalid realtime message",
              })
            );
          }
        }
      );

      // ==================================================
      // SOCKET CLOSED
      // ==================================================

      ws.on(
        "close",
        (
          code,
          reason
        ) => {
          clearTimeout(
            authenticationTimeout
          );

          console.log(
            `[Realtime] Agent disconnected: ${
              hostname ||
              deviceId ||
              "unauthenticated"
            } | code=${code} | reason=${reason.toString()}`
          );
        }
      );

      // ==================================================
      // SOCKET ERROR
      // ==================================================

      ws.on(
        "error",
        (
          error
        ) => {
          console.error(
            `[Realtime] Socket error for ${
              hostname ||
              deviceId ||
              "unauthenticated"
            }:`,
            error
          );
        }
      );
    }
  );
}