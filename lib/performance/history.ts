import "server-only";

import { getRedis } from "@/lib/realtime/redis";
import {
  isPerformanceSample,
  PERFORMANCE_RANGES,
  type PerformanceHistory,
  type PerformanceRange,
  type PerformanceSample,
} from "./metrics";

const ranges = Object.keys(PERFORMANCE_RANGES) as PerformanceRange[];
const key = (deviceId: string, range: PerformanceRange) =>
  `sentinelgrid:device:{${deviceId}}:performance:${range}`;

const WRITE_WINDOW_MS = 30_000;
const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function isDue(timestamp: number, interval: number) {
  return timestamp % interval < WRITE_WINDOW_MS;
}

function isMaintenanceDue(timestamp: number) {
  return timestamp % MAINTENANCE_INTERVAL_MS < WRITE_WINDOW_MS;
}

export async function storePerformanceSample(deviceId: string, sample: PerformanceSample) {
  if (!isPerformanceSample(sample)) throw new Error("INVALID_PERFORMANCE_SAMPLE");

  const dueRanges = ranges.filter((range) =>
    isDue(sample.timestamp, PERFORMANCE_RANGES[range].interval),
  );
  const maintenanceDue = isMaintenanceDue(sample.timestamp);

  if (!dueRanges.length && !maintenanceDue) return;

  const redis = getRedis();
  const pipeline = redis.pipeline();
  const encoded = JSON.stringify(sample);

  for (const range of dueRanges) {
    pipeline.zadd(key(deviceId, range), {
      score: sample.timestamp,
      member: encoded,
    });
  }

  if (maintenanceDue) {
    for (const range of ranges) {
      const { duration, interval } = PERFORMANCE_RANGES[range];
      pipeline.zremrangebyscore(
        key(deviceId, range),
        0,
        sample.timestamp - duration - interval,
      );
      pipeline.expire(
        key(deviceId, range),
        Math.ceil((duration + MAINTENANCE_INTERVAL_MS + interval) / 1000),
      );
    }
  }

  await pipeline.exec();
}

export async function readPerformanceHistory(
  deviceId: string,
  range: PerformanceRange,
  now = Date.now(),
): Promise<PerformanceHistory> {
  const { duration, interval } = PERFORMANCE_RANGES[range];
  const from = now - duration;
  const capacity = duration / interval + 1;

  const values = await getRedis().zrange<unknown[]>(
    key(deviceId, range),
    from,
    now,
    { byScore: true, offset: 0, count: capacity * 2 + 4 },
  );

  if (!values.every(isPerformanceSample)) {
    throw new Error("INVALID_PERFORMANCE_HISTORY");
  }

  const latestByBucket = new Map<number, PerformanceSample>();

  for (const sample of values) {
    if (sample.timestamp < from || sample.timestamp > now) continue;
    const bucket = Math.floor(sample.timestamp / interval);
    const previous = latestByBucket.get(bucket);
    if (!previous || sample.timestamp > previous.timestamp) {
      latestByBucket.set(bucket, sample);
    }
  }

  const samples = [...latestByBucket.values()]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-capacity);

  return { range, from, to: now, interval, samples };
}
