// Paid plans (Stripe) and what each one gets. Usage budgets live in _limits.js (admin panel / Vercel can change them).
import { budgets, isAdmin, dayKey, weekKey } from "./_limits.js";
export { weekKey };

// "more" = how much usage compared to free (just for the page copy; the real numbers are the budgets)
export const PLANS = {
  plus:         { name: "Plus",           searches: 10 },
  plusplus:     { name: "Plus Plus",      searches: 25, memory: true },
  plusplusplus: { name: "Plus Plus Plus", searches: 50, memory: true },
};
export const PLAN_ORDER = ["plus", "plusplus", "plusplusplus"];

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
// Everything one person is allowed: daily and weekly usage budgets (in cents), web searches, memory.
// A budget of 0 = unlimited. The owner can pretend to be on any plan to test it ("viewAs": free, plus, plusplus, plusplusplus; "owner" = normal)
export const VIEW_AS = ["owner", "free", "plus", "plusplus", "plusplusplus"];
export function testSub(viewAs) {
  return PLANS[viewAs] ? { plan: viewAs, interval: "month", status: "active", periodStart: "test-" + viewAs, periodEnd: null, test: true } : null;
}
export function allowance({ sub, cfg, env, user, now = Date.now(), viewAs = null }) {
  let admin = isAdmin(user, env), testing = null;
  if (admin && viewAs && viewAs !== "owner" && VIEW_AS.includes(viewAs)) { admin = false; testing = viewAs; sub = testSub(viewAs); }
  const plan = activePlan(sub, now);
  const b = budgets(cfg, env);
  const tier = plan || "free";
  let day = b[tier].day, week = b[tier].week, searches, memory = false;
  if (plan) { searches = PLANS[plan].searches; memory = !!PLANS[plan].memory; }
  else searches = cfg && Number.isInteger(cfg.searchesPerUser) ? cfg.searchesPerUser : 5;
  // Paying people never get less than free people
  if (plan) { if (b.free.day === 0 || (day > 0 && b.free.day > day)) day = b.free.day; if (b.free.week === 0 || (week > 0 && b.free.week > week)) week = b.free.week; }
  // The owner is effectively unlimited (still counted, so the admin panel's spending numbers stay right)
  if (admin) { day = 0; week = 0; searches = Math.max(searches, 1000); memory = true; }
  // Testing a plan uses its own counters so it doesn't mix with the owner's real usage
  const tag = testing ? ":test-" + testing : "";
  return { admin, plan, tier, day, week, site: b.site, searches, memory, dayKey: dayKey(new Date(now)) + tag, weekKey: "w" + weekKey(now) + tag };
}
// The part of the subscription the page is allowed to see
export function publicPlan(sub, now = Date.now()) {
  const plan = activePlan(sub, now);
  if (!plan) return null;
  return { id: plan, name: PLANS[plan].name, interval: sub.interval || "month", status: sub.status, periodEnd: sub.periodEnd || null, cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd, test: !!sub.test };
}
