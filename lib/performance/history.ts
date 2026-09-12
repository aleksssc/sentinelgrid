import "server-only";

import { getRedis } from "@/lib/realtime/redis";
import { isPerformanceSample, PERFORMANCE_RANGES, type PerformanceHistory, type PerformanceRange, type PerformanceSample } from "./metrics";

const ranges = Object.keys(PERFORMANCE_RANGES) as PerformanceRange[];
const key = (deviceId: string, range: PerformanceRange) => `sentinelgrid:device:{${deviceId}}:performance:${range}`;

// One atomic request; concurrent/retried heartbeats cannot replace a newer sample.
export const STORE_PERFORMANCE = `
local sample = ARGV[1]
local now = tonumber(ARGV[2])
for i, key in ipairs(KEYS) do
  local duration = tonumber(ARGV[2 * i + 1])
  local interval = tonumber(ARGV[2 * i + 2])
  local bucket = math.floor(now / interval) * interval
  local previous = redis.call('ZRANGEBYSCORE', key, bucket, bucket)
  if #previous == 0 or tonumber(cjson.decode(previous[1]).timestamp) < now then
    redis.call('ZREMRANGEBYSCORE', key, bucket, bucket)
    redis.call('ZADD', key, bucket, sample)
  end
  redis.call('ZREMRANGEBYSCORE', key, '-inf', math.floor((now - duration) / interval) * interval - interval)
  redis.call('ZREMRANGEBYRANK', key, 0, -(math.floor(duration / interval) + 2))
  redis.call('EXPIRE', key, math.ceil((duration + interval) / 1000))
end
return 1
`;

export async function storePerformanceSample(deviceId: string, sample: PerformanceSample) {
  if (!isPerformanceSample(sample)) throw new Error("INVALID_PERFORMANCE_SAMPLE");
  await getRedis().eval(STORE_PERFORMANCE, ranges.map((range) => key(deviceId, range)), [
    JSON.stringify(sample), sample.timestamp,
    ...ranges.flatMap((range) => [PERFORMANCE_RANGES[range].duration, PERFORMANCE_RANGES[range].interval]),
  ]);
}

export async function readPerformanceHistory(deviceId: string, range: PerformanceRange, now = Date.now()): Promise<PerformanceHistory> {
  const { duration, interval } = PERFORMANCE_RANGES[range];
  const from = now - duration;
  const values = await getRedis().zrange<unknown[]>(key(deviceId, range), Math.floor(from / interval) * interval, now,
    { byScore: true, offset: 0, count: duration / interval + 1 });
  if (!values.every(isPerformanceSample)) throw new Error("INVALID_PERFORMANCE_HISTORY");
  return { range, from, to: now, interval, samples: values.filter((sample) => sample.timestamp >= from && sample.timestamp <= now) };
}
