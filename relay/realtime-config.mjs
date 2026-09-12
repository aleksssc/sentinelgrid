import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function loadRealtimeEnvironment(root = fileURLToPath(new URL("../", import.meta.url))) {
  const explicit = process.env.SENTINELGRID_REALTIME_ENV_FILE;
  const mode = process.env.NODE_ENV;
  const files = explicit ? [resolve(root, explicit)] :
    !mode || mode === "development" ? [resolve(root, ".env.local"), resolve(root, ".env")] : [];
  for (const file of files) {
    try { loadEnvFile(file); }
    catch (error) {
      if (!explicit && error?.code === "ENOENT") continue;
      throw new Error("Could not load realtime environment file");
    }
  }
}

function integer(value, fallback, maximum, name, minimum = 1) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`Invalid ${name}`);
  return number;
}

export function realtimeConfiguration(env = process.env) {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "UPSTASH_REDIS_KV_REST_API_URL", "UPSTASH_REDIS_KV_REST_API_TOKEN"]) {
    if (!env[name]) throw new Error(`Missing ${name}`);
  }
  const cert = env.SENTINELGRID_REALTIME_TLS_CERT;
  const key = env.SENTINELGRID_REALTIME_TLS_KEY;
  if (!!cert !== !!key) throw new Error("Both realtime TLS files are required");
  const proxy = env.SENTINELGRID_REALTIME_TRUST_PROXY;
  if (proxy !== undefined && proxy !== "true" && proxy !== "false") throw new Error("Invalid realtime TLS proxy setting");
  const trustProxy = proxy === "true";
  const host = env.SENTINELGRID_REALTIME_BIND ?? "127.0.0.1";
  if (!cert && host !== "127.0.0.1" && host !== "::1" && !trustProxy) {
    throw new Error("Cleartext realtime must bind loopback or explicitly trust a private TLS proxy");
  }
  return {
    host, cert, key, trustProxy,
    allowDevelopmentOrigin: !env.NODE_ENV || env.NODE_ENV === "development",
    allowedOrigin: env.SENTINELGRID_REALTIME_BROWSER_ORIGIN,
    port: integer(env.SENTINELGRID_REALTIME_PORT ?? env.PORT, 8444, 65535, "realtime port"),
    maxConnections: integer(env.SENTINELGRID_REALTIME_MAX_CONNECTIONS, 2000, 1000000, "connection limit"),
    shutdownGraceMs: integer(env.SENTINELGRID_REALTIME_SHUTDOWN_GRACE_MS, 30000, 300000, "shutdown grace", 0),
  };
}
