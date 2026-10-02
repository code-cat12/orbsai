// POST /api/feedback — thumbs up / down on a reply.
import { admin, saveFeedback, setupProblem } from "./_admin.js";
import { makeFeedbackHandler } from "./_adminapi.js";

const handler = makeFeedbackHandler({
  verifyToken: async (t) => {
    let a;
    try { a = await admin(); } catch (e) { const err = new Error("setup"); err.setup = setupProblem(e); throw err; }
    return a.auth.verifyIdToken(t);
  },
  saveFeedback,
});

export async function POST(request) {
  try { return await handler(request); }
  catch (e) {
    console.error("feedback error", e);
    return new Response(JSON.stringify({ error: "server_error", why: e.setup || setupProblem(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
