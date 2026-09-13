import { NextResponse } from "next/server";

import { createEnrollmentToken } from "@/lib/agent/enrollment";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const organizationId = body.organizationId as string | undefined;
    const clientId = body.clientId as string | undefined;
    const siteId = body.siteId as string | null | undefined;
    if (!organizationId || !clientId) {
      return NextResponse.json({ error: "Organization and client are required." }, { status: 400 });
    }

    return NextResponse.json(await createEnrollmentToken({ organizationId, clientId, siteId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    switch (message) {
      case "UNAUTHORIZED": return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      case "FORBIDDEN": return NextResponse.json({ error: "You do not have permission to enroll devices." }, { status: 403 });
      case "SUBSCRIPTION_RESTRICTED": return NextResponse.json({ error: "Your subscription requires attention before devices can be enrolled." }, { status: 403 });
      case "LIMIT_REACHED": return NextResponse.json({ error: "Device limit reached. Upgrade your plan to enroll more devices." }, { status: 409 });
      case "ORGANIZATION_NOT_FOUND": return NextResponse.json({ error: "Organization not found." }, { status: 404 });
      case "CLIENT_NOT_FOUND": return NextResponse.json({ error: "Client not found." }, { status: 404 });
      case "SITE_NOT_FOUND": return NextResponse.json({ error: "Site not found." }, { status: 404 });
      default:
        console.error("Enrollment API error:", error);
        return NextResponse.json({ error: "Could not generate enrollment token." }, { status: 500 });
    }
  }
}
