// POST /api/chat — the only place your Claude API key is ever used.
// It runs on Vercel's servers, so the key never reaches anyone's browser.
import { checkMfa } from "./_mfa.js";
import { admin, getKids, flag, getConfig, searchesLeft, countSearches, record, getSub, getMemory, addMemory, setupProblem } from "./_admin.js";
import { makeChatHandler } from "./_core.js";

// Credits live in Firestore under usage/{uid}: today's count (day/used) and this month's (mkey/mused).
// Browsers can read their own, but only this server can change them.
async function charge(uid, cost, limits, day) {
  const { db } = await admin();
  const userRef = db.doc(`usage/${uid}`), siteRef = db.doc("usage/_site");
  return db.runTransaction(async (tx) => {
    const [u, s] = await Promise.all([tx.get(userRef), tx.get(siteRef)]);
    const used = u.exists && u.get("day") === day ? u.get("used") || 0 : 0;
    const mused = u.exists && u.get("mkey") === limits.monthKey ? u.get("mused") || 0 : 0;
    const siteUsed = s.exists && s.get("day") === day ? s.get("used") || 0 : 0;
    const left = Math.max(0, Math.min(limits.perUser - used, limits.month - mused));
    if (used + cost > limits.perUser) return { ok: false, reason: "limit_reached", left };
    if (mused + cost > limits.month) return { ok: false, reason: "month_limit", left };
    if (siteUsed + cost > limits.site) return { ok: false, reason: "site_busy", left };
    tx.set(userRef, { day, used: used + cost, limit: limits.perUser, mkey: limits.monthKey || null, mused: mused + cost });
    tx.set(siteRef, { day, used: siteUsed + cost, limit: limits.site });
    return { ok: true, left: left - cost };
  });
}

async function refund(uid, cost, day, monthKey) {
  const { db } = await admin();
  const userRef = db.doc(`usage/${uid}`), siteRef = db.doc("usage/_site");
  await db.runTransaction(async (tx) => {
    const [u, s] = await Promise.all([tx.get(userRef), tx.get(siteRef)]);
    if (u.exists) {
      const upd = {};
      if (u.get("day") === day) upd.used = Math.max(0, (u.get("used") || 0) - cost);
      if (monthKey && u.get("mkey") === monthKey) upd.mused = Math.max(0, (u.get("mused") || 0) - cost);
      if (Object.keys(upd).length) tx.update(userRef, upd);
    }
    if (s.exists && s.get("day") === day) tx.update(siteRef, { used: Math.max(0, (s.get("used") || 0) - cost) });
  });
}

const handler = makeChatHandler({
  verifyToken: async (token) => {
    let a;
    try { a = await admin(); } catch (e) { const err = new Error("setup"); err.setup = setupProblem(e); throw err; }
    return checkMfa(await a.auth.verifyIdToken(token));
  },
  charge,
  refund,
  getKids,
  flag,
  getConfig,
  searchesLeft,
  countSearches,
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
