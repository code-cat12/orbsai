// POST /api/admin — the owner's admin panel. Only emails listed in ADMIN_EMAILS (on Vercel) get in.
import { checkMfa } from "./_mfa.js";
import { admin, getConfig, setConfig, setKids, setupProblem } from "./_admin.js";
import { makeAdminHandler } from "./_adminapi.js";
import { siteConfig, dayKey } from "./_core.js";
import { activePlan } from "./_plans.js";
import { budgets, DEFAULT_BUDGETS } from "./_limits.js";

const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : v instanceof Date ? v.getTime() : null);
const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

async function load() {
  const { db, auth } = await admin();
  const day = dayKey();
  const [stats, reports, flags, feedback, kidsSnap, searchSnap, cfg, subsSnap, siteSnap] = await Promise.all([
    db.collection("stats").orderBy("day", "desc").limit(30).get(),
    db.collection("reports").orderBy("at", "desc").limit(30).get(),
    db.collection("flags").orderBy("at", "desc").limit(30).get(),
    db.collection("feedback").orderBy("at", "desc").limit(300).get(),
    db.collection("kids").get(),
    db.doc("searches/_site").get(),
    getConfig(),
    db.collection("subs").get(),
    db.doc("usage/_site").get(),
  ]);
  // Paying people per plan
  const subs = {}, planOf = {};
  subsSnap.forEach((d) => { const p = activePlan(d.data()); if (p) { subs[p] = (subs[p] || 0) + 1; planOf[d.id] = p; } });
  const kids = {}; let teens = 0, kidsOn = 0, banned = 0;
  kidsSnap.forEach((d) => { const k = d.data() || {}; kids[d.id] = k; if (k.age === "teen") teens++; if (k.on || k.age === "teen") kidsOn++; if (k.banned) banned++; });

  // Everyone who signed up (up to 5,000 for the list)
  const users = []; let token;
  for (let i = 0; i < 5; i++) {
    const page = await auth.listUsers(1000, token);
    users.push(...page.users);
    token = page.pageToken; if (!token) break;
  }
  const week = Date.now() - 7 * 864e5;
  const newest = users.map((u) => ({
    uid: u.uid, email: u.email || "", name: u.displayName || "", created: Date.parse(u.metadata.creationTime) || 0,
    last: Date.parse(u.metadata.lastSignInTime || u.metadata.lastRefreshTime || "") || 0, disabled: !!u.disabled,
    age: kids[u.uid]?.age || null, banned: !!kids[u.uid]?.banned, plan: planOf[u.uid] || null,
  })).sort((a, b) => b.created - a.created);

  return {
    today: day,
    config: siteConfig(cfg),
    searchesToday: searchSnap.exists && searchSnap.get("day") === day ? searchSnap.get("used") || 0 : 0,
    stats: rows(stats).map((s) => ({ day: s.day, messages: s.messages || 0, cents: s.cents || 0, searches: s.searches || 0, input: s.input || 0, output: s.output || 0 })),
    // Usage budgets in effect (cents) and the built-in defaults, so the panel can show what an empty box means
    budgets: budgets(cfg, process.env), defaultBudgets: DEFAULT_BUDGETS, envBudgets: !!process.env.USAGE_BUDGETS,
    siteCentsToday: siteSnap.exists && siteSnap.get("day") === day ? siteSnap.get("dayCents") || 0 : 0,
    subs,
    users: { total: users.length, newWeek: newest.filter((u) => u.created > week).length, teens, kidsOn, banned, list: newest.slice(0, 40) },
    reports: rows(reports).map((r) => ({ ...r, at: ms(r.at) })),
    flags: rows(flags).map((f) => ({ ...f, at: ms(f.at) })),
    feedback: rows(feedback).map((f) => ({ ...f, at: ms(f.at) })),
  };
}

const handler = makeAdminHandler({
  verifyToken: async (t) => {
    let a;
    try { a = await admin(); } catch (e) { const err = new Error("setup"); err.setup = setupProblem(e); throw err; }
    return checkMfa(await a.auth.verifyIdToken(t));
  },
  load,
  saveSettings: setConfig,
  dismiss: async (kind, id) => { const { db } = await admin(); await db.doc(`${kind === "report" ? "reports" : kind === "flag" ? "flags" : "feedback"}/${id}`).delete(); },
  setViewAs: async (uid, plan) => { await setKids(uid, { viewAs: plan }); },
  setBanned: async (uid, on) => {
    const { auth } = await admin();
    await setKids(uid, { banned: on });
    await auth.updateUser(uid, { disabled: on });
    if (on) await auth.revokeRefreshTokens(uid);
  },
});

export async function POST(request) {
  try { return await handler(request); }
  catch (e) {
    console.error("admin error", e);
    return new Response(JSON.stringify({ error: "server_error", why: e.setup || setupProblem(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
