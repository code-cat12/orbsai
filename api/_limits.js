// Daily credit limits, shared by the chat and the account-status endpoints.
export const RESET_TZ = "America/New_York"; // daily credits refill at midnight New York time
export function dayKey(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: RESET_TZ });
}
export function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
// The admin panel's numbers win, then Vercel's DAILY_CREDITS / SITE_DAILY_CREDITS. 0 = unlimited.
export function creditLimits(cfg, env) {
  const perUser = cfg && cfg.dailyCredits !== null && cfg.dailyCredits !== undefined ? cfg.dailyCredits : num(env.DAILY_CREDITS, 0);
  const site = cfg && cfg.siteCredits !== null && cfg.siteCredits !== undefined ? cfg.siteCredits : num(env.SITE_DAILY_CREDITS, 0);
  return { perUser, site };
}
// What one person has left today, or null when there's no personal limit
export function creditsLeft(usageDoc, perUser, day = dayKey()) {
  if (!(perUser > 0)) return null;
  const used = usageDoc && usageDoc.day === day ? usageDoc.used || 0 : 0;
  return { limit: perUser, left: Math.max(0, perUser - used) };
}

// The owner (emails in ADMIN_EMAILS) gets a bigger daily allowance when limits are on
export const ADMIN_CREDITS = 500;
export function isAdmin(user, env) {
  const list = String(env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!(user && user.email_verified === true && user.email && list.includes(String(user.email).toLowerCase()));
}
export function userLimit(perUser, user, env) {
  return perUser > 0 && isAdmin(user, env) ? Math.max(perUser, ADMIN_CREDITS) : perUser;
}
