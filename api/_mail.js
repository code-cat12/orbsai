// Our own pretty "confirm your email" message, sent through Brevo.
// Needs BREVO_API_KEY in Vercel. Without it the page falls back to Firebase's plain email.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const MAIL_FROM = "contact-orbsai@proton.me";

export function verifyEmail({ link, name, origin }) {
  const hi = name ? `Hi ${esc(name.slice(0, 40))}!` : "Hi there!";
  const hand = `'Patrick Hand','Comic Sans MS','Trebuchet MS',Arial,sans-serif`;
  const serif = `'Source Serif 4',Georgia,'Times New Roman',serif`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>Confirm your email</title>
<link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Source+Serif+4:wght@500&display=swap" rel="stylesheet">
</head><body style="margin:0;padding:0;background:#ece9f5">
<div style="display:none;max-height:0;overflow:hidden">One tap and you're in. Your orbs are waiting!</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ece9f5"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td><img src="${origin}/email-header.png" width="600" alt="Orbs AI: nine little AI helpers in one chat" style="display:block;width:100%;height:auto;border:0"></td></tr>
<tr><td style="padding:30px 34px 8px;font-family:${serif};font-size:28px;line-height:1.2;color:#1c1b19;font-weight:500">Confirm your email</td></tr>
<tr><td style="padding:6px 34px 0;font-family:${hand};font-size:19px;line-height:1.5;color:#3b3934">
<p style="margin:0 0 12px">${hi} Thanks for joining Orbs AI.</p>
<p style="margin:0">Tap the button to confirm this is your email, then go back to Orbs and pick your first orb.</p></td></tr>
<tr><td align="center" style="padding:26px 34px 10px">
<a href="${esc(link)}" style="display:inline-block;background:#1c1b19;color:#ffffff;text-decoration:none;font-family:${hand};font-size:21px;padding:14px 34px;border-radius:999px">Confirm my email</a></td></tr>
<tr><td style="padding:14px 34px 0;font-family:${hand};font-size:15px;line-height:1.5;color:#6e6b64">
Button not working? Copy this link into your browser:<br><a href="${esc(link)}" style="color:#7b4dff;word-break:break-all">${esc(link)}</a></td></tr>
<tr><td style="padding:22px 34px 30px;font-family:${hand};font-size:15px;line-height:1.5;color:#6e6b64">
Didn't sign up? You can ignore this email and nothing will happen.</td></tr>
<tr><td style="background:#f6f5f2;padding:18px 34px;font-family:${hand};font-size:14px;line-height:1.5;color:#8a867d;text-align:center">
Orbs AI · made by The Abyss<br><a href="${origin}" style="color:#7b4dff">orbsai.vercel.app</a> · <a href="mailto:${MAIL_FROM}" style="color:#7b4dff">${MAIL_FROM}</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${name ? `Hi ${name.slice(0, 40)}!` : "Hi there!"} Thanks for joining Orbs AI.\n\nConfirm your email by opening this link:\n${link}\n\nDidn't sign up? You can ignore this email.\n\nOrbs AI, made by The Abyss\n${origin}`;
  return { subject: "Confirm your email for Orbs AI", html, text };
}

export function brevoSender(key, fetchImpl = fetch) {
  return async function send({ to, name, subject, html, text, from = MAIL_FROM }) {
    const res = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Orbs AI", email: from }, replyTo: { email: from, name: "Orbs AI" },
        to: [name ? { email: to, name } : { email: to }], subject, htmlContent: html, textContent: text, tags: ["verify"] }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error("brevo " + res.status + " " + (j.message || "")); }
  };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// POST /api/verify-email — sends the pretty confirm email. Any error = the page uses Firebase's plain one instead.
export function makeVerifyMailHandler({ verifyToken, genLink, send, mailRate, env = process.env }) {
  return async function POST(request) {
    if (!env.BREVO_API_KEY) return json(503, { error: "mail_off" });
    const m = (request.headers.get("authorization") || "").match(/^Bearer ([\w.-]+)$/);
    if (!m) return json(401, { error: "unauthenticated" });
    let user;
    try { user = await verifyToken(m[1]); } catch (e) { if (e && e.setup) throw e; return json(401, { error: "unauthenticated" }); }
    if (!user || !user.uid || !user.email) return json(401, { error: "unauthenticated" });
    if (user.email_verified === true) return json(200, { ok: true, already: true });
    if (!(await mailRate(user.uid))) return json(429, { error: "too_many" });
    const origin = new URL(request.url).origin;
    const link = await genLink(user.email, { url: origin + "/?verified=1" });
    const mail = verifyEmail({ link, name: user.name || "", origin });
    await send({ to: user.email, name: user.name || "", ...mail, from: env.MAIL_FROM || MAIL_FROM });
    return json(200, { ok: true });
  };
}
