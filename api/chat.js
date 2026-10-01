// POST /api/chat — the only place your Claude API key is ever used.
// It runs on Vercel's servers, so the key never reaches anyone's browser.
import { admin, getKids, flag } from "./_admin.js";
import { makeChatHandler } from "./_core.js";

// Daily credits live in Firestore under usage/{uid}. Browsers can read their own, but only this server can change them.
async function charge(uid, cost, limits, day) {
  const { db } = admin();
  const userRef = db.doc(`usage/${uid}`), siteRef = db.doc("usage/_site");
  return db.runTransaction(async (tx) => {
    const [u, s] = await Promise.all([tx.get(userRef), tx.get(siteRef)]);
    const used = u.exists && u.get("day") === day ? u.get("used") || 0 : 0;
    const siteUsed = s.exists && s.get("day") === day ? s.get("used") || 0 : 0;
    const left = Math.max(0, limits.perUser - used);
    if (used + cost > limits.perUser) return { ok: false, reason: "limit_reached", left };
    if (siteUsed + cost > limits.site) return { ok: false, reason: "site_busy", left };
    tx.set(userRef, { day, used: used + cost, limit: limits.perUser });
    tx.set(siteRef, { day, used: siteUsed + cost, limit: limits.site });
    return { ok: true, left: left - cost };
  });
}

async function refund(uid, cost, day) {
  const { db } = admin();
  const userRef = db.doc(`usage/${uid}`), siteRef = db.doc("usage/_site");
  await db.runTransaction(async (tx) => {
    const [u, s] = await Promise.all([tx.get(userRef), tx.get(siteRef)]);
    if (u.exists && u.get("day") === day) tx.update(userRef, { used: Math.max(0, (u.get("used") || 0) - cost) });
    if (s.exists && s.get("day") === day) tx.update(siteRef, { used: Math.max(0, (s.get("used") || 0) - cost) });
  });
}

export const POST = makeChatHandler({
  verifyToken: (token) => admin().auth.verifyIdToken(token),
  charge,
  refund,
  getKids,
  flag,
});
