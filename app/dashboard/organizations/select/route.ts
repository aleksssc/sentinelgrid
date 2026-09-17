import { cookies } from "next/headers";
import { getOrganizationAccess } from "@/lib/organization-access";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("Forbidden", { status: 403 });
  const data = await request.formData();
  const id = String(data.get("organizationId") ?? "");
  if (!/^[a-f0-9-]{36}$/i.test(id) || !await getOrganizationAccess(id)) return new Response("Forbidden", { status: 403 });
  (await cookies()).set("sentinelgrid-organization", id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
  return NextResponse.redirect(new URL("/dashboard", request.url), 303);
}
