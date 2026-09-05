import { getRedis } from "@/lib/realtime/redis";

export function agentCommandChannel(
  deviceId: string,
) {
  return `sentinelgrid:device:${deviceId}:commands`;
}

export function browserResultChannel(
  sessionId: string,
) {
  return `sentinelgrid:session:${sessionId}:results`;
}

export function agentPresenceKey(
  deviceId: string,
) {
  return `sentinelgrid:device:${deviceId}:presence`;
}

export async function publishRealtimeMessage(
  channel: string,
  payload: unknown,
) {
  const redis =
    getRedis();

  await redis.publish(
    channel,
    JSON.stringify(payload),
  );
}

export type RealtimeSubscription = {
  abort: () => void;
  done: Promise<void>;
};

export function subscribeRealtimeChannel<T>(
  channel: string,
  onMessage: (
    message: T,
  ) =>
    | void
    | Promise<void>,
): RealtimeSubscription {
  const url =
    process.env
      .UPSTASH_REDIS_KV_REST_API_URL;

  const token =
    process.env
      .UPSTASH_REDIS_KV_REST_API_TOKEN;

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

  const controller =
    new AbortController();

  const done =
    runSubscription<T>(
      url,
      token,
      channel,
      controller.signal,
      onMessage,
    );

  return {
    abort() {
      controller.abort();
    },

    done,
  };
}

async function runSubscription<T>(
  redisUrl: string,
  token: string,
  channel: string,
  signal: AbortSignal,
  onMessage: (
    message: T,
  ) =>
    | void
    | Promise<void>,
) {
  const endpoint =
    `${redisUrl.replace(
      /\/$/,
      "",
    )}/subscribe/${encodeURIComponent(
      channel,
    )}`;

  try {
    const response =
      await fetch(
        endpoint,
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,

            Accept:
              "text/event-stream",
          },

          signal,

          cache:
            "no-store",
        },
      );

    if (!response.ok) {
      throw new Error(
        `Redis subscription failed with status ${response.status}.`,
      );
    }

    if (!response.body) {
      throw new Error(
        "Redis subscription returned no response body.",
      );
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let buffer =
      "";

    while (true) {
      const {
        done,
        value,
      } =
        await reader.read();

      if (done) {
        break;
      }

      buffer +=
        decoder.decode(
          value,
          {
            stream:
              true,
          },
        );

      const frames =
        buffer.split(
          /\r?\n\r?\n/,
        );

      buffer =
        frames.pop() ??
        "";

      for (
        const frame
        of frames
      ) {
        await processFrame<T>(
          frame,
          channel,
          onMessage,
        );
      }
    }
  } catch (error) {
    if (
      signal.aborted
    ) {
      return;
    }

    throw error;
  }
}

async function processFrame<T>(
  frame: string,
  channel: string,
  onMessage: (
    message: T,
  ) =>
    | void
    | Promise<void>,
) {
  const data =
    frame
      .split(
        /\r?\n/,
      )
      .filter(
        (line) =>
          line.startsWith(
            "data:",
          ),
      )
      .map(
        (line) =>
          line
            .slice(5)
            .trimStart(),
      )
      .join(
        "\n",
      );

  if (!data) {
    return;
  }

  const prefix =
    `message,${channel},`;

  if (
    !data.startsWith(
      prefix,
    )
  ) {
    return;
  }

  const rawPayload =
    data.slice(
      prefix.length,
    );

  try {
    const message =
      JSON.parse(
        rawPayload,
      ) as T;

    await onMessage(
      message,
    );
  } catch (error) {
    console.error(
      "[Realtime Redis] Invalid message:",
      error,
    );
  }
}