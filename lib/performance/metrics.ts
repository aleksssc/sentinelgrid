export const PERFORMANCE_RANGES = {
  "1h": { label: "1 hour", duration: 3_600_000, interval: 120_000 },
  "24h": { label: "24 hours", duration: 86_400_000, interval: 600_000 },
  "7d": { label: "7 days", duration: 604_800_000, interval: 3_600_000 },
  "30d": { label: "30 days", duration: 2_592_000_000, interval: 14_400_000 },
} as const;

export type PerformanceRange = keyof typeof PERFORMANCE_RANGES;
export const USAGE_METRICS = ["cpu_usage", "ram_usage", "disk_usage"] as const;
export type UsageMetric = typeof USAGE_METRICS[number];
export type PerformanceSample = Record<UsageMetric, number | null> & { timestamp: number };
export type PerformanceHistory = {
  range: PerformanceRange;
  from: number;
  to: number;
  interval: number;
  samples: PerformanceSample[];
};

export function isPerformanceRange(value: string): value is PerformanceRange {
  return Object.hasOwn(PERFORMANCE_RANGES, value);
}

function percentage(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function performanceSample(body: Record<string, unknown>, timestamp: number): PerformanceSample | null {
  const sample = {
    timestamp,
    cpu_usage: percentage(body.cpu_usage),
    ram_usage: percentage(body.ram_usage),
    disk_usage: percentage(body.disk_usage),
  };
  return USAGE_METRICS.some((name) => sample[name] !== null) ? sample : null;
}

export function isPerformanceSample(value: unknown): value is PerformanceSample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sample = value as Record<string, unknown>;
  return typeof sample.timestamp === "number" && Number.isSafeInteger(sample.timestamp) && sample.timestamp > 0 &&
    USAGE_METRICS.every((name) => sample[name] === null || percentage(sample[name]) !== null) &&
    USAGE_METRICS.some((name) => sample[name] !== null);
}

export function isPerformanceHistory(value: unknown, range: PerformanceRange): value is PerformanceHistory {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const config = PERFORMANCE_RANGES[range];
  return data.range === range && typeof data.from === "number" && Number.isFinite(data.from) &&
    typeof data.to === "number" && Number.isFinite(data.to) && data.to - data.from === config.duration &&
    data.interval === config.interval && Array.isArray(data.samples) &&
    data.samples.length <= config.duration / config.interval + 1 &&
    data.samples.every((sample, index, samples) => isPerformanceSample(sample) &&
      sample.timestamp >= Number(data.from) && sample.timestamp <= Number(data.to) &&
      (index === 0 || sample.timestamp > samples[index - 1].timestamp));
}

// Missing measurements and offline intervals must not become a continuous line.
export function metricSegments(samples: PerformanceSample[], metric: UsageMetric, interval: number): PerformanceSample[][] {
  const segments: PerformanceSample[][] = [];
  let segment: PerformanceSample[] = [];
  for (const sample of samples) {
    if (sample[metric] === null || (segment.length && sample.timestamp - segment[segment.length - 1].timestamp > interval * 2)) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (sample[metric] !== null) segment.push(sample);
  }
  if (segment.length) segments.push(segment);
  return segments;
}
