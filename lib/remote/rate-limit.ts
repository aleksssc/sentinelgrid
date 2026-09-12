import "server-only";

import { getRedis } from "@/lib/realtime/redis";

export async function enforceRemoteRateLimit(
  userId: string,
  scope: "commands" | "sessions",
) {
  const redis = getRedis();
  const key = `sentinelgrid:remote-rate:${scope}:${userId}`;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, 60);
  }

  const limit = scope === "commands" ? 300 : 50;
  if (count > limit) {
    throw new Error("RATE_LIMITED");
  }
}
