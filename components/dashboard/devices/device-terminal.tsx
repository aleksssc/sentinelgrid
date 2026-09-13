"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Terminal, X } from "lucide-react";
import ViewportDialog from "@/components/dashboard/viewport-dialog";

import { createClient } from "@/lib/supabase/client";
import { browserRealtimeURL } from "@/lib/realtime/endpoint";

export type TerminalShell =
  | "cmd"
  | "powershell";

type TerminalStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "offline"
  | "error";

type TerminalEntry = {
  id: string;

  kind:
    | "command"
    | "stdout"
    | "stderr"
    | "system";

  text: string;

  shell?: TerminalShell;

  exitCode?: number;
};

type RealtimeBrowserMessage = {
  type?: string;

  device_id?: string;

  session_id?: string;

  online?: boolean;

  command_id?: string;

  stdout?: string;

  stderr?: string;

  exit_code?: number;

  code?: string;

  message?: string;
};

type TerminalDevice = {
  id: string;

  hostname: string;

  display_name:
    | string
    | null;
};

type Props = {
  open: boolean;

  initialShell: TerminalShell;

  device: TerminalDevice | null;

  canManage: boolean;

  onClose: () => void;
};

export default function DeviceTerminal({
  open,
  initialShell,
  device,
  canManage,
  onClose,
}: Props) {
  const supabase =
    useMemo(
      () =>
        createClient(),
      [],
    );

  const [
    shell,
    setShell,
  ] =
    useState<TerminalShell>(
      initialShell,
    );

  const [
    status,
    setStatus,
  ] =
    useState<TerminalStatus>(
      "idle",
    );

  const [
    input,
    setInput,
  ] =
    useState("");

  const [
    entries,
    setEntries,
  ] =
    useState<TerminalEntry[]>(
      [],
    );

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const socketRef =
    useRef<WebSocket | null>(
      null,
    );

  const pingRef =
    useRef<number | null>(
      null,
    );

  const inputRef =
    useRef<HTMLInputElement | null>(null);

  const bottomRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const historyRef =
    useRef<string[]>(
      [],
    );

  const historyIndexRef =
    useRef(-1);

  function appendEntry(
    entry: Omit<
      TerminalEntry,
      "id"
    >,
  ) {
    setEntries(
      (current) => [
        ...current,
        {
          ...entry,

          id:
            crypto.randomUUID(),
        },
      ],
    );
  }

  const disconnectSocket = useCallback(() => {
    if (
      pingRef.current !==
      null
    ) {
      window.clearInterval(
        pingRef.current,
      );

      pingRef.current =
        null;
    }

    const socket =
      socketRef.current;

    socketRef.current =
      null;

    if (
      socket &&
      socket.readyState !==
        WebSocket.CLOSED
    ) {
      socket.close(
        1000,
        "Terminal closed",
      );
    }
  }, []);

  const closeTerminal = useCallback(() => {
    disconnectSocket();

    setBusy(
      false,
    );

    setStatus(
      "idle",
    );

    setError("");

    onClose();
  }, [disconnectSocket, onClose]);

  function runCommand() {
    if (
      !canManage ||
      !device ||
      busy
    ) {
      return;
    }

    const command =
      input.trim();

    if (!command) {
      return;
    }

    inputRef.current?.focus({ preventScroll: true });

    if (
      command.toLowerCase() ===
        "clear" ||
      command.toLowerCase() ===
        "cls"
    ) {
      setEntries([]);

      setInput("");

      return;
    }

    const socket =
      socketRef.current;

    if (
      status !==
        "connected" ||
      !socket ||
      socket.readyState !==
        WebSocket.OPEN
    ) {
      setError(
        status ===
          "offline"
          ? "The Agent is offline."
          : "Realtime connection is not ready.",
      );

      return;
    }

    historyRef.current =
      [
        ...historyRef.current,
        command,
      ].slice(
        -50,
      );

    historyIndexRef.current =
      historyRef.current.length;

    appendEntry({
      kind:
        "command",

      text:
        command,

      shell,
    });

    setInput("");

    setError("");

    setBusy(
      true,
    );

    try {
      socket.send(
        JSON.stringify({
          type:
            "command",

          shell,

          command,
        }),
      );
    } catch (sendError) {
      console.error(
        "Could not send remote command:",
        sendError,
      );

      setBusy(
        false,
      );

      setError(
        "Could not send the command.",
      );

      appendEntry({
        kind:
          "stderr",

        text:
          "SentinelGrid: could not send the command.",
      });
    }
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (
      event.key ===
      "Enter"
    ) {
      event.preventDefault();

      runCommand();

      return;
    }

    const history =
      historyRef.current;

    if (
      event.key ===
      "ArrowUp"
    ) {
      if (
        history.length ===
        0
      ) {
        return;
      }

      event.preventDefault();

      const currentIndex =
        historyIndexRef.current;

      const nextIndex =
        currentIndex <= 0
          ? 0
          : Math.min(
              history.length -
                1,
              currentIndex -
                1,
            );

      historyIndexRef.current =
        nextIndex;

      setInput(
        history[
          nextIndex
        ] ?? "",
      );

      return;
    }

    if (
      event.key ===
      "ArrowDown"
    ) {
      if (
        history.length ===
        0
      ) {
        return;
      }

      event.preventDefault();

      const currentIndex =
        historyIndexRef.current;

      if (
        currentIndex >=
        history.length -
          1
      ) {
        historyIndexRef.current =
          history.length;

        setInput("");

        return;
      }

      const nextIndex =
        Math.max(
          0,
          currentIndex +
            1,
        );

      historyIndexRef.current =
        nextIndex;

      setInput(
        history[
          nextIndex
        ] ?? "",
      );
    }
  }

  useEffect(() => {
    if (
      !open ||
      !device ||
      !canManage
    ) {
      return;
    }

    setShell(
      initialShell,
    );

    setInput("");

    setError("");

    setBusy(
      false,
    );

    setStatus(
      "connecting",
    );

    setEntries([
      {
        id:
          crypto.randomUUID(),

        kind:
          "system",

        text:
          `Opening remote session to ${
            device.display_name ||
            device.hostname
          }...`,
      },
    ]);

    historyRef.current =
      [];

    historyIndexRef.current =
      -1;
  }, [
    open,
    device?.id,
    initialShell,
    canManage,
  ]);

  useEffect(() => {
    if (
      !open ||
      !device ||
      !canManage
    ) {
      return;
    }

    let cancelled =
      false;

    let reconnectTimer:
      number
      | null =
      null;

    const deviceId =
      device.id;

    const deviceName =
      device.display_name ||
      device.hostname;

    async function connectTerminal() {
      if (cancelled) {
        return;
      }

      setStatus(
        "connecting",
      );

      setError("");

      const {
        data,
        error:
          sessionError,
      } =
        await supabase.auth.getSession();

      if (cancelled) {
        return;
      }

      const accessToken =
        data.session
          ?.access_token;

      if (
        sessionError ||
        !accessToken
      ) {
        setStatus(
          "error",
        );

        setError(
          "Could not authenticate the remote session.",
        );

        return;
      }

      let socket: WebSocket;
      try {
        const url = await browserRealtimeURL(window.location.origin, AbortSignal.timeout(15000));
        if (cancelled) return;
        socket = new WebSocket(url);
      } catch (error) {
        if (cancelled) return;
        console.error("Realtime endpoint connection failed:", error);
        setStatus("error");
        setError("Could not connect to the realtime service.");
        reconnectTimer = window.setTimeout(() => { void connectTerminal(); }, 10000);
        return;
      }

      socketRef.current =
        socket;

      socket.onopen =
        () => {
          if (
            cancelled
          ) {
            socket.close();

            return;
          }

          socket.send(
            JSON.stringify({
              type:
                "browser_auth",

              access_token:
                accessToken,

              device_id:
                deviceId,
            }),
          );
        };

      socket.onmessage =
        (
          event,
        ) => {
          if (
            cancelled
          ) {
            return;
          }

          try {
            const message =
              JSON.parse(
                String(
                  event.data,
                ),
              ) as RealtimeBrowserMessage;

            if (
              message.type ===
              "browser_authenticated"
            ) {
              const online =
                Boolean(
                  message.online,
                );

              setStatus(
                online
                  ? "connected"
                  : "offline",
              );

              setError(
                online
                  ? ""
                  : "The Agent is currently offline.",
              );

              appendEntry({
                kind:
                  "system",

                text:
                  online
                    ? `Connected to ${deviceName}.`
                    : `Connected to SentinelGrid, but ${deviceName} is offline.`,
              });

              if (
                pingRef.current !==
                null
              ) {
                window.clearInterval(
                  pingRef.current,
                );
              }

              pingRef.current =
                window.setInterval(
                  () => {
                    if (
                      socket.readyState ===
                      WebSocket.OPEN
                    ) {
                      socket.send(
                        JSON.stringify({
                          type:
                            "ping",
                        }),
                      );
                    }
                  },
                  15_000,
                );

              return;
            }

            if (
              message.type ===
              "pong"
            ) {
              const online =
                Boolean(
                  message.online,
                );

              setStatus(
                online
                  ? "connected"
                  : "offline",
              );

              setError(
                online
                  ? ""
                  : "The Agent is currently offline.",
              );

              return;
            }

            if (
              message.type ===
              "command_accepted"
            ) {
              return;
            }

            if (
              message.type ===
              "command_result"
            ) {
              if (
                message.stdout
              ) {
                appendEntry({
                  kind:
                    "stdout",

                  text:
                    message.stdout,

                  exitCode:
                    message.exit_code,
                });
              }

              if (
                message.stderr
              ) {
                appendEntry({
                  kind:
                    "stderr",

                  text:
                    message.stderr,

                  exitCode:
                    message.exit_code,
                });
              }

              if (
                !message.stdout &&
                !message.stderr
              ) {
                appendEntry({
                  kind:
                    "system",

                  text:
                    `Command completed with exit code ${
                      message.exit_code ??
                      0
                    }.`,

                  exitCode:
                    message.exit_code,
                });
              } else if (
                typeof message.exit_code ===
                  "number" &&
                message.exit_code !==
                  0
              ) {
                appendEntry({
                  kind:
                    "system",

                  text:
                    `Exit code: ${message.exit_code}`,

                  exitCode:
                    message.exit_code,
                });
              }

              setBusy(
                false,
              );

              return;
            }

            if (
              message.type ===
              "error"
            ) {
              const errorMessage =
                message.message ||
                "Realtime command failed.";

              setBusy(
                false,
              );

              setError(
                errorMessage,
              );

              if (
                message.code ===
                "DEVICE_OFFLINE"
              ) {
                setStatus(
                  "offline",
                );
              }

              appendEntry({
                kind:
                  "stderr",

                text:
                  `SentinelGrid: ${errorMessage}`,
              });
            }
          } catch (
            messageError
          ) {
            console.error(
              "Invalid realtime browser message:",
              messageError,
            );
          }
        };

      socket.onerror =
        () => {
          if (
            cancelled
          ) {
            return;
          }

          setError(
            "Realtime connection error.",
          );
        };

      socket.onclose =
        (
          event,
        ) => {
          if (
            socketRef.current ===
            socket
          ) {
            socketRef.current =
              null;
          }

          if (
            pingRef.current !==
            null
          ) {
            window.clearInterval(
              pingRef.current,
            );

            pingRef.current =
              null;
          }

          setBusy(
            false,
          );

          if (
            cancelled ||
            event.code ===
              1000
          ) {
            return;
          }

          setStatus(
            "connecting",
          );

          setError(
            "Realtime connection lost. Reconnecting...",
          );

          reconnectTimer =
            window.setTimeout(
              () => {
                void connectTerminal();
              },
              2500,
            );
        };
    }

    void connectTerminal();

    return () => {
      cancelled =
        true;

      if (
        reconnectTimer !==
        null
      ) {
        window.clearTimeout(
          reconnectTimer,
        );
      }

      if (
        pingRef.current !==
        null
      ) {
        window.clearInterval(
          pingRef.current,
        );

        pingRef.current =
          null;
      }

      const socket =
        socketRef.current;

      socketRef.current =
        null;

      if (
        socket &&
        socket.readyState !==
          WebSocket.CLOSED
      ) {
        socket.close(
          1000,
          "Terminal closed",
        );
      }
    };
  }, [
    open,
    device?.id,
    canManage,
    supabase,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const output = bottomRef.current?.parentElement;
    output?.scrollTo({ top: output.scrollHeight, behavior: "instant" });
  }, [
    entries,
    open,
  ]);

  useEffect(() => {
    if (open && device?.id && canManage && status === "connected" && !busy) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [open, device?.id, canManage, status, busy]);

  useEffect(() => {
    if (!open || !device) return;

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      closeTerminal();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, device, closeTerminal]);

  if (
    !open ||
    !device
  ) {
    return null;
  }

  return (
    <ViewportDialog label="Remote terminal" onDismiss={closeTerminal}>
      <div className="sg-terminal-panel">

        {/* HEADER */}

        <div className="sg-terminal-header">

          <div className="flex min-w-0 items-center gap-3">

            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-black text-zinc-300">
              <Terminal
                size={18}
              />
            </div>

            <div className="min-w-0">

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">

                <h2 className="truncate text-sm font-semibold text-white">
                  Remote terminal
                </h2>

                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    status ===
                    "connected"
                      ? "bg-emerald-400"
                      : status ===
                          "offline"
                        ? "bg-zinc-600"
                        : status ===
                            "connecting"
                          ? "bg-amber-400"
                          : status ===
                              "error"
                            ? "bg-red-400"
                            : "bg-zinc-700"
                  }`}
                />

                <span className="text-xs text-zinc-500">
                  {status ===
                  "connected"
                    ? "Connected"
                    : status ===
                        "offline"
                      ? "Agent offline"
                      : status ===
                          "connecting"
                        ? "Connecting..."
                        : status ===
                            "error"
                          ? "Connection error"
                          : "Disconnected"}
                </span>

              </div>

              <p className="mt-0.5 truncate text-xs text-zinc-600">
                {device.display_name ||
                  device.hostname}
                {" · "}
                {device.hostname}
              </p>

            </div>

          </div>

          <div className="sg-terminal-controls">

            <div className="sg-terminal-shell relative isolate grid grid-cols-2 rounded-lg border border-zinc-800 bg-[#08090b] p-1">

              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-y-1 left-1 -z-10 w-[calc((100%-0.5rem)/2)] rounded-md bg-zinc-800 transition-transform duration-200 ease-out motion-reduce:transition-none ${
                  shell === "cmd"
                    ? "translate-x-full"
                    : "translate-x-0"
                } ${busy ? "opacity-50" : ""}`}
              />

              <button
                type="button"
                aria-pressed={shell === "powershell"}
                onClick={() =>
                  setShell(
                    "powershell",
                  )
                }
                disabled={
                  busy
                }
                className={`rounded-md px-3 py-1.5 text-xs font-medium outline-none transition-colors duration-200 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${
                  shell ===
                  "powershell"
                    ? "text-white"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                PowerShell
              </button>

              <button
                type="button"
                aria-pressed={shell === "cmd"}
                onClick={() =>
                  setShell(
                    "cmd",
                  )
                }
                disabled={
                  busy
                }
                className={`rounded-md px-3 py-1.5 text-xs font-medium outline-none transition-colors duration-200 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${
                  shell ===
                  "cmd"
                    ? "text-white"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                CMD
              </button>

            </div>

            <button
              type="button"
              onClick={
                closeTerminal
              }
              aria-label="Close remote terminal"
              className="sg-terminal-close sg-button sg-button-ghost sg-button-icon"
            >
              <X
                size={18}
              />
            </button>

          </div>

        </div>

        {/* BODY */}

        <div
          className="sg-terminal-output min-h-0 flex-1 overflow-auto bg-[#050607] px-5 py-4 font-mono text-[13px] leading-6"
          onClick={(
            event,
          ) => {
            const inputElement =
              event.currentTarget
                .parentElement
                ?.querySelector<HTMLInputElement>(
                  "[data-terminal-input]",
                );

            inputElement?.focus();
          }}
        >

          {entries.length ===
          0 ? (
            <p className="text-zinc-700">
              SentinelGrid remote terminal
            </p>
          ) : (
            entries.map(
              (
                entry,
              ) => (
                <div
                  key={
                    entry.id
                  }
                  className="whitespace-pre-wrap break-words"
                >

                  {entry.kind ===
                    "command" ? (
                    <div className="mt-2 flex items-start gap-2 first:mt-0">

                      <span
                        className={
                          entry.shell ===
                          "powershell"
                            ? "shrink-0 text-sky-400"
                            : "shrink-0 text-emerald-400"
                        }
                      >
                        {entry.shell ===
                        "powershell"
                          ? "PS>"
                          : "CMD>"}
                      </span>

                      <span className="text-zinc-100">
                        {
                          entry.text
                        }
                      </span>

                    </div>
                  ) : entry.kind ===
                    "stderr" ? (
                    <div className="text-red-400">
                      {
                        entry.text
                      }
                    </div>
                  ) : entry.kind ===
                    "system" ? (
                    <div className="text-zinc-600">
                      {
                        entry.text
                      }
                    </div>
                  ) : (
                    <div className="text-zinc-300">
                      {
                        entry.text
                      }
                    </div>
                  )}

                </div>
              ),
            )
          )}

          {busy && (
            <div className="mt-2 flex items-center gap-2 text-zinc-600">

              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />

              Running command...

            </div>
          )}

          <div
            ref={
              bottomRef
            }
          />

        </div>

        {/* ERROR */}

        {error && (
          <div role="alert" className="sg-terminal-error shrink-0 border-t border-zinc-800 bg-[#100b0d] px-5 py-2.5 text-xs text-red-400">
            {
              error
            }
          </div>
        )}

        {/* INPUT */}

        <div className="sg-terminal-footer shrink-0 border-t border-zinc-800 bg-[#0d0f12] p-4">

          <div className="sg-input-frame flex items-center gap-3 rounded-xl border border-surface-edge bg-[#050607] px-3">

            <span
              className={`shrink-0 font-mono text-sm ${
                shell ===
                "powershell"
                  ? "text-sky-400"
                  : "text-emerald-400"
              }`}
            >
              {shell ===
              "powershell"
                ? "PS>"
                : "CMD>"}
            </span>

            <input
              ref={inputRef}
              data-terminal-input
              aria-label="Terminal command"
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={
                input
              }
              onChange={(event) =>
                setInput(
                  event.target.value,
                )
              }
              onKeyDown={
                handleKeyDown
              }
              disabled={
                status !==
                  "connected" ||
                busy
              }
              placeholder={
                status ===
                "connected"
                  ? shell ===
                    "powershell"
                    ? "Enter a PowerShell command..."
                    : "Enter a CMD command..."
                  : status ===
                      "offline"
                    ? "Agent is offline"
                    : "Waiting for realtime connection..."
              }
              className="min-w-0 flex-1 bg-transparent py-3 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-700 disabled:cursor-not-allowed"
            />

            <button
              type="button"
              onClick={
                runCommand
              }
              disabled={
                status !==
                  "connected" ||
                busy ||
                !input.trim()
              }
              className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black outline-none transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Run
            </button>

          </div>

          <div className="sg-terminal-hints mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-zinc-700">

            <span>
              Enter to run · ↑ ↓ for history · clear to clear output
            </span>

            <span>
              Commands run through the SentinelGrid Agent
            </span>

          </div>

        </div>

      </div>
    </ViewportDialog>
  );
}