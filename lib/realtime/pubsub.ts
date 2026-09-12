import { getRedis } from "./redis";

export function agentCommandChannel(deviceId: string) {
  return `sentinelgrid:device:${deviceId}:commands`;
}

export function browserResultChannel(sessionId: string) {
  return `sentinelgrid:session:${sessionId}:results`;
}

export function agentPresenceKey(deviceId: string) {
  return `sentinelgrid:device:${deviceId}:presence`;
}

export async function publishRealtimeMessage(channel: string, payload: unknown) {
  await getRedis().publish(channel, JSON.stringify(payload));
}

export type RealtimeSubscription = {
  abort: () => void;
  done: Promise<void>;
};

export function subscribeRealtimeChannel<T>(
  channel: string,
  onMessage: (message: T) => void | Promise<void>,
): RealtimeSubscription {
  const url = process.env.UPSTASH_REDIS_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  if (!url) throw new Error("UPSTASH_REDIS_KV_REST_API_URL is missing.");
  if (!token) throw new Error("UPSTASH_REDIS_KV_REST_API_TOKEN is missing.");
  const controller = new AbortController();
  return {
    abort: () => controller.abort(),
    done: runSubscription(url, token, channel, controller.signal, onMessage),
  };
}

async function runSubscription<T>(
  redisUrl: string, token: string, channel: string, signal: AbortSignal,
  onMessage: (message: T) => void | Promise<void>,
) {
  const endpoint = `${redisUrl.replace(/\/$/, "")}/subscribe/${encodeURIComponent(channel)}`;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(endpoint, {
      method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      signal, cache: "no-store",
    });
    if (!response.ok) throw new Error(`Redis subscription failed with status ${response.status}.`);
    if (!response.body) throw new Error("Redis subscription returned no response body.");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) throw new Error("Redis subscription ended unexpectedly.");
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      if (buffer.length > 4 * 1024 * 1024) throw new Error("Redis subscription frame is too large.");
      for (const frame of frames) {
        if (frame.length > 4 * 1024 * 1024) throw new Error("Redis subscription frame is too large.");
        await processFrame(frame, channel, onMessage);
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    if (reader) {
      try { await reader.cancel(); }
      catch { if (!signal.aborted) console.error("[Realtime Redis] Subscription cleanup failed"); }
      reader.releaseLock();
    }
  }
}

async function processFrame<T>(frame: string, channel: string, onMessage: (message: T) => void | Promise<void>) {
  const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trimStart()).join("\n");
  const prefix = `message,${channel},`;
  if (!data.startsWith(prefix)) return;
  let message: T;
  try { message = JSON.parse(data.slice(prefix.length)) as T; }
  catch { throw new Error("Redis subscription delivered invalid JSON."); }
  await onMessage(message);
}
