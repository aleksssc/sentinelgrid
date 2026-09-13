import "server-only";

import { createClient } from "@/lib/supabase/server";

export type DomainMonitorStatus = "online" | "offline" | "unknown";

type Monitor = {
  id: string;
  name: string;
  url: string;
  status: string | null;
  status_code: number | null;
  response_time_ms: number | null;
  last_checked_at: string | null;
};

export type DomainEndpoint = {
  id: string;
  name: string;
  url: string;
  protocol: string;
  path: string;
  status: DomainMonitorStatus;
  statusCode: number | null;
  responseTime: number | null;
  lastCheckedAt: string | null;
};

export type DomainRecord = {
  hostname: string;
  endpoints: DomainEndpoint[];
  status: DomainMonitorStatus;
  lastCheckedAt: string | null;
};

export type DomainsData = {
  domains: DomainRecord[];
  totalEndpoints: number;
  onlineEndpoints: number;
  attentionEndpoints: number;
  error: string | null;
};

function normalizeStatus(status: string | null): DomainMonitorStatus {
  if (status === "online" || status === "offline") return status;
  return "unknown";
}

function statusPriority(status: DomainMonitorStatus) {
  if (status === "offline") return 2;
  if (status === "unknown") return 1;
  return 0;
}

function latestDate(first: string | null, second: string | null) {
  if (!first) return second;
  if (!second) return first;
  return new Date(first).getTime() >= new Date(second).getTime() ? first : second;
}

export async function loadDomains(userId: string): Promise<DomainsData> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("monitors")
    .select("id, name, url, status, status_code, response_time_ms, last_checked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Domains] Monitor query failed:", error);
    return { domains: [], totalEndpoints: 0, onlineEndpoints: 0, attentionEndpoints: 0, error: "Domains could not be loaded from your monitors. Refresh to retry." };
  }

  const grouped = new Map<string, DomainRecord>();
  let totalEndpoints = 0;
  let onlineEndpoints = 0;
  let attentionEndpoints = 0;

  for (const monitor of (data ?? []) as Monitor[]) {
    let parsed: URL;
    try {
      parsed = new URL(monitor.url);
    } catch {
      console.warn("[Domains] Ignoring monitor with an invalid URL:", monitor.id);
      continue;
    }

    const status = normalizeStatus(monitor.status);
    const endpoint: DomainEndpoint = {
      id: monitor.id,
      name: monitor.name,
      url: monitor.url,
      protocol: parsed.protocol.replace(":", "").toUpperCase(),
      path: `${parsed.pathname}${parsed.search}` || "/",
      status,
      statusCode: monitor.status_code,
      responseTime: monitor.response_time_ms,
      lastCheckedAt: monitor.last_checked_at,
    };
    const hostname = parsed.hostname.toLowerCase();
    const existing = grouped.get(hostname);
    totalEndpoints += 1;
    if (status === "online") onlineEndpoints += 1;
    else attentionEndpoints += 1;

    if (existing) {
      existing.endpoints.push(endpoint);
      if (statusPriority(status) > statusPriority(existing.status)) existing.status = status;
      existing.lastCheckedAt = latestDate(existing.lastCheckedAt, endpoint.lastCheckedAt);
    } else {
      grouped.set(hostname, { hostname, endpoints: [endpoint], status, lastCheckedAt: endpoint.lastCheckedAt });
    }
  }

  const domains = [...grouped.values()].sort((a, b) => a.hostname.localeCompare(b.hostname));
  return { domains, totalEndpoints, onlineEndpoints, attentionEndpoints, error: null };
}
