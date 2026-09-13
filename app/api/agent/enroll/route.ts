import { NextResponse } from "next/server";

import { enrollAgent } from "@/lib/agent/device-enrollment";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = body.token as string | undefined;
    const hostname = body.hostname as string | undefined;
    const os = body.os as string | undefined;
    const arch = body.arch as string | null | undefined;
    const localIp = body.local_ip as string | null | undefined;
    const macAddress = body.mac_address as string | null | undefined;
    const capabilities = body.capabilities as Record<string, unknown> | null | undefined;
    if (!token || !hostname || !os) {
      return NextResponse.json({ error: "Invalid enrollment request." }, { status: 400 });
    }
    const result = await enrollAgent({ token, hostname, os, arch, localIp, macAddress, capabilities });
    return NextResponse.json({ device_id: result.deviceId, agent_id: result.agentId, agent_token: result.agentToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    switch (message) {
      case "INVALID_TOKEN": return NextResponse.json({ error: "Invalid enrollment token." }, { status: 401 });
      case "TOKEN_REVOKED": return NextResponse.json({ error: "Enrollment token has been revoked." }, { status: 401 });
      case "TOKEN_ALREADY_USED": return NextResponse.json({ error: "Enrollment token has already been used." }, { status: 401 });
      case "TOKEN_EXPIRED": return NextResponse.json({ error: "Enrollment token has expired." }, { status: 401 });
      case "TOKEN_UNAVAILABLE": return NextResponse.json({ error: "Enrollment token is no longer available." }, { status: 409 });
      case "FORBIDDEN": return NextResponse.json({ error: "The enrollment token no longer has permission to create devices." }, { status: 403 });
      case "SUBSCRIPTION_RESTRICTED": return NextResponse.json({ error: "This organization subscription requires attention before devices can be enrolled." }, { status: 403 });
      case "LIMIT_REACHED": return NextResponse.json({ error: "This organization has reached its device limit." }, { status: 409 });
      case "DEVICE_CREATION_FAILED": return NextResponse.json({ error: "Could not create device." }, { status: 500 });
      default:
        console.error("Agent enrollment API error:", error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
  }
}
