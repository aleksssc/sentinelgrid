import { createAdminClient } from "@/lib/supabase/admin";
import { assertLiveRDPSession, authenticateRDPRelay, consumeRDPTicket, finishRDPSession, loadRDPSession, RDPError, rdpError, readRDPBody } from "@/lib/remote/rdp";

export async function POST(request: Request) {
  try {
    authenticateRDPRelay(request);
    const body = await readRDPBody(request);
    if (body.operation === "redeem") {
      const ticket = await consumeRDPTicket(body.ticket);
      const session = await loadRDPSession(ticket.sessionId);
      const idleSeconds = await assertLiveRDPSession(session);
      return Response.json({ ...ticket, expiresAt: session.expires_at, idleSeconds }, { headers: { "Cache-Control": "no-store" } });
    }
    if (typeof body.sessionId !== "string") throw new RDPError("INVALID_REQUEST", 400);
    const session = await loadRDPSession(body.sessionId);
    let idleSeconds: number | undefined;
    if (body.operation === "finish") {
      await finishRDPSession(session, body.failed === true ? "failed" : "closed");
    } else if (body.operation === "state" || body.operation === "active") {
      idleSeconds = await assertLiveRDPSession(session);
      if (body.operation === "active") {
        const { data, error } = await createAdminClient().from("rdp_sessions")
          .update({ status: "active", connected_at: new Date().toISOString(), relay_seen_at: new Date().toISOString() })
          .eq("id", session.id).eq("status", "connecting").select("id").maybeSingle();
        if (error) throw new Error("SESSION_STATE_FAILED");
        if (!data) throw new RDPError("SESSION_ENDED", 410);
      } else if (session.status === "active") {
        const { data, error } = await createAdminClient().from("rdp_sessions").update({ relay_seen_at: new Date().toISOString() })
          .eq("id", session.id).eq("status", "active").select("id").maybeSingle();
        if (error) throw new Error("SESSION_STATE_FAILED");
        if (!data) throw new RDPError("SESSION_ENDED", 410);
      }
    } else { throw new RDPError("INVALID_REQUEST", 400); }
    return Response.json({ ok: true, idleSeconds }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return rdpError(error); }
}
