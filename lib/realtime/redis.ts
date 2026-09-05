import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

export function getRedis() {
  if (redis) {
    return redis;
  }

  const url =
    process.env.UPSTASH_REDIS_KV_REST_API_URL;

  const token =
    process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;

  if (!url) {
    throw new Error(
      "UPSTASH_REDIS_KV_REST_API_URL is missing.",
    );
  }

  if (!token) {
    throw new Error(
      "UPSTASH_REDIS_KV_REST_API_TOKEN is missing.",
    );
  }

  redis = new Redis({
    url,
    token,
  });

  return redis;
}