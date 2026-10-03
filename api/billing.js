// POST /api/billing — start a Stripe checkout for a plan, or open the "manage subscription" page.
import { checkMfa } from "./_mfa.js";
import { admin, getSub, getKids, setupProblem } from "./_admin.js";
import { makeBillingHandler, stripeClient } from "./_billing.js";

const handler = makeBillingHandler({
  verifyToken: async (t) => {
    let a;
    try { a = await admin(); } catch (e) { const err = new Error("setup"); err.setup = setupProblem(e); throw err; }
    return checkMfa(await a.auth.verifyIdToken(t));
  },
  getSub,
  getKids,
  stripe: stripeClient(process.env.STRIPE_SECRET_KEY || ""),
});

export async function POST(request) {
  try { return await handler(request); }
  catch (e) {
    console.error("billing error", e);
    return new Response(JSON.stringify({ error: e.stripe ? "stripe_error" : "server_error", why: e.setup || (e.stripe ? e.message : setupProblem(e)) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
