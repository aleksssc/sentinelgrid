import { NextResponse } from "next/server";
import { DiagnosticError, dnsLookup, httpCheck, reverseDns, sslInspect, subnetCalculate, whoisLookup } from "@/lib/diagnostics/cloud-tools";
import { getOrganizationContext } from "@/lib/organization-context";

const tools = ["dns", "http", "headers", "ssl", "whois", "reverse-dns", "subnet"] as const;
type Tool = (typeof tools)[number];

export async function POST(request: Request) {
  const { user, organization } = await getOrganizationContext();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!organization) return NextResponse.json({ error: "ORGANIZATION_REQUIRED" }, { status: 403 });

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DiagnosticError("Invalid diagnostic request.");
    const { tool, target } = body as Record<string, unknown>;
    if (!tools.includes(tool as Tool) || typeof target !== "string" || target.length > 2_048) throw new DiagnosticError("Invalid diagnostic request.");
    const result = await ({
      dns: () => dnsLookup(target),
      http: () => httpCheck(target),
      headers: () => httpCheck(target, true),
      ssl: () => sslInspect(target),
      whois: () => whoisLookup(target),
      "reverse-dns": () => reverseDns(target),
      subnet: () => Promise.resolve(subnetCalculate(target)),
    } satisfies Record<Tool, () => Promise<unknown>>)[tool as Tool]();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof DiagnosticError)) console.error("Cloud diagnostic failed:", error);
    return NextResponse.json({ error: error instanceof DiagnosticError ? error.message : "The diagnostic could not be completed." }, { status: error instanceof DiagnosticError ? 400 : 502, headers: { "Cache-Control": "no-store" } });
  }
}
