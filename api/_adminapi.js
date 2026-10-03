// The owner-only admin panel (/api/admin) and thumbs up/down (/api/feedback).
// Who counts as the owner: the emails in the ADMIN_EMAILS setting on Vercel (comma separated).
import { createHash } from "node:crypto";
import { siteConfig, SITE_DEFAULTS } from "./_core.js";
import { ORBS } from "./_orbs.js";
import { VIEW_AS } from "./_plans.js";

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
async function who(request, verifyToken) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer ([\w.-]+)$/);
  if (!m) return null;
  try { const u = await verifyToken(m[1]); return u && u.uid ? u : null; } catch (e) { if (e && e.setup) throw e; return null; }
}
import { isAdmin } from "./_limits.js";
export { isAdmin };

// Only these switches can be changed, and only to sensible values
export function cleanSettings(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  for (const k of Object.keys(SITE_DEFAULTS)) if (Object.hasOwn(input, k)) out[k] = input[k];
  const c = siteConfig(out);
  const kept = {};
  for (const k of Object.keys(out)) kept[k] = c[k];
  return kept;
}

// deps: verifyToken, load() -> panel data, saveSettings(obj), dismiss(kind, id), setBanned(uid, on)
export function makeAdminHandler({ verifyToken, load, saveSettings, dismiss, setBanned, setViewAs = async () => {}, env = process.env }) {
  return async function POST(request) {
    const user = await who(request, verifyToken);
    if (!user) return json(401, { error: "unauthenticated" });
    let body;
    try { body = await request.json(); } catch { return json(400, { error: "bad_request" }); }
    const action = body && body.action;
    if (action === "check") return json(200, { admin: isAdmin(user, env) });
    if (!isAdmin(user, env)) return json(403, { error: "not_admin" });

    if (action === "load") return json(200, await load());
    if (action === "settings") {
      const s = cleanSettings(body.settings);
      if (!s || !Object.keys(s).length) return json(400, { error: "bad_request" });
      await saveSettings(s);
      return json(200, { ok: true, settings: s });
    }
    if (action === "dismiss") {
      if (!["report", "flag", "feedback"].includes(body.kind) || typeof body.id !== "string" || !/^[\w-]{1,128}$/.test(body.id)) return json(400, { error: "bad_request" });
      await dismiss(body.kind, body.id);
      return json(200, { ok: true });
    }
    // Owner testing: pretend to be on a plan (nothing is charged)
    if (action === "viewAs") {
      if (!VIEW_AS.includes(body.plan)) return json(400, { error: "bad_request" });
      await setViewAs(user.uid, body.plan === "owner" ? null : body.plan);
      return json(200, { ok: true, viewAs: body.plan });
    }
    if (action === "ban" || action === "unban") {
      if (typeof body.uid !== "string" || !/^[\w-]{1,128}$/.test(body.uid)) return json(400, { error: "bad_request" });
      if (body.uid === user.uid) return json(400, { error: "self" });
      await setBanned(body.uid, action === "ban");
      return json(200, { ok: true });
    }
    return json(400, { error: "bad_request" });
  };
}

// Thumbs up / down on a reply. Saves the vote, which orb and model, and (only if the person chose to) the reply and a reason.
export function makeFeedbackHandler({ verifyToken, saveFeedback, now = () => Date.now() }) {
  return async function POST(request) {
    const user = await who(request, verifyToken);
    if (!user) return json(401, { error: "unauthenticated" });
    if (user.email_verified !== true) return json(403, { error: "unverified" });
    let b;
    try { b = await request.json(); } catch { return json(400, { error: "bad_request" }); }
    if (!b || typeof b.key !== "string" || !/^[\w.:-]{1,80}$/.test(b.key)) return json(400, { error: "bad_request" });
    if (!(b.vote === "up" || b.vote === "down" || b.vote === null)) return json(400, { error: "bad_request" });
    if (typeof b.orb !== "string" || !Object.hasOwn(ORBS, b.orb)) return json(400, { error: "bad_request" });
    if (!Number.isInteger(b.model) || b.model < 0 || b.model > 3) return json(400, { error: "bad_request" });
    const id = createHash("sha256").update(user.uid + "|" + b.key).digest("hex").slice(0, 40);
    if (b.vote === null) { await saveFeedback(id, null); return json(200, { ok: true }); }
    const doc = { uid: user.uid, orb: b.orb, model: b.model, vote: b.vote, at: now() };
    if (typeof b.reason === "string" && b.reason.trim()) doc.reason = b.reason.trim().slice(0, 300);
    if (typeof b.tag === "string" && /^[a-z_]{1,20}$/.test(b.tag)) doc.tag = b.tag;
    if (typeof b.reply === "string" && b.reply.trim()) doc.reply = b.reply.slice(0, 4000);
    await saveFeedback(id, doc);
    return json(200, { ok: true });
  };
}
