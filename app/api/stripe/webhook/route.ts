import { getStripe, requiredEnv } from "@/lib/billing/stripe";
import { processStripeEvent } from "@/lib/billing/webhook";
import type Stripe from "stripe";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let event: Stripe.Event;
  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature) return new Response("Missing Stripe signature", { status: 400 });
    const body = await request.text();
    event = getStripe().webhooks.constructEvent(body, signature, requiredEnv("STRIPE_WEBHOOK_SECRET"));
  } catch (error) {
    console.error("Stripe webhook signature/configuration rejected", error instanceof Error ? error.name : "Unknown error");
    return new Response("Webhook verification failed", { status: 400 });
  }
  try {
    await processStripeEvent(event);
    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", { eventId: event.id, error });
    return new Response("Retry webhook later", { status: 503 });
  }
}
