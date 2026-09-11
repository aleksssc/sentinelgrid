import { createClient } from "@/lib/supabase/server";
import { assertRDPBrowserOrigin, browserRDPSession, createRDPSession, finishRDPSession, RDPError, rdpError, readRDPBody } from "@/lib/remote/rdp";
import { RDP_ACTIVE_STATUSES, UUID } from "@/lib/remote/rdp-policy";

type Context = { params: Promise<{ deviceId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertRDPBrowserOrigin(request);
    const body = await readRDPBody(request);
    if (Object.keys(body).some((key) => key !== "reason")) throw new RDPError("INVALID_REQUEST", 400);
    const { deviceId } = await params;
    return Response.json(await createRDPSession(deviceId, body.reason), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return rdpError(error); }
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { deviceId } = await params;
    if (!UUID.test(deviceId)) throw new RDPError("DEVICE_NOT_FOUND", 404);
    const client = await createClient();
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) throw new RDPError("UNAUTHORIZED", 401);
    const { data, error } = await client.from("rdp_sessions").select("id")
      .eq("device_id", deviceId).in("status", RDP_ACTIVE_STATUSES).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error("SESSION_LOOKUP_FAILED");
    if (!data) return new Response(null, { status: 204 });
    const session = await browserRDPSession(deviceId, data.id);
    if (Date.parse(session.expires_at) <= Date.now() ||
        (session.status === "active" && (!session.relay_seen_at || Date.parse(session.relay_seen_at) + 30_000 < Date.now())) ||
        (["requested", "connecting"].includes(session.status) && Date.parse(session.created_at) + 120_000 < Date.now())) {
      await finishRDPSession(session, "failed");
      return new Response(null, { status: 204 });
    }
    return Response.json({ sessionId: session.id, expiresAt: session.expires_at, status: session.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return rdpError(error); }
}
