// Paid plans (Stripe) and what each one gets. Free uses the admin panel / Vercel numbers.
import { creditLimits, isAdmin, ADMIN_CREDITS, dayKey } from "./_limits.js";

export const PLANS = {
  plus:         { name: "Plus",           daily: 140, week: 800,  searches: 10, models: [0, 1, 2] },
  plusplus:     { name: "Plus Plus",      daily: 255, week: 1400, searches: 25, models: [0, 1, 2, 3], memory: true },
  plusplusplus: { name: "Plus Plus Plus", daily: 625, week: 3200, searches: 50, models: [0, 1, 2, 3], memory: true },
};
export const PLAN_ORDER = ["plus", "plusplus", "plusplusplus"];
export const FREE_MODELS = [0, 1];       // Koa and Lumina
export const FREE_WEEK_DAYS = 5;         // free weekly cap = 5 days' worth (50 a day -> 250 a week), resets Monday like paid plans
export const ADMIN_WEEK = 99999999;      // the owner's weekly limit (so the weekly bar shows)

// The Monday (New York time) that starts this week, e.g. "2026-10-05". Weekly credits come back then.
export function weekKey(now = Date.now()) {
  const d = new Date(dayKey(new Date(now)) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Stripe price IDs (test mode / sandbox, fake money)
const TEST_PRICES = {
  plus:         { month: "price_1UMHB5BgLtESXgVqKX3K50fS", year: "price_1UMHBhBgLtESXgVqgPx2yb4J" },
  plusplus:     { month: "price_1UMHCEBgLtESXgVqqvWCkRoU", year: "price_1UMHCQBgLtESXgVqTK0Y4h5D" },
  plusplusplus: { month: "price_1UMHD5BgLtESXgVqFEqxfIOw", year: "price_1UMHDGBgLtESXgVqUyguTI4d" },
};
// Stripe price IDs (live mode, real money)
const LIVE_PRICES = {
  plus:         { month: "price_1UMG4yBgLtESXgVqv4tq72lR", year: "price_1UMGN3BgLtESXgVq1zl7jlu9" },
  plusplus:     { month: "price_1UMGNVBgLtESXgVq2JZHZ1BF", year: "price_1UMGNxBgLtESXgVqMCL1KrBJ" },
  plusplusplus: { month: "price_1UMGObBgLtESXgVqfXAkQ2Ri", year: "price_1UMGPOBgLtESXgVqfMv254Ot" },
};
// Uses the live prices with a live key (sk_live_…) and the test prices with a test key (sk_test_…).
// STRIPE_PRICES in Vercel can override both if the prices ever change.
export function prices(env = {}) {
  try { if (env.STRIPE_PRICES) { const p = JSON.parse(env.STRIPE_PRICES); if (p && p.plus) return p; } } catch {}
  return /^(sk|rk)_live_/.test(String(env.STRIPE_SECRET_KEY || "")) ? LIVE_PRICES : TEST_PRICES;
}
export function priceToPlan(id, env) {
  const p = prices(env);
  for (const plan of PLAN_ORDER) for (const interval of ["month", "year"]) if (p[plan] && p[plan][interval] === id) return { plan, interval };
  return null;
}

// A subscription counts while it's active (a failed renewal gets a few days of grace while Stripe retries)
const LIVE = new Set(["active", "trialing", "past_due"]);
export function activePlan(sub, now = Date.now(), env = process.env) {
  if (!sub || !LIVE.has(sub.status) || !PLANS[sub.plan]) return null;
  // A plan bought in the sandbox doesn't count on the live site (and the other way round)
  if (sub.price && !priceToPlan(sub.price, env)) return null;
  if (sub.periodEnd && now > sub.periodEnd * 1000 + 3 * 864e5) return null;
  return sub.plan;
}
// The cheapest plan that unlocks a model
export function planFor(model) { return PLAN_ORDER.find((p) => PLANS[p].models.includes(model)) || "plusplus"; }

// Everything one person is allowed: credits per day and per week (free and paid), web searches, models.
// perUser/month of 0 = unlimited. "month" and "monthKey" hold the longer cap whatever its period is ("week" for paid plans, "month" for free).
// The owner can pretend to be on any plan to test it ("viewAs": free, plus, plusplus, plusplusplus; "owner" = normal)
export const VIEW_AS = ["owner", "free", "plus", "plusplus", "plusplusplus"];
export function testSub(viewAs) {
  return PLANS[viewAs] ? { plan: viewAs, interval: "month", status: "active", periodStart: "test-" + viewAs, periodEnd: null, test: true } : null;
}
export function allowance({ sub, cfg, env, user, now = Date.now(), viewAs = null }) {
  let admin = isAdmin(user, env);
  if (admin && viewAs && viewAs !== "owner" && VIEW_AS.includes(viewAs)) { admin = false; sub = testSub(viewAs); }
  const plan = activePlan(sub, now);
  const free = creditLimits(cfg, env);
  let perUser, month, monthKey, period = "month", searches, models, memory = false;
  if (plan) {
    const p = PLANS[plan];
    perUser = p.daily; month = p.week; period = "week"; monthKey = "w" + weekKey(now) + (sub.test ? sub.periodStart : ""); searches = p.searches; models = p.models; memory = !!p.memory;
    // If free people have no credit limit right now, paying people shouldn't have one either
    if (!(free.perUser > 0)) { perUser = 0; month = 0; }
    // Paying people never get less than free people
    else if (free.perUser > perUser) { perUser = free.perUser; month = Math.max(month, free.perUser * FREE_WEEK_DAYS); }   // never less than free
  } else {
    perUser = free.perUser; month = perUser > 0 ? perUser * FREE_WEEK_DAYS : 0; period = "week"; monthKey = "w" + weekKey(now);
    searches = cfg && Number.isInteger(cfg.searchesPerUser) ? cfg.searchesPerUser : 5; models = FREE_MODELS;
  }
  // The owner gets everything: every model, 99,999 credits a day, 99,999,999 a week, and lots of web searches
  if (admin) { if (perUser > 0) perUser = Math.max(perUser, ADMIN_CREDITS); month = ADMIN_WEEK; period = "week"; monthKey = "w" + weekKey(now); models = [0, 1, 2, 3]; searches = Math.max(searches, 1000); memory = true; }
  return { admin, plan, perUser, month, monthKey, period, site: free.site, searches, models, memory };
}
// What's left today and this week/month (null when there's no limit)
export function creditsLeftFor(usageDoc, a, day = dayKey()) {
  if (!(a.perUser > 0)) return null;
  const used = usageDoc && usageDoc.day === day ? usageDoc.used || 0 : 0;
  const mused = usageDoc && usageDoc.mkey === a.monthKey ? usageDoc.mused || 0 : 0;
  const dayLeft = Math.max(0, a.perUser - used);
  const out = { limit: a.perUser, left: dayLeft };
  if (a.month > 0) { out.period = a.period || "month"; out.monthLimit = a.month; out.monthLeft = Math.max(0, a.month - mused); out.left = Math.min(dayLeft, out.monthLeft); }
  return out;
}
// The part of the subscription the page is allowed to see
export function publicPlan(sub, now = Date.now()) {
  const plan = activePlan(sub, now);
  if (!plan) return null;
  return { id: plan, name: PLANS[plan].name, interval: sub.interval || "month", status: sub.status, periodEnd: sub.periodEnd || null, cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd, test: !!sub.test };
}
