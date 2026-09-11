export const RDP_TICKET_SECONDS = 60;
export const RDP_ACTIVE_STATUSES = ["requested", "connecting", "active"];
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function relayURL(value: string | undefined): string {
  if (!value) throw new Error("RDP_NOT_CONFIGURED");
  const url = new URL(value);
  if (url.protocol !== "wss:" || url.username || url.password || url.search || url.hash || url.pathname !== "/rdp") {
    throw new Error("RDP_NOT_CONFIGURED");
  }
  return url.toString();
}

export function rdpOnline(lastSeen: unknown, now = Date.now()): boolean {
  if (typeof lastSeen !== "string") return false;
  const age = now - Date.parse(lastSeen);
  return Number.isFinite(age) && age >= -30_000 && age <= 90_000;
}

export function rdpLimits(settings: { max_session_minutes: unknown; max_concurrent_sessions: unknown }) {
  const minutes = settings.max_session_minutes;
  const concurrent = settings.max_concurrent_sessions;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 120 ||
      typeof concurrent !== "number" || !Number.isInteger(concurrent) || concurrent < 1 || concurrent > 20) {
    throw new Error("RDP_POLICY_INVALID");
  }
  return { minutes, concurrent };
}
