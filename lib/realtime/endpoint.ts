export function realtimeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "wss:" || !url.hostname || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || url.href !== `${url.origin}/`) {
    throw new Error("SENTINELGRID_REALTIME_URL must be a WSS origin without credentials, path, query or fragment");
  }
  return url.origin;
}

export async function browserRealtimeURL(origin: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(new URL("/api/realtime/endpoint", origin), {
    cache: "no-store", redirect: "error", signal,
  });
  if (!response.ok) throw new Error("Realtime endpoint discovery failed");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("origin" in body) ||
      (body.origin !== null && typeof body.origin !== "string")) {
    throw new Error("Invalid realtime endpoint response");
  }
  const endpoint = body.origin === null ? null : realtimeOrigin(body.origin);
  if (body.origin !== null && !endpoint) throw new Error("Invalid realtime endpoint response");
  const url = new URL("/api/realtime/browser", endpoint ?? origin);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  return url.href;
}
