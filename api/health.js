// GET /api/health — a setup checklist. Shows only yes/no style answers, never secrets.
import { admin, setupProblem } from "./_admin.js";

export async function GET() {
  const out = {
    claudeKey: process.env.ANTHROPIC_API_KEY ? "set" : "missing",
    firebaseKeyVariables: process.env.FIREBASE_PRIVATE_KEY ? "three-variable mode" : process.env.FIREBASE_SERVICE_ACCOUNT ? "FIREBASE_SERVICE_ACCOUNT is set" : "missing",
    node: process.version,
    stripeKey: !process.env.STRIPE_SECRET_KEY ? "missing" : /^sk_test_|^rk_test_/.test(process.env.STRIPE_SECRET_KEY) ? "test mode" : "live mode",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? "set" : "missing",
  };
  try {
    const { db } = await admin();
    out.firebaseConnect = "ok";
    try { await db.doc("health/check").get(); out.firestore = "ok"; }
    catch (e) { out.firestore = setupProblem(e); }
  } catch (e) { out.firebaseConnect = setupProblem(e); }
  return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
