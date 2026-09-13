import { redeemRDPLaunch, RDPError, rdpError, readRDPBody } from "@/lib/remote/rdp";

export async function POST(request: Request) {
  try {
    const body = await readRDPBody(request);
    if (Object.keys(body).length !== 1) throw new RDPError("INVALID_REQUEST", 400);
    const connection = await redeemRDPLaunch(body.token);
    return Response.json({ version: 1, relay: connection.relay, ticket: connection.ticket, expires_at: connection.expiresAt }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return rdpError(error); }
}
