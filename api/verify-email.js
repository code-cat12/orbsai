// POST /api/verify-email — sends the Orbs-branded "confirm your email" message (through Brevo).
import { admin, mailRate, setupProblem } from "./_admin.js";
import { makeVerifyMailHandler, brevoSender } from "./_mail.js";

const handler = makeVerifyMailHandler({
  verifyToken: async (t) => {
    let a;
    try { a = await admin(); } catch (e) { const err = new Error("setup"); err.setup = setupProblem(e); throw err; }
    return a.auth.verifyIdToken(t);
  },
  genLink: async (email, settings) => (await admin()).auth.generateEmailVerificationLink(email, settings),
  send: brevoSender(process.env.BREVO_API_KEY || ""),
  mailRate,
});

export async function POST(request) {
  try { return await handler(request); }
  catch (e) {
    console.error("verify-email error", e && e.message);
    return new Response(JSON.stringify({ error: "send_failed" }), { status: 502, headers: { "content-type": "application/json" } });
  }
}
