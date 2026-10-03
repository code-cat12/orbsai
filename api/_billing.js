// Stripe: checkout (buy a plan), the customer portal (cancel or switch), and the webhook (Stripe telling us what happened).
// Talks to Stripe's API directly, so there's nothing extra to install.
import { createHmac, timingSafeEqual } from "node:crypto";
import { PLANS, prices, priceToPlan, activePlan } from "./_plans.js";

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
// Stripe wants form-style bodies: a[b][c]=value
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
export function stripeClient(key, fetchImpl = fetch) {
  return async function stripe(method, path, params) {
    const res = await fetchImpl("https://api.stripe.com/v1/" + path, {
      method,
      headers: { authorization: "Bearer " + key, "content-type": "application/x-www-form-urlencoded" },
      body: method === "GET" ? undefined : form(params || {}).toString(),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error((j.error && j.error.message) || "stripe " + res.status); e.stripe = j.error; throw e; }
    return j;
  };
}

// The bits of a Stripe subscription we keep (works with old and new Stripe API shapes)
export function subRecord(s, env) {
  const item = s.items && s.items.data && s.items.data[0];
  const priceId = item && item.price && item.price.id;
  const pp = priceToPlan(priceId, env);
  return {
    plan: pp ? pp.plan : null, interval: pp ? pp.interval : null, price: priceId || null,
    status: s.status, subscription: s.id, customer: typeof s.customer === "string" ? s.customer : s.customer && s.customer.id,
    periodStart: s.current_period_start || (item && item.current_period_start) || null,
    periodEnd: s.current_period_end || (item && item.current_period_end) || null,
    cancelAtPeriodEnd: !!(s.cancel_at_period_end || s.cancel_at),
  };
}

// POST /api/billing  { action:"checkout", plan, interval }  or  { action:"portal" }
export function makeBillingHandler({ verifyToken, getSub, getKids, stripe, env = process.env }) {
  return async function POST(request) {
    if (!env.STRIPE_SECRET_KEY) return json(503, { error: "billing_off" });
    const m = (request.headers.get("authorization") || "").match(/^Bearer ([\w.-]+)$/);
    if (!m) return json(401, { error: "unauthenticated" });
    let user;
    try { user = await verifyToken(m[1]); } catch (e) { if (e && e.setup) throw e; return json(401, { error: "unauthenticated" }); }
    if (!user || !user.uid) return json(401, { error: "unauthenticated" });
    if (user.email_verified !== true) return json(403, { error: "unverified" });
    let body; try { body = await request.json(); } catch { return json(400, { error: "bad_request" }); }
    const k = (await getKids(user.uid)) || {};
    if (k.banned) return json(403, { error: "banned" });
    if (!k.age || k.age === "under13") return json(403, { error: "age_required" });
    const sub = await getSub(user.uid);
    const origin = new URL(request.url).origin;

    if (body && body.action === "portal") {
      if (!sub || !sub.customer) return json(400, { error: "no_subscription" });
      const s = await stripe("POST", "billing_portal/sessions", { customer: sub.customer, return_url: origin + "/?billing=back" });
      return json(200, { url: s.url });
    }
    if (body && body.action === "checkout") {
      const plan = body.plan, interval = body.interval === "year" ? "year" : "month";
      if (!Object.hasOwn(PLANS, plan)) return json(400, { error: "bad_request" });
      // Already paying? Switching happens in the portal so they don't get charged twice.
      if (activePlan(sub)) return json(409, { error: "already_subscribed" });
      const price = prices(env)[plan] && prices(env)[plan][interval];
      if (!price) return json(400, { error: "bad_request" });
      const s = await stripe("POST", "checkout/sessions", {
        mode: "subscription",
        line_items: { 0: { price, quantity: 1 } },
        success_url: origin + "/?checkout=success",
        cancel_url: origin + "/?checkout=cancel",
        client_reference_id: user.uid,
        metadata: { uid: user.uid },
        subscription_data: { metadata: { uid: user.uid } },
        allow_promotion_codes: "true",
        ...(sub && sub.customer ? { customer: sub.customer } : { customer_email: user.email }),
      });
      return json(200, { url: s.url });
    }
    return json(400, { error: "bad_request" });
  };
}

// Checks that a webhook really came from Stripe (its signature uses your webhook signing secret)
export function verifyStripe(raw, header, secret, nowSec = Math.floor(Date.now() / 1000), tolerance = 300) {
  if (!header || !secret) return false;
  let t = null; const sigs = [];
  for (const part of header.split(",")) { const [k, v] = part.split("="); if (k === "t") t = Number(v); else if (k === "v1" && v) sigs.push(v); }
  if (!t || !sigs.length || Math.abs(nowSec - t) > tolerance) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest();
  return sigs.some((s) => { try { const b = Buffer.from(s, "hex"); return b.length === expected.length && timingSafeEqual(b, expected); } catch { return false; } });
}

// POST /api/stripe-webhook — Stripe tells us when someone subscribes, renews, changes plan, or cancels
export function makeWebhookHandler({ stripe, setSub, uidForCustomer, env = process.env, now }) {
  return async function POST(request) {
    const raw = await request.text();
    if (!verifyStripe(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET, now ? now() : undefined)) return json(400, { error: "bad_signature" });
    let ev; try { ev = JSON.parse(raw); } catch { return json(400, { error: "bad_request" }); }
    const obj = ev.data && ev.data.object || {};
    const save = async (subscription, hintUid) => {
      const s = typeof subscription === "string" ? await stripe("GET", "subscriptions/" + subscription) : subscription;
      const rec = subRecord(s, env);
      const uid = (s.metadata && s.metadata.uid) || hintUid || (rec.customer ? await uidForCustomer(rec.customer) : null);
      if (!uid || !/^[\w-]{1,128}$/.test(uid)) return;
      await setSub(uid, rec);
    };
    if (ev.type === "checkout.session.completed") {
      if (obj.mode === "subscription" && obj.subscription) await save(obj.subscription, obj.client_reference_id || (obj.metadata && obj.metadata.uid));
    } else if (ev.type === "customer.subscription.created" || ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
      // Re-read it from Stripe so events that arrive out of order can't leave an old state behind
      await save(obj.id || obj);
    } else if (ev.type === "invoice.paid" || ev.type === "invoice.payment_failed") {
      const subId = obj.subscription || (obj.parent && obj.parent.subscription_details && obj.parent.subscription_details.subscription);
      if (subId) await save(typeof subId === "string" ? subId : subId.id);
    }
    return json(200, { received: true });
  };
}
