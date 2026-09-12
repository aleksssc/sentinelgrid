import { connection } from "next/server";
import { realtimeOrigin } from "@/lib/realtime/endpoint";

export async function GET() {
  await connection();
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json({ origin: realtimeOrigin(process.env.SENTINELGRID_REALTIME_URL) }, { headers });
  } catch {
    console.error("[Realtime] INVALID_ENDPOINT_CONFIGURATION");
    return Response.json({ error: "Realtime is not configured correctly." }, { status: 503, headers });
  }
}
