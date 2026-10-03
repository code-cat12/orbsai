// POST /api/mfa — two-step sign-in: set up, check codes, turn off.
import { admin, getMfa, setMfa, getClaims, setClaims, setupProblem } from "./_admin.js";
import { makeMfaHandler } from "./_mfa.js";
import { brevoSender, codeEmail } from "./_mail.js";

const send = brevoSender(process.env.BREVO_API_KEY || "");
const origin = () => (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "https://orbsai.app");

const handler = makeMfaHandler({
  verifyToken: async (t) => {
    let a;
    try { a = await admin(); } catch (e) { const err = new Error("setup"); err.setup = setupProblem(e); throw err; }
    return a.auth.verifyIdToken(t); // no MFA check here: this is where you pass it
  },
  getMfa, setMfa, getClaims, setClaims,
  sendCode: (email, code) => send({ to: email, ...codeEmail({ code, origin: origin() }), from: process.env.MAIL_FROM || undefined, tag: "mfa" }),
});

export async function POST(request) {
  try { return await handler(request); }
  catch (e) {
    console.error("mfa error", e && e.message);
    return new Response(JSON.stringify({ error: "server_error", why: e.setup || setupProblem(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
