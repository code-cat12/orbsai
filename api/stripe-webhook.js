// POST /api/stripe-webhook — Stripe calls this when someone subscribes, renews, switches plans, or cancels.
// Checked with STRIPE_WEBHOOK_SECRET so nobody else can fake it.
import { setSub, uidForCustomer } from "./_admin.js";
import { makeWebhookHandler, stripeClient } from "./_billing.js";

const handler = makeWebhookHandler({ stripe: stripeClient(process.env.STRIPE_SECRET_KEY || ""), setSub, uidForCustomer });

export async function POST(request) {
  try { return await handler(request); }
  catch (e) {
    console.error("stripe webhook error", e);
    // A 500 makes Stripe try again later, which is what we want if something hiccuped
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
