import { assertRDPBrowserOrigin, browserRDPSession, finishRDPSession, rdpError } from "@/lib/remote/rdp";

type Context = { params: Promise<{ deviceId: string; sessionId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { deviceId, sessionId } = await params;
    const session = await browserRDPSession(deviceId, sessionId);
    if (session.status === "active" && (!session.relay_seen_at || Date.parse(session.relay_seen_at) + 30_000 < Date.now())) {
      await finishRDPSession(session, "failed");
      session.status = "failed";
    }
    return Response.json({ sessionId: session.id, status: session.status, expiresAt: session.expires_at }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) { return rdpError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { deviceId, sessionId } = await params;
    assertRDPBrowserOrigin(request);
    await finishRDPSession(await browserRDPSession(deviceId, sessionId), "closed");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return rdpError(error); }
}
