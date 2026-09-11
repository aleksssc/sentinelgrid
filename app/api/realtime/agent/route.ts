import {
  experimental_upgradeWebSocket,
  type WebSocketData,
} from "@vercel/functions";

import { connection } from "next/server";

import {
  createHash,
  randomUUID,
} from "crypto";

import { createClient } from "@supabase/supabase-js";

import { getRedis } from "@/lib/realtime/redis";

import {
  agentCommandChannel,
  agentPresenceKey,
  browserResultChannel,
  publishRealtimeMessage,
  subscribeRealtimeChannel,
  type RealtimeSubscription,
} from "@/lib/realtime/pubsub";

/* =========================================
   TYPES
========================================= */

type AgentMessage = {
  type?: string;

  agent_token?: string;

  device_id?: string;

  agent_id?: string;

  command_id?: string;

  session_id?: string;

  stdout?: string;

  stderr?: string;

  exit_code?: number;

  command_type?: string;

  payload?: Record<string, unknown>;

  idempotency_key?: string;

  expires_at?: string;

  status?: "acknowledged" | "running" | "succeeded" | "failed";

  result?: Record<string, unknown>;

  error_code?: string;

  error_message?: string;
};

type RemoteCommand = {
  type: "command";

  command_id: string;

  session_id: string;

  shell:
    | "cmd"
    | "powershell";

  command: string;
};

type TypedRemoteCommand = {
  type: "typed_command";
  command_id: string;
  command_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
  expires_at: string;
};

/* =========================================
   SUPABASE ADMIN
========================================= */

function createAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing.",
    );
  }

  if (!serviceRole) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing.",
    );
  }

  return createClient(
    url,
    serviceRole,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

/* =========================================
   ROUTE
========================================= */

export async function GET() {
  await connection();

  return experimental_upgradeWebSocket(
    (ws) => {
      let authenticated =
        false;

      let authenticating =
        false;

      let deviceId =
        "";

      let hostname =
        "";

      const connectionId =
        randomUUID();

      let subscription:
        RealtimeSubscription
        | null = null;

      let presenceTimer:
        ReturnType<typeof setInterval>
        | null = null;

      /* =====================================
         AUTH TIMEOUT
      ===================================== */

      const authTimer =
        setTimeout(
          () => {
            if (
              authenticated
            ) {
              return;
            }

            try {
              ws.close(
                4401,
                "Authentication timeout",
              );
            } catch {
              // Ignore.
            }
          },
          10_000,
        );

      /* =====================================
         PRESENCE
      ===================================== */

      async function refreshPresence() {
        if (
          !authenticated ||
          !deviceId
        ) {
          return;
        }

        try {
          const redis =
            getRedis();

          await redis.set(
            agentPresenceKey(
              deviceId,
            ),
            connectionId,
            {
              ex: 45,
            },
          );
        } catch (error) {
          console.error(
            "[Realtime Agent] Presence update failed:",
            error,
          );
        }
      }

      /* =====================================
         CLEANUP
      ===================================== */

      function cleanup() {
        clearTimeout(
          authTimer,
        );

        if (
          presenceTimer
        ) {
          clearInterval(
            presenceTimer,
          );

          presenceTimer =
            null;
        }

        if (
          subscription
        ) {
          subscription.abort();

          subscription =
            null;
        }
      }

      /* =====================================
         MESSAGE
      ===================================== */

      ws.on(
        "message",
        async (
          data: WebSocketData,
        ) => {
          try {
            const raw =
              data.toString();

            const message =
              JSON.parse(
                raw,
              ) as AgentMessage;

            /* =================================
               AUTHENTICATION
            ================================= */

            if (
              !authenticated
            ) {
              if (
                authenticating
              ) {
                return;
              }

              if (
                message.type !==
                "agent_auth"
              ) {
                ws.close(
                  4401,
                  "Authentication required",
                );

                return;
              }

              const agentToken =
                typeof message.agent_token ===
                "string"
                  ? message.agent_token.trim()
                  : "";

              if (
                !agentToken
              ) {
                ws.close(
                  4401,
                  "Missing Agent token",
                );

                return;
              }

              authenticating =
                true;

              const tokenHash =
                createHash(
                  "sha256",
                )
                  .update(
                    agentToken,
                  )
                  .digest(
                    "hex",
                  );

              const supabase =
                createAdminClient();

              const {
                data: device,
                error,
              } =
                await supabase
                  .from(
                    "devices",
                  )
                  .select(
                    "id, hostname, agent_id",
                  )
                  .eq(
                    "agent_token_hash",
                    tokenHash,
                  )
                  .maybeSingle();

              if (
                error ||
                !device
              ) {
                console.error(
                  "[Realtime Agent] Authentication failed:",
                  error,
                );

                ws.close(
                  4401,
                  "Invalid Agent token",
                );

                return;
              }

              /* DEVICE CHECK */

              if (
                message.device_id &&
                message.device_id !==
                  device.id
              ) {
                ws.close(
                  4403,
                  "Device mismatch",
                );

                return;
              }

              /* AGENT CHECK */

              if (
                message.agent_id &&
                device.agent_id &&
                message.agent_id !==
                  device.agent_id
              ) {
                ws.close(
                  4403,
                  "Agent mismatch",
                );

                return;
              }

              deviceId =
                device.id;

              hostname =
                device.hostname ??
                device.id;

              authenticated =
                true;

              authenticating =
                false;

              clearTimeout(
                authTimer,
              );

              /* =============================
                 PRESENCE
              ============================= */

              await refreshPresence();

              presenceTimer =
                setInterval(
                  () => {
                    void refreshPresence();
                  },
                  15_000,
                );

              /* =============================
                 SUBSCRIBE COMMAND CHANNEL
              ============================= */

              subscription =
                subscribeRealtimeChannel<RemoteCommand | TypedRemoteCommand>(
                  agentCommandChannel(
                    deviceId,
                  ),
                  async (
                    command,
                  ) => {
                    if (command.type !== "command" && command.type !== "typed_command") {
                      return;
                    }

                    try {
                      ws.send(
                        JSON.stringify(
                          command,
                        ),
                      );

                      console.log(
                        `[Realtime Agent] Command forwarded to ${hostname}: ${command.command_id}`,
                      );
                    } catch (
                      error
                    ) {
                      console.error(
                        "[Realtime Agent] Could not send command:",
                        error,
                      );
                    }
                  },
                );

              void subscription.done.catch(
                (
                  error,
                ) => {
                  console.error(
                    `[Realtime Agent] Redis subscription failed for ${deviceId}:`,
                    error,
                  );

                  try {
                    ws.close(
                      1011,
                      "Realtime broker unavailable",
                    );
                  } catch {
                    // Ignore.
                  }
                },
              );

              /* =============================
                 AUTH RESPONSE
              ============================= */

              ws.send(
                JSON.stringify({
                  type:
                    "authenticated",

                  device_id:
                    deviceId,

                  hostname,

                  server_time:
                    new Date()
                      .toISOString(),
                }),
              );

              console.log(
                `[Realtime Agent] Connected: ${hostname} | ${deviceId}`,
              );

              return;
            }

            /* =================================
               KEEPALIVE
            ================================= */

            if (
              message.type ===
              "ping"
            ) {
              await refreshPresence();

              ws.send(
                JSON.stringify({
                  type:
                    "pong",

                  server_time:
                    new Date()
                      .toISOString(),
                }),
              );

              return;
            }

            /* =================================
               COMMAND RESULT
            ================================= */

            if (
              message.type ===
              "command_result"
            ) {
              const commandId =
                typeof message.command_id ===
                "string"
                  ? message.command_id.trim()
                  : "";

              const sessionId =
                typeof message.session_id ===
                "string"
                  ? message.session_id.trim()
                  : "";

              if (
                !commandId ||
                !sessionId
              ) {
                console.warn(
                  "[Realtime Agent] Invalid command result.",
                );

                return;
              }

              await publishRealtimeMessage(
                browserResultChannel(
                  sessionId,
                ),
                {
                  type:
                    "command_result",

                  command_id:
                    commandId,

                  session_id:
                    sessionId,

                  device_id:
                    deviceId,

                  stdout:
                    message.stdout ??
                    "",

                  stderr:
                    message.stderr ??
                    "",

                  exit_code:
                    typeof message.exit_code ===
                    "number"
                      ? message.exit_code
                      : 1,

                  completed_at:
                    new Date()
                      .toISOString(),
                },
              );

              console.log(
                `[Realtime Agent] Result published: ${hostname} | ${commandId}`,
              );

              return;
            }

            if (
              message.type === "typed_command_ack" ||
              message.type === "typed_command_running"
            ) {
              const commandId =
                typeof message.command_id === "string"
                  ? message.command_id.trim()
                  : "";

              if (!commandId) return;

              const supabase = createAdminClient();
              const now = new Date().toISOString();
              const isAcknowledged = message.type === "typed_command_ack";

              await supabase
                .from("device_commands")
                .update({
                  status: isAcknowledged ? "acknowledged" : "running",
                  acknowledged_at: isAcknowledged ? now : undefined,
                  started_at: isAcknowledged ? undefined : now,
                })
                .eq("id", commandId)
                .eq("device_id", deviceId)
                .in("status", ["dispatched", "acknowledged"]);

              return;
            }

            if (message.type === "typed_command_result") {
              const commandId =
                typeof message.command_id === "string"
                  ? message.command_id.trim()
                  : "";
              const status = message.status;

              if (
                !commandId ||
                (status !== "succeeded" && status !== "failed")
              ) {
                return;
              }

              const supabase = createAdminClient();
              const completedAt = new Date().toISOString();
              const { data: command } = await supabase
                .from("device_commands")
                .select("id, organization_id, requested_by, command_type")
                .eq("id", commandId)
                .eq("device_id", deviceId)
                .maybeSingle();

              if (!command) return;

              if (command.command_type === "update_agent") {
                const { data: correlation, error: correlationError } = await supabase
                  .from("device_commands").select("update_transaction_id")
                  .eq("id", command.id).eq("device_id", deviceId).single();
                if (correlationError) throw new Error("UPDATE_CORRELATION_LOOKUP_FAILED");
                if (correlation.update_transaction_id) return;
              }

              await supabase
                .from("device_commands")
                .update({
                  status,
                  completed_at: completedAt,
                  result: message.result ?? {},
                  error_code: message.error_code ?? null,
                  error_message: message.error_message ?? null,
                })
                .eq("id", command.id)
                .eq("device_id", deviceId)
                .in("status", ["dispatched", "acknowledged", "running"]);

              await supabase.from("audit_logs").insert({
                organization_id: command.organization_id,
                user_id: command.requested_by,
                action: status === "succeeded"
                  ? "device.command.succeeded"
                  : "device.command.failed",
                target_type: "device",
                target_id: deviceId,
                status: status === "succeeded" ? "success" : "failed",
                metadata: {
                  commandId,
                  errorCode: message.error_code ?? null,
                },
              });

              return;
            }

            console.log(
              `[Realtime Agent] Unknown message: ${message.type}`,
            );
          } catch (error) {
            console.error(
              "[Realtime Agent] Message error:",
              error,
            );
          }
        },
      );

      /* =====================================
         CLOSE
      ===================================== */

      ws.on(
        "close",
        (
          code,
          reason,
        ) => {
          cleanup();

          console.log(
            `[Realtime Agent] Disconnected: ${
              hostname ||
              deviceId ||
              "unauthenticated"
            } | ${code} | ${reason.toString()}`,
          );
        },
      );

      /* =====================================
         ERROR
      ===================================== */

      ws.on(
        "error",
        (
          error,
        ) => {
          console.error(
            `[Realtime Agent] Socket error: ${
              hostname ||
              deviceId ||
              "unauthenticated"
            }`,
            error,
          );
        },
      );
    },
  );
}