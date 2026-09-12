import { actionLabel, DEVICE_ACTIONS } from "./action-definitions";

export type ActionNotice = {
  tone: "success" | "info" | "progress" | "warning" | "error";
  title: string;
  message: string;
  code?: string;
};

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 512) : undefined;
}

const errors: Record<string, string> = {
  UNAUTHORIZED: "Your session has expired. Sign in again before retrying.",
  FORBIDDEN: "You do not have permission to run device actions.",
  DEVICE_NOT_FOUND: "This device is no longer available to your account.",
  DEVICE_OFFLINE: "This device is offline. Wait for it to reconnect before retrying.",
  COMMAND_BUSY: "Another device command is already running. Wait for it to finish.",
  RATE_LIMITED: "Too many requests. Wait a moment before retrying.",
  REMOTE_ACCESS_DISABLED: "Device actions are disabled by organization policy.",
  AGENT_UNSUPPORTED: "The installed Agent is not ready to run this action. Check its capabilities and organization policy.",
  UNSUPPORTED_COMMAND: "The installed Agent does not support this action.",
  INVALID_COMMAND_TYPE: "This action is not supported. Refresh the page before retrying.",
  INVALID_PAYLOAD: "The action parameters were rejected. Refresh the page before retrying.",
  COMMAND_LOOKUP_FAILED: "Could not validate device action availability. Try again shortly.",
  COMMAND_CREATE_FAILED: "The server could not save the command. Check Activity before retrying.",
  COMMAND_DISPATCH_FAILED: "The command was saved, but delivery was interrupted. Check Activity before retrying.",
  COMMAND_TIMEOUT: "The device did not confirm completion before the deadline. Check Activity before retrying.",
  COMMAND_EXPIRED: "The command expired before execution was confirmed.",
  UPDATE_RELEASE_BLOCKED: "A newer release was previously unsuccessful and is blocked by Agent recovery protection. Check Activity before retrying.",
  UPDATE_POLICY_DISABLED: "Agent installation is disabled by the update policy or updater readiness checks.",
};

function updateNotice(action: string, code?: string, message?: string): ActionNotice | undefined {
  if (action !== "update_agent") return;
  if (code === "NO_NEWER_AGENT_VERSION") return {
    tone: "info", title: "Agent is up to date",
    message: "The Agent already has the latest version available for its configured update channel and policy. No update is needed.",
  };
  // Older Agents combine no-newer and failed-release protection in one error.
  if (code === "NO_ELIGIBLE_AGENT_RELEASE" || (code === "UPDATE_FAILED" && message === "no newer permitted, unfailed Agent release")) return {
    tone: "info", title: "No eligible Agent update",
    message: "No newer permitted release is available, or a previously failed release is blocked. No update was installed.",
  };
}

export function submissionNotice(action: string, code: string, status?: number): ActionNotice {
  const update = updateNotice(action, code);
  if (update) return update;
  const resolved = errors[code] ? code : ({ 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "DEVICE_NOT_FOUND", 429: "RATE_LIMITED" } as Record<number, string>)[status ?? 0];
  if (resolved) return {
    tone: ["DEVICE_OFFLINE", "COMMAND_BUSY", "RATE_LIMITED", "COMMAND_DISPATCH_FAILED"].includes(resolved) ? "warning" : "error",
    title: `${actionLabel(action)} ${resolved === "COMMAND_DISPATCH_FAILED" ? "delivery interrupted" : "not started"}`,
    message: errors[resolved], code: resolved,
  };
  return {
    tone: "warning", title: `${actionLabel(action)} submission not confirmed`,
    message: "Could not confirm whether the server accepted the request. Check Activity before retrying to avoid sending it twice.",
    code: status ? `HTTP_${status}` : code,
  };
}

export function progressNotice(action: string, status: string): ActionNotice {
  const states: Record<string, string> = {
    sending: "Sending request", queued: "Queued", dispatched: "Sent to Agent", acknowledged: "Accepted by Agent", running: "Running",
  };
  return {
    tone: ["sending", "queued", "dispatched"].includes(status) ? "info" : "progress",
    title: `${actionLabel(action)} - ${states[status] ?? "Awaiting confirmation"}`,
    message: status === "sending" ? "Waiting for the server to accept the request." :
      action === "update_agent" ? "The Agent is checking for an eligible release. Installation is only confirmed after the update completes." :
      "The request is not yet complete. Waiting for confirmation from the device.",
  };
}

export function statusUnavailableNotice(action: string): ActionNotice {
  return { tone: "warning", title: `${actionLabel(action)} - awaiting confirmation`,
    message: "Command status is temporarily unavailable. Check Activity for the result; the command has not been cancelled." };
}

export function completionNotice(action: string, command: Record<string, unknown>): ActionNotice {
  const recordedCode = text(command.error_code), message = text(command.error_message);
  const code = action === "update_agent" && recordedCode === "UPDATE_FAILED" &&
    message === "no newer permitted, unfailed Agent release" && command.feedback_code === "NO_NEWER_AGENT_VERSION"
    ? "NO_NEWER_AGENT_VERSION" : recordedCode;
  const update = updateNotice(action, code, message);
  if (command.status !== "succeeded" && update) return update;
  if (command.status === "succeeded") {
    const result = record(command.result);
    const target = text(result.target_version) ?? text(result.update_target_version);
    return { tone: "success", title: action === "update_agent" && target ? `Agent updated to ${target}` :
      DEVICE_ACTIONS.find((item) => item.type === action)?.completed ?? `${actionLabel(action)} completed`,
    message: "Completed successfully and confirmed by the device." };
  }
  const legacyPolicy = action === "update_agent" && code === "UPDATE_FAILED" && message === "trusted update policy disables installation";
  return { tone: "error", title: `${actionLabel(action)} ${command.status === "expired" ? "expired" : "failed"}`,
    message: (legacyPolicy ? errors.UPDATE_POLICY_DISABLED : code && errors[code]) || message || "The device could not complete the action. Check Activity for details.", code };
}

export class ActionSubmissionError extends Error {
  constructor(public code: string, public status?: number) { super(code); }
}

export async function submitDeviceAction(deviceId: string, action: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/devices/${deviceId}/commands`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command_type: action, payload }),
  });
  let body: Record<string, unknown>;
  try { body = record(await response.json()); }
  catch { throw new ActionSubmissionError("INVALID_RESPONSE", response.status); }
  if (!response.ok) throw new ActionSubmissionError(text(body.error) ?? "ACTION_FAILED", response.status);
  const commandId = text(body.commandId);
  if (!commandId) throw new ActionSubmissionError("INVALID_RESPONSE", response.status);
  return { commandId, status: text(body.status) ?? "queued" };
}
