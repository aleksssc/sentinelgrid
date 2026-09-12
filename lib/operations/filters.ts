export type SearchParams = Record<string, string | string[] | undefined>;
export type OperationsKind = "incidents" | "alerts";
export const PAGE_SIZE = 25;
export const MAX_PAGE = 1000;

export type OperationsFilters = {
  source: string;
  query: string;
  status: string;
  days: number;
  page: number;
};

function single(value: SearchParams[string]): string {
  return typeof value === "string" ? value : "";
}

export function parseOperationsFilters(params: SearchParams, kind: OperationsKind): OperationsFilters {
  const sources = kind === "incidents" ? ["commands", "audit"] : ["devices", "monitors"];
  const statuses = kind === "incidents" ? ["all", "failed", "expired"] : ["all", "offline", "warning", "unchecked"];
  const source = sources.includes(single(params.source)) ? single(params.source) : sources[0];
  const requestedStatus = single(params.status);
  let status = statuses.includes(requestedStatus) ? requestedStatus : "all";
  if (source === "audit" || (source === "devices" && status === "unchecked") || (source === "monitors" && status === "warning")) status = "all";
  const page = single(params.page);
  const days = Number(single(params.days));
  return {
    source,
    query: single(params.q).trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100),
    status,
    days: [1, 7, 30, 90].includes(days) ? days : 7,
    page: /^\d{1,4}$/.test(page) ? Math.max(1, Math.min(MAX_PAGE, Number(page))) : 1,
  };
}

export function operationsHref(kind: OperationsKind, filters: OperationsFilters, overrides: Partial<OperationsFilters> = {}): string {
  const value = { ...filters, ...overrides };
  const params = new URLSearchParams({ source: value.source });
  if (value.query) params.set("q", value.query);
  if (value.status !== "all") params.set("status", value.status);
  if (kind === "incidents") params.set("days", String(value.days));
  if (value.page > 1) params.set("page", String(value.page));
  return `/dashboard/${kind}?${params}`;
}

export function searchPattern(query: string): string {
  // Quote the entire PostgREST value so punctuation cannot introduce another filter.
  return JSON.stringify(`%${query.replace(/[\\%_*]/g, "\\$&")}%`);
}

export function pageRows<T>(rows: T[], page: number) {
  return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE && page < MAX_PAGE };
}

export function deviceAttentionFilter(status: string, now: number): string {
  const cutoff = new Date(now - 90_000).toISOString();
  const offline = `last_seen.is.null,last_seen.lt.${cutoff},status.eq.offline`;
  if (status === "offline") return offline;
  if (status === "warning") return `and(status.eq.warning,last_seen.gte.${cutoff})`;
  return `${offline},status.eq.warning`;
}

export function deviceSignal(status: string | null, lastSeen: string | null, now: number): "offline" | "warning" {
  const seen = Date.parse(lastSeen ?? "");
  if (!Number.isFinite(seen) || now - seen > 90_000 || status === "offline") return "offline";
  return "warning";
}

export function formatOperationsTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC",
  });
}

export type OperationRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  tone: "error" | "warning" | "info";
  target: string;
  context: string;
  timestamp: string | null;
  timeLabel: string;
  href?: string;
  linkLabel?: string;
  details: { label: string; value: string }[];
};

export type OperationsResult = {
  rows: OperationRow[];
  hasNext: boolean;
  error: string | null;
};
