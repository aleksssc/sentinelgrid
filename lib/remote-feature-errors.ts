const remoteErrorMessages: Record<string, string> = {
  RDP_SERVICE_FAILED: "Remote Desktop is temporarily unavailable.",
  RDP_NOT_CONFIGURED: "Remote Desktop is not configured for this environment.",
  SESSION_CREATE_FAILED: "Remote Desktop could not be started. Try again shortly.",
  SESSION_LOOKUP_FAILED: "Remote Desktop session status is temporarily unavailable.",
  SESSION_CLOSE_FAILED: "Remote Desktop session could not be closed. Try again shortly.",
  DEVICE_OFFLINE: "This device is offline.",
  RDP_DISABLED: "Remote Desktop is disabled by organization policy.",
  RDP_UNSUPPORTED: "This device does not support Remote Desktop.",
  SESSION_LIMIT_REACHED: "The Remote Desktop session limit has been reached.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  FORBIDDEN: "You don't have permission to use Remote Desktop.",
};

export function remoteErrorMessage(code: unknown, fallback: string) {
  return typeof code === "string" ? remoteErrorMessages[code] ?? fallback : fallback;
}
