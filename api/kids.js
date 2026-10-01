// POST /api/kids — age question and Kids Mode on/off (with parent PIN).
import { admin, getKids, setKids, setupProblem } from "./_admin.js";
import { makeKidsHandler } from "./_kids.js";

const handler = makeKidsHandler({
  verifyToken: async (t) => {
    let a;
    try { a = await admin(); } catch (e) { const err = new Error("setup"); err.setup = setupProblem(e); throw err; }
    return a.auth.verifyIdToken(t);
  },
  getKids,
  setKids,
});

export async function POST(request) {
  try { return await handler(request); }
  catch (e) {
    console.error("kids error", e);
    return new Response(JSON.stringify({ error: "server_error", why: e.setup || setupProblem(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
