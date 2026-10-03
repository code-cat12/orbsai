// /api/kids logic: the age question and the parent PIN for Kids Mode.
//  - Under 13: can't use Orbs.
//  - 13 to 17: Kids Mode is on and locked (nobody can turn it off).
//  - 18+: Kids Mode is optional, and turning it off needs the PIN that was set when it was turned on.
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { allowance, creditsLeftFor, publicPlan, testSub } from "./_plans.js";
import { isAdmin } from "./_limits.js";

const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
// A safe hint for why a sign-in token was refused (for setup problems)
function tokenProblem(e) {
  const c = String((e && (e.code || e.message)) || "");
  if (/project|aud/i.test(c)) return "the service account is from a different Firebase project";
  if (/expired/i.test(c)) return "sign-in expired, refresh the page";
  return "sign-in couldn't be checked";
}
const hashPin = (pin, salt) => scryptSync(pin, salt, 32).toString("hex");
export function publicState(k, env = {}) {
  return {
    age: k?.age || null,
    on: env.KIDS_MODE === "all" || !!k?.on || k?.age === "teen",
    locked: k?.age === "teen" || env.KIDS_MODE === "all",
    blocked: k?.age === "under13",
    forcedForAll: env.KIDS_MODE === "all",
  };
}

export function makeKidsHandler({ verifyToken, getKids, setKids, getConfig = async () => null, getUsage = async () => null, getSub = async () => null, env: baseEnv = process.env, now = () => Date.now() }) {
  return async function POST(request) {
    const m = (request.headers.get("authorization") || "").match(/^Bearer ([\w.-]+)$/);
    if (!m) return json(401, { error: "unauthenticated" });
    let user;
    try { user = await verifyToken(m[1]); } catch (e) { if (e && e.setup) throw e; return json(401, { error: "unauthenticated", why: tokenProblem(e) }); }
    if (!user?.uid) return json(401, { error: "unauthenticated" });
    let body;
    try { body = await request.json(); } catch { return json(400, { error: "bad_request" }); }
    const k = (await getKids(user.uid)) || {};
    const { action } = body || {};
    // "Kids Mode for everyone" can be switched on in the admin panel too
    let cfg = null; try { cfg = await getConfig(); } catch {}
    const env = cfg && cfg.kidsForAll === true ? { ...baseEnv, KIDS_MODE: "all" } : baseEnv;

    if (action === "status") {
      // Today's credits, so the page can show them before the first message
      // ...plus their plan and what it unlocks
      let sub = null; try { sub = await getSub(user.uid); } catch {}
      const owner = isAdmin(user, env), viewAs = owner ? (k.viewAs || "owner") : null;
      const a = allowance({ sub, cfg, env, user, viewAs });
      const shownSub = owner && viewAs !== "owner" ? testSub(viewAs) : sub;
      let credits = null;
      if (a.perUser > 0) { try { credits = creditsLeftFor(await getUsage(user.uid), a); } catch { credits = { limit: a.perUser, left: a.perUser }; } }
      return json(200, { ...publicState(k, env), banned: !!k.banned, web: !(cfg && cfg.webSearch === false), webPerDay: a.searches, credits,
        plan: publicPlan(shownSub), models: a.models, billing: !!env.STRIPE_SECRET_KEY, owner, viewAs, memory: a.memory && !publicState(k, env).on });
    }

    if (action === "age") {
      if (k.age) return json(409, { error: "age_already_set", ...publicState(k, env) });
      const age = body.age;
      if (!["under13", "teen", "adult"].includes(age)) return json(400, { error: "bad_request" });
      const next = { age, on: age === "teen", setAt: new Date(now()).toISOString() };
      await setKids(user.uid, next);
      return json(200, publicState(next, env));
    }

    if (action === "on" || action === "off") {
      if (!k.age) return json(403, { error: "age_required" });
      if (k.age !== "adult") return json(403, { error: "locked", ...publicState(k, env) });
      const pin = String(body.pin || "");
      if (!/^\d{4,8}$/.test(pin)) return json(400, { error: "bad_pin" });
      if (action === "on") {
        if (k.on) return json(200, publicState(k, env));
        const salt = randomBytes(16).toString("hex");
        const next = { ...k, on: true, salt, pinHash: hashPin(pin, salt), fails: 0, lockUntil: 0 };
        await setKids(user.uid, next);
        return json(200, publicState(next, env));
      }
      if (!k.on) return json(200, publicState(k, env));
      if (k.lockUntil && now() < k.lockUntil) return json(429, { error: "too_many_tries", retryAt: k.lockUntil });
      const good = k.pinHash && k.salt && timingSafeEqual(Buffer.from(hashPin(pin, k.salt), "hex"), Buffer.from(k.pinHash, "hex"));
      if (!good) {
        const fails = (k.fails || 0) + 1;
        const lockUntil = fails >= MAX_FAILS ? now() + LOCK_MS : 0;
        await setKids(user.uid, { ...k, fails: fails >= MAX_FAILS ? 0 : fails, lockUntil });
        return json(403, { error: lockUntil ? "too_many_tries" : "wrong_pin", triesLeft: lockUntil ? 0 : MAX_FAILS - fails });
      }
      const next = { ...k, on: false, pinHash: null, salt: null, fails: 0, lockUntil: 0 };
      await setKids(user.uid, next);
      return json(200, publicState(next, env));
    }
    return json(400, { error: "bad_request" });
  };
}
