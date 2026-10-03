// Two-step sign-in (MFA): an authenticator app code, an email code, or a backup code.
// How it locks things: when MFA is on, the person's account gets a list called "mfa" with the
// sign-in times (auth_time) of the sessions that passed the second step. A session whose sign-in
// time isn't on the list can't read chats (firestore.rules) or use the API (checkMfa).
import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function b32encode(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function b32decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, ""); let bits = 0, val = 0; const out = [];
  for (const c of clean) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
// The 6-digit code an authenticator app shows (RFC 6238, 30-second steps)
export function totp(secret, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
// Accepts the code for now, 30 s ago, or 30 s ahead (phone clocks drift). Never the same code twice.
export function checkTotp(secret, code, nowMs, lastCounter = -1) {
  if (!/^\d{6}$/.test(code)) return null;
  const c = Math.floor(nowMs / 30000);
  for (const k of [c, c - 1, c + 1]) if (k > lastCounter && same(totp(secret, k), code)) return k;
  return null;
}
export const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const CODE_ABC = "abcdefghjkmnpqrstuvwxyz23456789";
export function newBackupCodes() {
  return Array.from({ length: 8 }, () => { let s = ""; for (let i = 0; i < 8; i++) s += CODE_ABC[randomInt(CODE_ABC.length)]; return s.slice(0, 4) + "-" + s.slice(4); });
}
const normBackup = (c) => String(c).toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");

// Is this session allowed? (No MFA = always yes.)
export function mfaOk(tok) { return !tok || !Array.isArray(tok.mfa) || tok.mfa.includes(tok.auth_time); }
export function checkMfa(tok) { if (!mfaOk(tok)) { const e = new Error("mfa_required"); e.mfa = true; throw e; } return tok; }
export const MAX_SESSIONS = 10;
export function withSession(claims, authTime) {
  const list = Array.isArray(claims && claims.mfa) ? claims.mfa.filter((t) => t !== authTime) : [];
  return { ...(claims || {}), mfa: [...list, authTime].slice(-MAX_SESSIONS) };
}
export function withoutMfa(claims) { const c = { ...(claims || {}) }; delete c.mfa; return c; }

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LOCK_FAILS = 5, LOCK_MS = 15 * 60000, CODE_MS = 10 * 60000;

// POST /api/mfa  { action, code?, kind? }
export function makeMfaHandler({ verifyToken, getMfa, setMfa, getClaims, setClaims, sendCode, env = process.env, now = () => Date.now() }) {
  return async function POST(request) {
    const m = (request.headers.get("authorization") || "").match(/^Bearer ([\w.-]+)$/);
    if (!m) return json(401, { error: "unauthenticated" });
    let tok;
    try { tok = await verifyToken(m[1]); } catch (e) { if (e && e.setup) throw e; return json(401, { error: "unauthenticated" }); }
    if (!tok || !tok.uid) return json(401, { error: "unauthenticated" });
    if (tok.email_verified !== true) return json(403, { error: "unverified" });
    let body; try { body = await request.json(); } catch { return json(400, { error: "bad_request" }); }
    const action = body && body.action, code = typeof body.code === "string" ? body.code.trim().slice(0, 20) : "";
    const uid = tok.uid, t = now(), emailReady = !!env.BREVO_API_KEY;
    const d = (await getMfa(uid)) || {};
    const on = !!(d.totp || d.email);
    const passed = !on || mfaOk(tok);
    const save = (patch) => setMfa(uid, { ...d, ...patch });
    const status = () => ({ on, totp: !!d.totp, email: !!d.email, need: on && !mfaOk(tok), emailReady, backupLeft: (d.backup || []).length, locked: !!(d.lockUntil && d.lockUntil > t) });
    const approve = async () => setClaims(uid, withSession(await getClaims(uid), tok.auth_time));
    const mailCode = async (purpose) => {
      if (!emailReady) return json(503, { error: "email_off" });
      if (d.code && d.code.sent && t - d.code.sent < 60000) return json(429, { error: "wait", wait: Math.ceil((60000 - (t - d.code.sent)) / 1000) });
      const c = String(randomInt(0, 1e6)).padStart(6, "0");
      await save({ code: { hash: sha(uid + ":" + c), exp: t + CODE_MS, sent: t, purpose, tries: 0 } });
      await sendCode(tok.email, c);
      return json(200, { ok: true, sent: true });
    };
    const emailCodeOk = (purpose) => !!(d.code && d.code.purpose === purpose && d.code.exp > t && (d.code.tries || 0) < LOCK_FAILS && /^\d{6}$/.test(code) && same(d.code.hash, sha(uid + ":" + code)));
    const badTry = async () => {
      const fails = (d.lockUntil && d.lockUntil > t ? 0 : (d.fails || 0)) + 1;
      await save({ fails: fails >= LOCK_FAILS ? 0 : fails, lockUntil: fails >= LOCK_FAILS ? t + LOCK_MS : (d.lockUntil || 0), ...(d.code ? { code: { ...d.code, tries: (d.code.tries || 0) + 1 } } : {}) });
      return json(400, { error: fails >= LOCK_FAILS ? "locked" : "wrong_code" });
    };
    // Checks a code of any kind: authenticator, email, or backup. Returns the changes to save, or null.
    const anyCode = (kind) => {
      if (kind === "totp" && d.totp) { const k = checkTotp(d.totp.secret, code, t, d.totp.last ?? -1); return k === null ? null : { totp: { ...d.totp, last: k } }; }
      if (kind === "email" && d.email && emailCodeOk("login")) return { code: null };
      if (kind === "backup") { const h = sha(uid + ":" + normBackup(code)), list = d.backup || []; if (list.includes(h)) return { backup: list.filter((x) => x !== h) }; }
      return null;
    };
    const locked = () => d.lockUntil && d.lockUntil > t;
    const enableFirst = async (patch) => {
      const fresh = !on, codes = fresh ? newBackupCodes() : null;
      await save({ ...patch, ...(fresh ? { backup: codes.map((c) => sha(uid + ":" + c)) } : {}), fails: 0 });
      await approve();
      return json(200, { ok: true, backup: codes });
    };

    if (action === "status") return json(200, status());

    // ---- Signing in: the second step ----
    if (action === "send") { if (!on || !d.email || passed) return json(400, { error: "bad_request" }); return mailCode("login"); }
    if (action === "verify") {
      if (!on) return json(400, { error: "bad_request" });
      if (locked()) return json(429, { error: "locked" });
      const patch = anyCode(body.kind);
      if (!patch) return badTry();
      await save({ ...patch, fails: 0 }); await approve();
      return json(200, { ok: true, backupLeft: patch.backup ? patch.backup.length : (d.backup || []).length });
    }

    // ---- Everything below needs a session that already passed (or MFA off) ----
    if (!passed) return json(403, { error: "mfa_required" });
    if (action === "totpStart") {
      const secret = b32encode(randomBytes(20));
      await save({ pendingTotp: { secret, at: t } });
      const label = encodeURIComponent("Orbs AI:" + (tok.email || "account"));
      return json(200, { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=Orbs%20AI&digits=6&period=30` });
    }
    if (action === "totpConfirm") {
      if (locked()) return json(429, { error: "locked" });
      const p = d.pendingTotp; if (!p || t - p.at > 15 * 60000) return json(400, { error: "expired" });
      const k = checkTotp(p.secret, code, t); if (k === null) return badTry();
      return enableFirst({ totp: { secret: p.secret, last: k, at: t }, pendingTotp: null });
    }
    if (action === "emailStart") return mailCode("setup");
    if (action === "emailConfirm") {
      if (locked()) return json(429, { error: "locked" });
      if (!emailCodeOk("setup")) return badTry();
      return enableFirst({ email: true, code: null });
    }
    if (action === "off" || action === "newBackup") {
      if (!on) return json(400, { error: "bad_request" });
      if (locked()) return json(429, { error: "locked" });
      const patch = anyCode(body.kind); if (!patch) return badTry();
      if (action === "newBackup") { const codes = newBackupCodes(); await save({ ...patch, backup: codes.map((c) => sha(uid + ":" + c)), fails: 0 }); return json(200, { ok: true, backup: codes }); }
      const which = body.method === "totp" ? "totp" : body.method === "email" ? "email" : "all";
      const next = { ...d, ...patch, fails: 0 };
      if (which === "totp" || which === "all") next.totp = null;
      if (which === "email" || which === "all") next.email = false;
      const still = !!(next.totp || next.email);
      if (!still) { next.backup = []; next.code = null; }
      await setMfa(uid, next);
      if (!still) await setClaims(uid, withoutMfa(await getClaims(uid)));
      return json(200, { ok: true, on: still });
    }
    if (action === "sendCheck") { if (!d.email) return json(400, { error: "bad_request" }); return mailCode("login"); }
    return json(400, { error: "bad_request" });
  };
}
