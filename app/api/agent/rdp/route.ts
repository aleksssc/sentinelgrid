import { authenticateUpdateAgent } from "@/lib/agent/update-auth";
import { assertLiveRDPSession, finishRDPSession, issueRDPTicket, loadRDPSession, rdpError } from "@/lib/remote/rdp";
import { relayURL } from "@/lib/remote/rdp-policy";

export async function POST(request: Request) {
  try {
    const { admin, device } = await authenticateUpdateAgent(request);
    if (!process.env.SENTINELGRID_RELAY_URL) return new Response(null, { status: 204 });
    const relay = relayURL(process.env.SENTINELGRID_RELAY_URL);
    const { data, error } = await admin.from("rdp_sessions").select("id")
      .eq("device_id", device.id).eq("status", "requested")
      .gt("created_at", new Date(Date.now() - 60_000).toISOString())
      .order("created_at").limit(1).maybeSingle();
    if (error) throw new Error("SESSION_LOOKUP_FAILED");
    if (!data) return new Response(null, { status: 204 });
    const session = await loadRDPSession(data.id);
    try { await assertLiveRDPSession(session); }
    catch (error) { await finishRDPSession(session, "failed"); throw error; }
    const { data: claimed, error: claimError } = await admin.from("rdp_sessions")
      .update({ status: "connecting" }).eq("id", session.id).eq("status", "requested").select("id").maybeSingle();
    if (claimError) throw new Error("SESSION_CLAIM_FAILED");
    if (!claimed) return new Response(null, { status: 204 });
    try {
      const ticket = await issueRDPTicket(session.id, "agent");
      return Response.json({ relay, ticket, expires_at: session.expires_at }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { await finishRDPSession(session, "failed"); throw error; }
  } catch (error) { return rdpError(error); }
}
