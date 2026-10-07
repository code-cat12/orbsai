// POST /api/chat — the only place your Claude API key is ever used.
// It runs on Vercel's servers, so the key never reaches anyone's browser.
import { checkMfa } from "./_mfa.js";
import { admin, getKids, flag, getConfig, getUsage, searchesLeft, countSearches, takePics, record, getSub, getMemory, addMemory, setupProblem } from "./_admin.js";
import { makeChatHandler } from "./_core.js";

// Usage lives in Firestore under usage/{uid}: what today's messages really cost (day/dayCents) and this week's (wkey/weekCents),
// in cents. Browsers can read their own, but only this server can change it. usage/_site adds up everyone's for today.
async function bill(uid, cents, limits) {
  const { db } = await admin();
  const add = Number.isFinite(cents) && cents > 0 ? Math.round(cents * 1000) / 1000 : 0;
  const userRef = db.doc(`usage/${uid}`), siteRef = db.doc("usage/_site");
  return db.runTransaction(async (tx) => {
    const [u, s] = await Promise.all([tx.get(userRef), tx.get(siteRef)]);
    const d = u.exists ? u.data() : {};
    const dayCents = (d.day === limits.dayKey ? Number(d.dayCents) || 0 : 0) + add;
    const weekCents = (d.wkey === limits.weekKey ? Number(d.weekCents) || 0 : 0) + add;
    const siteCents = (s.exists && s.get("day") === limits.day ? Number(s.get("dayCents")) || 0 : 0) + add;
    const next = { day: limits.dayKey, dayCents, wkey: limits.weekKey, weekCents, updated: Date.now() };
    tx.set(userRef, next);
    tx.set(siteRef, { day: limits.day, dayCents: siteCents });
    return next;
  });
}
async function siteUsed(day) {
  const { db } = await admin();
  const s = await db.doc("usage/_site").get();
  return s.exists && s.get("day") === day ? Number(s.get("dayCents")) || 0 : 0;
}

const handler = makeChatHandler({
  verifyToken: async (token) => {
    let a;
    try { a = await admin(); } catch (e) { const err = new Error("setup"); err.setup = setupProblem(e); throw err; }
    return checkMfa(await a.auth.verifyIdToken(token));
  },
  getUsage,
  bill,
  siteUsed,
  getKids,
  flag,
  getConfig,
  searchesLeft,
  countSearches,
  takePics,
  record,
  getSub,
  getMemory,
  addMemory,
});

export async function POST(request) {
  try { return await handler(request); }
  catch (e) {
    console.error("chat error", e);
    return new Response(JSON.stringify({ error: "server_error", why: e.setup || setupProblem(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
