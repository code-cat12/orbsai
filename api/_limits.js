// Usage limits, shared by the chat and the account-status endpoints.
// Every message is measured in what it really cost (in US cents, from Claude's token counts).
// Each plan gets a daily and a weekly budget of cents. People only ever see a percentage, never money.
export const RESET_TZ = "America/New_York"; // the day resets at midnight New York time, the week on Monday at midnight
export function dayKey(now = new Date()) {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: RESET_TZ });
}
export function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// The Monday (New York time) that starts this week, e.g. "2026-10-05".
export function weekKey(now = Date.now()) {
  const d = new Date(dayKey(new Date(now)) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// How far New York is from UTC at a moment, in minutes (handles daylight saving time)
function nyOffset(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: RESET_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(t)).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000) / 60000;
}
// The exact moment (ms) of midnight New York time at the start of a "YYYY-MM-DD" New York date
export function nyMidnight(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let t = wall - nyOffset(wall) * 60000;
  t = wall - nyOffset(t) * 60000; // second pass in case daylight saving time changed in between
  return t;
}
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// When today's and this week's usage come back (ms since 1970). The page shows these in the person's own time zone.
export function resetTimes(now = Date.now()) {
  return { day: nyMidnight(addDays(dayKey(new Date(now)), 1)), week: nyMidnight(addDays(weekKey(now), 7)) };
}

// ---------- Budgets (in cents of real Claude cost) ----------
// Set by the owner (2026-10-07). Free and Light run on Sonnet, Pro and up on Opus (about 2x Sonnet's cost per message).
// Budgets can have fractions of a cent (kept to 0.1 cent); usage itself is stored as a float (0.001 cent).
//   Free:                    15¢ a day,   85¢ a week
//   Light ($9.99):            65¢ a day,  $4.30 a week   (5.1x Free's weekly budget)
//   Pro ($19.99):     $1.00 a day,  $6.50 a week  (7.6x)
//   Max ($49.99): $3.50 a day, $23.00 a week (27.1x)
// Worst case (someone using the full weekly budget every week, ~4.33 weeks a month) costs more than the plan price on
// every paid plan; this relies on most people using far less. Check the admin panel's spending numbers.
export const tenths = (v) => Math.round(Number(v) * 10) / 10;
export const DEFAULT_BUDGETS = {
  free:         { day: 15,  week: 85 },
  plus:         { day: 65,  week: 430 },
  plusplus:     { day: 100, week: 650 },
  plusplusplus: { day: 350, week: 2300 },
};
export const TIERS = Object.keys(DEFAULT_BUDGETS);
export const DEFAULT_SITE_CENTS = 0; // all of Orbs together per day; 0 = no site-wide cap

// The admin panel's config keys for budgets, like "plusDayCents" and "plusWeekCents", and "siteDayCents"
export const BUDGET_KEYS = [...TIERS.flatMap((t) => [t + "DayCents", t + "WeekCents"]), "siteDayCents"];

// Budgets in effect: admin panel (config/site) wins, then Vercel's USAGE_BUDGETS / SITE_DAILY_CENTS, then the defaults above.
// A budget of 0 means unlimited.
export function budgets(cfg, env = {}) {
  let fromEnv = {};
  try { if (env.USAGE_BUDGETS) fromEnv = JSON.parse(env.USAGE_BUDGETS) || {}; } catch { fromEnv = {}; }
  // Fractions of a cent are fine (e.g. 17.5); everything is kept to a tenth of a cent
  const pick = (adminVal, envVal, def) => {
    if (typeof adminVal === "number" && Number.isFinite(adminVal) && adminVal >= 0) return tenths(adminVal);
    const e = Number(envVal);
    if (envVal !== undefined && envVal !== null && envVal !== "" && typeof envVal !== "boolean" && Number.isFinite(e) && e >= 0) return tenths(e);
    return def;
  };
  const out = {};
  for (const t of TIERS) {
    const e = fromEnv[t] || {};
    out[t] = {
      day: pick(cfg && cfg[t + "DayCents"], e.day, DEFAULT_BUDGETS[t].day),
      week: pick(cfg && cfg[t + "WeekCents"], e.week, DEFAULT_BUDGETS[t].week),
    };
  }
  out.site = pick(cfg && cfg.siteDayCents, env.SITE_DAILY_CENTS, DEFAULT_SITE_CENTS);
  return out;
}

// What one person has used, as percentages. usageDoc is usage/{uid}; limits come from allowance().
export function usageState(usageDoc, limits, now = Date.now()) {
  const dk = limits.dayKey || dayKey(new Date(now)), wk = limits.weekKey || weekKey(now);
  const dayUsed = usageDoc && usageDoc.day === dk ? Number(usageDoc.dayCents) || 0 : 0;
  const weekUsed = usageDoc && usageDoc.wkey === wk ? Number(usageDoc.weekCents) || 0 : 0;
  const pct = (used, cap) => (cap > 0 ? Math.min(100, Math.max(0, Math.round((used / cap) * 1000) / 10)) : 0);
  const r = resetTimes(now);
  return {
    unlimited: !(limits.day > 0) && !(limits.week > 0),
    dayPct: pct(dayUsed, limits.day), weekPct: pct(weekUsed, limits.week),
    dayLimited: limits.day > 0, weekLimited: limits.week > 0,
    dayResetAt: r.day, weekResetAt: r.week,
    dayUsed, weekUsed,
  };
}
// Is there anything left? (blocks at 100%)
export function usageBlock(state) {
  if (state.dayLimited && state.dayPct >= 100) return "usage_day";
  if (state.weekLimited && state.weekPct >= 100) return "usage_week";
  return null;
}
// The part the page is allowed to see (percentages and reset times only, never cents)
export function publicUsage(state) {
  if (!state) return null;
  const { unlimited, dayPct, weekPct, dayLimited, weekLimited, dayResetAt, weekResetAt } = state;
  return { unlimited, dayPct, weekPct, dayLimited, weekLimited, dayResetAt, weekResetAt };
}

export function isAdmin(user, env) {
  const list = String(env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!(user && user.email_verified === true && user.email && list.includes(String(user.email).toLowerCase()));
}
