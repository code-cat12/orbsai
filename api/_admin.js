// Firebase Admin (server-only). Shared by the API files.
// Firebase's server tools are loaded only when needed, so if they fail to load
// the site can still say why instead of crashing.
let mods = null;
async function loadFirebase() {
  if (mods) return mods;
  try {
    const [app, auth, fs] = await Promise.all([import("firebase-admin/app"), import("firebase-admin/auth"), import("firebase-admin/firestore")]);
    mods = { ...app, ...auth, ...fs };
    return mods;
  } catch (e) {
    const err = new Error("firebase-admin could not load: " + String(e && e.message || e).slice(0, 160));
    err.loadFail = true;
    throw err;
  }
}

// Turns setup mistakes into a short, safe reason the page can show (never secrets).
export function setupProblem(e) {
  const msg = String((e && (e.message || e.details)) || e || "");
  const code = e && e.code;
  if (e && e.loadFail) return msg;
  if (/FIREBASE_SERVICE_ACCOUNT is missing/.test(msg)) return "FIREBASE_SERVICE_ACCOUNT isn't set in Vercel";
  if (/not valid JSON|Unexpected token|JSON/.test(msg)) return "FIREBASE_SERVICE_ACCOUNT isn't the whole .json file";
  if (/private key|PEM|DECODER|asn1/i.test(msg)) return "the Firebase private key got cut off or changed";
  if (code === 5 || /NOT_FOUND/.test(msg)) return "the Firestore database isn't created yet";
  if (code === 7 || /PERMISSION_DENIED/.test(msg)) return "the service account isn't allowed to use Firestore (or the Firestore API is off)";
  if (/project/i.test(msg) && /mismatch|audience|aud/i.test(msg)) return "the service account is from a different Firebase project";
  return "server error";
}

export async function admin() {
  const { initializeApp, cert, getApps, getAuth, getFirestore } = await loadFirebase();
  if (!getApps().length) {
    const env = process.env;
    let sa;
    if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
      // Option B: three one-line values copied out of the .json file
      sa = { project_id: env.FIREBASE_PROJECT_ID.trim(), client_email: env.FIREBASE_CLIENT_EMAIL.trim(),
             private_key: env.FIREBASE_PRIVATE_KEY.trim().replace(/^"|"$/g, "") };
    } else {
      // Option A: the whole .json file in FIREBASE_SERVICE_ACCOUNT
      if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
      try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT.trim()); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON"); }
    }
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    initializeApp({ credential: cert(sa) });
  }
  return { auth: getAuth(), db: getFirestore() };
}

// Kids Mode settings live in kids/{uid}. Only the server can change them (see firestore.rules).
export async function getKids(uid) {
  const snap = await (await admin()).db.doc(`kids/${uid}`).get();
  return snap.exists ? snap.data() : null;
}
export async function setKids(uid, data) {
  await (await admin()).db.doc(`kids/${uid}`).set(data, { merge: true });
}
// Safety log for the site owner: what kind of thing was blocked, never the message itself.
export async function flag(uid, info) {
  await (await admin()).db.collection("flags").add({ uid, ...info, at: new Date() });
}

// ---------- Site switches (config/site), set from the admin panel ----------
let cfgCache = null;
export async function getConfig() {
  if (cfgCache && Date.now() - cfgCache.at < 30 * 1000) return cfgCache.data;
  const snap = await (await admin()).db.doc("config/site").get();
  const data = snap.exists ? snap.data() : null;
  cfgCache = { at: Date.now(), data };
  return data;
}
export async function setConfig(data) {
  await (await admin()).db.doc("config/site").set(data, { merge: true });
  cfgCache = null;
}

// ---------- Web search counters (searches/{uid} and searches/_site, server only) ----------
export async function searchesLeft(uid, day, cfg) {
  const { db } = await admin();
  const [u, s] = await Promise.all([db.doc(`searches/${uid}`).get(), db.doc("searches/_site").get()]);
  const used = u.exists && u.get("day") === day ? u.get("used") || 0 : 0;
  const siteUsed = s.exists && s.get("day") === day ? s.get("used") || 0 : 0;
  const left = Math.min(cfg.searchesPerUser - used, cfg.searchesSite - siteUsed);
  return Number.isFinite(left) ? Math.max(0, left) : 0;
}
export async function countSearches(uid, n, day) {
  const { db } = await admin();
  const refs = [db.doc(`searches/${uid}`), db.doc("searches/_site")];
  await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    snaps.forEach((snap, i) => {
      const used = snap.exists && snap.get("day") === day ? snap.get("used") || 0 : 0;
      tx.set(refs[i], { day, used: used + n });
    });
  });
}

// ---------- Spending stats per day (stats/{day}, server only) ----------
export async function record(day, u) {
  const { db } = await admin();
  const { FieldValue } = await loadFirebase();
  const inc = (v) => FieldValue.increment(Number.isFinite(v) ? v : 0);
  await db.doc(`stats/${day}`).set({
    day, messages: inc(1), input: inc(u.input), output: inc(u.output), cacheRead: inc(u.cacheRead), cacheWrite: inc(u.cacheWrite),
    searches: inc(u.searches), cents: inc(Math.round(u.cents * 1000) / 1000), ["m_" + u.family]: inc(1),
  }, { merge: true });
}

// ---------- Thumbs up / down (feedback/{id}) ----------
export async function saveFeedback(id, data) {
  const ref = (await admin()).db.doc(`feedback/${id}`);
  if (data === null) await ref.delete(); else await ref.set(data);
}

// What one person has used today and this week (usage/{uid}, in cents)
export async function getUsage(uid) {
  const snap = await (await admin()).db.doc(`usage/${uid}`).get();
  return snap.exists ? snap.data() : null;
}

// ---------- Memory (users/{uid}/data/memory) ----------
export async function getMemory(uid) {
  const { cleanItems } = await import("./_memory.js");
  const snap = await (await admin()).db.doc(`users/${uid}/data/memory`).get();
  return cleanItems(snap.exists ? snap.data() : null);
}
export async function addMemory(uid, texts) {
  const { cleanItems, MAX_ITEMS } = await import("./_memory.js");
  const { db } = await admin();
  const ref = db.doc(`users/${uid}/data/memory`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const items = cleanItems(snap.exists ? snap.data() : null);
    const have = new Set(items.map((m) => m.text.toLowerCase()));
    const added = texts.filter((t) => !have.has(t.toLowerCase())).map((t) => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text: t, at: Date.now() }));
    if (added.length) tx.set(ref, { items: [...items, ...added].slice(-MAX_ITEMS) });
    return added.map((a) => a.text);
  });
}

// ---------- Paid plans (subs/{uid}, written only by the Stripe webhook) ----------
export async function getSub(uid) {
  const snap = await (await admin()).db.doc(`subs/${uid}`).get();
  return snap.exists ? snap.data() : null;
}
export async function setSub(uid, data) {
  const { db } = await admin();
  await db.doc(`subs/${uid}`).set({ ...data, updated: Date.now() }, { merge: true });
  if (data.customer) await db.doc(`customers/${data.customer}`).set({ uid }, { merge: true });
}
export async function uidForCustomer(customerId) {
  const snap = await (await admin()).db.doc(`customers/${customerId}`).get();
  return snap.exists ? snap.get("uid") : null;
}

// Pretty verify emails: at most 1 a minute and 5 a day per person (stops spam)
export async function mailRate(uid, now = Date.now()) {
  const { db } = await admin(); const ref = db.doc(`mail/${uid}`);
  return db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() || {}; const day = new Date(now).toISOString().slice(0, 10);
    const n = d.day === day ? (d.n || 0) : 0;
    if (n >= 5 || (d.last && now - d.last < 60000)) return false;
    tx.set(ref, { day, n: n + 1, last: now }); return true;
  });
}

// Two-step sign-in settings live in mfa/{uid} (server only)
export async function getMfa(uid) {
  const snap = await (await admin()).db.doc(`mfa/${uid}`).get();
  return snap.exists ? snap.data() : null;
}
export async function setMfa(uid, data) { await (await admin()).db.doc(`mfa/${uid}`).set(data); }
export async function getClaims(uid) { return (await (await admin()).auth.getUser(uid)).customClaims || {}; }
export async function setClaims(uid, claims) { await (await admin()).auth.setCustomUserClaims(uid, claims); }
