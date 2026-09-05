"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Terminal, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

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

  function disconnectSocket() {
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
  }

  function closeTerminal() {
    disconnectSocket();

    setBusy(
      false,
    );

    setStatus(
      "idle",
    );

    setError("");

    onClose();
  }

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

      const protocol =
        window.location.protocol ===
        "https:"
          ? "wss:"
          : "ws:";

      const socket =
        new WebSocket(
          `${protocol}//${window.location.host}/api/realtime/browser`,
        );

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

    bottomRef.current
      ?.scrollIntoView({
        behavior:
          "smooth",

        block:
          "end",
      });
  }, [
    entries,
    open,
  ]);

  if (
    !open ||
    !device
  ) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close remote terminal"
        onClick={
          closeTerminal
        }
        className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm"
      />

      <div className="fixed left-1/2 top-1/2 z-[80] flex h-[min(720px,calc(100vh-48px))] w-[calc(100%-32px)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#070809] shadow-2xl">

        {/* HEADER */}

        <div className="flex shrink-0 items-center justify-between gap-5 border-b border-zinc-800 bg-[#0d0f12] px-5 py-4">

          <div className="flex min-w-0 items-center gap-3">

            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-black text-zinc-300">
              <Terminal
                size={18}
              />
            </div>

            <div className="min-w-0">

              <div className="flex items-center gap-2">

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

          <div className="flex items-center gap-2">

            <div className="flex rounded-lg border border-zinc-800 bg-[#08090b] p-1">

              <button
                type="button"
                onClick={() =>
                  setShell(
                    "powershell",
                  )
                }
                disabled={
                  busy
                }
                className={`rounded-md px-3 py-1.5 text-xs font-medium outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  shell ===
                  "powershell"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                PowerShell
              </button>

              <button
                type="button"
                onClick={() =>
                  setShell(
                    "cmd",
                  )
                }
                disabled={
                  busy
                }
                className={`rounded-md px-3 py-1.5 text-xs font-medium outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  shell ===
                  "cmd"
                    ? "bg-zinc-800 text-white"
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
              className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 outline-none transition hover:bg-zinc-900 hover:text-white"
            >
              <X
                size={18}
              />
            </button>

          </div>

        </div>

        {/* BODY */}

        <div
          className="min-h-0 flex-1 overflow-y-auto bg-[#050607] px-5 py-4 font-mono text-[13px] leading-6"
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
          <div className="shrink-0 border-t border-zinc-800 bg-[#100b0d] px-5 py-2.5 text-xs text-red-400">
            {
              error
            }
          </div>
        )}

        {/* INPUT */}

        <div className="shrink-0 border-t border-zinc-800 bg-[#0d0f12] p-4">

          <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-[#050607] px-3">

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
              data-terminal-input
              autoFocus
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

          <div className="mt-2 flex items-center justify-between gap-4 text-[11px] text-zinc-700">

            <span>
              Enter to run · ↑ ↓ for history · clear to clear output
            </span>

            <span>
              Commands run through the SentinelGrid Agent
            </span>

          </div>

        </div>

      </div>
    </>
  );
}