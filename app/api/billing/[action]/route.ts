import { manageBilling, BILLING_ACTIONS, type BillingAction } from "@/lib/billing/manage";
import { BillingError } from "@/lib/billing/lock";
import { siteURL } from "@/lib/billing/stripe";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    if (request.headers.get("origin") !== siteURL()) return Response.json({ error: "Forbidden" }, { status: 403 });
    const { action } = await params;
    if (!BILLING_ACTIONS.includes(action)) return Response.json({ error: "Invalid billing action" }, { status: 404 });
    const text = await request.text();
    if (text.length > 2048) return Response.json({ error: "Request too large" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body) || !("organizationId" in body) || typeof body.organizationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.organizationId) || Object.keys(body).some((k) => !["organizationId", "plan"].includes(k))) return Response.json({ error: "Invalid billing request" }, { status: 400 });
    const result = await manageBilling(body.organizationId, action as BillingAction, "plan" in body ? body.plan : undefined);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BillingError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.message === "Organization permission denied") return Response.json({ error: "Only the organization owner can manage billing." }, { status: 403 });
    console.error("Billing request failed", error);
    return Response.json({ error: "Billing request failed. Refresh before retrying; Stripe may already have accepted the request." }, { status: 503 });
  }
}
