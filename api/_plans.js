// Paid plans (Stripe) and what each one gets. Free uses the admin panel / Vercel numbers.
import { creditLimits, isAdmin, ADMIN_CREDITS, dayKey } from "./_limits.js";

export const PLANS = {
  plus:         { name: "Plus",           daily: 100, month: 2000,  searches: 10, models: [0, 1, 2] },
  plusplus:     { name: "Plus Plus",      daily: 200, month: 4000,  searches: 25, models: [0, 1, 2, 3] },
  plusplusplus: { name: "Plus Plus Plus", daily: 500, month: 10000, searches: 50, models: [0, 1, 2, 3] },
};
export const PLAN_ORDER = ["plus", "plusplus", "plusplusplus"];
export const FREE_MODELS = [0, 1];       // Koa and Lumina
export const FREE_MONTH_DAYS = 20;       // free monthly cap = 20 days' worth

// Stripe price IDs (test mode). For live mode, set STRIPE_PRICES in Vercel to the same shape with live IDs.
const TEST_PRICES = {
  plus:         { month: "price_1UMHB5BgLtESXgVqKX3K50fS", year: "price_1UMHBhBgLtESXgVqgPx2yb4J" },
  plusplus:     { month: "price_1UMHCEBgLtESXgVqqvWCkRoU", year: "price_1UMHCQBgLtESXgVqTK0Y4h5D" },
  plusplusplus: { month: "price_1UMHD5BgLtESXgVqFEqxfIOw", year: "price_1UMHDGBgLtESXgVqUyguTI4d" },
};
export function prices(env = {}) {
  try { if (env.STRIPE_PRICES) { const p = JSON.parse(env.STRIPE_PRICES); if (p && p.plus) return p; } } catch {}
  return TEST_PRICES;
}
export function priceToPlan(id, env) {
  const p = prices(env);
  for (const plan of PLAN_ORDER) for (const interval of ["month", "year"]) if (p[plan] && p[plan][interval] === id) return { plan, interval };
  return null;
}

// A subscription counts while it's active (a failed renewal gets a few days of grace while Stripe retries)
const LIVE = new Set(["active", "trialing", "past_due"]);
export function activePlan(sub, now = Date.now()) {
  if (!sub || !LIVE.has(sub.status) || !PLANS[sub.plan]) return null;
  if (sub.periodEnd && now > sub.periodEnd * 1000 + 3 * 864e5) return null;
  return sub.plan;
}
// The cheapest plan that unlocks a model
export function planFor(model) { return PLAN_ORDER.find((p) => PLANS[p].models.includes(model)) || "plusplus"; }

// Everything one person is allowed: credits per day and month, web searches, models.
// perUser/month of 0 = unlimited.
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
  let perUser, month, monthKey, searches, models;
  if (plan) {
    const p = PLANS[plan];
    perUser = p.daily; month = p.month; monthKey = "p" + (sub.periodStart || 0); searches = p.searches; models = p.models;
    // If free people have no credit limit right now, paying people shouldn't have one either
    if (!(free.perUser > 0)) { perUser = 0; month = 0; }
    // Paying people never get less than free people
    else if (free.perUser > perUser) { perUser = free.perUser; month = Math.max(month, free.perUser * FREE_MONTH_DAYS); }
  } else {
    perUser = free.perUser; month = perUser > 0 ? perUser * FREE_MONTH_DAYS : 0; monthKey = "m" + dayKey(new Date(now)).slice(0, 7);
    searches = cfg && Number.isInteger(cfg.searchesPerUser) ? cfg.searchesPerUser : 5; models = FREE_MODELS;
  }
  // The owner gets everything: every model, 99,999 credits a day, no monthly cap, and lots of web searches
  if (admin) { if (perUser > 0) perUser = Math.max(perUser, ADMIN_CREDITS); month = 0; models = [0, 1, 2, 3]; searches = Math.max(searches, 1000); }
  return { admin, plan, perUser, month, monthKey, site: free.site, searches, models };
}
// What's left today and this month (null when there's no limit)
export function creditsLeftFor(usageDoc, a, day = dayKey()) {
  if (!(a.perUser > 0)) return null;
  const used = usageDoc && usageDoc.day === day ? usageDoc.used || 0 : 0;
  const mused = usageDoc && usageDoc.mkey === a.monthKey ? usageDoc.mused || 0 : 0;
  const dayLeft = Math.max(0, a.perUser - used);
  const out = { limit: a.perUser, left: dayLeft };
  if (a.month > 0) { out.monthLimit = a.month; out.monthLeft = Math.max(0, a.month - mused); out.left = Math.min(dayLeft, out.monthLeft); }
  return out;
}
// The part of the subscription the page is allowed to see
export function publicPlan(sub, now = Date.now()) {
  const plan = activePlan(sub, now);
  if (!plan) return null;
  return { id: plan, name: PLANS[plan].name, interval: sub.interval || "month", status: sub.status, periodEnd: sub.periodEnd || null, cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd, test: !!sub.test };
}
