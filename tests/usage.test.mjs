// Quick checks for the usage math and the chat flow. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { dayKey, weekKey, nyMidnight, resetTimes, budgets, usageState, usageBlock, publicUsage, DEFAULT_BUDGETS } from "../api/_limits.js";
import { allowance } from "../api/_plans.js";
import { costCents } from "../api/_price.js";
import { makeChatHandler, cleanRequest, siteConfig } from "../api/_core.js";

test("New York midnight handles daylight saving time", () => {
  assert.equal(new Date(nyMidnight("2026-10-07")).toISOString(), "2026-10-07T04:00:00.000Z"); // EDT
  assert.equal(new Date(nyMidnight("2026-12-01")).toISOString(), "2026-12-01T05:00:00.000Z"); // EST
  assert.equal(new Date(nyMidnight("2026-11-02")).toISOString(), "2026-11-02T05:00:00.000Z"); // day after the switch
});
test("resets: tomorrow at midnight and next Monday at midnight (New York)", () => {
  const now = Date.parse("2026-10-06T21:47:00Z"); // Tue 5:47 PM EDT
  assert.equal(dayKey(new Date(now)), "2026-10-06");
  assert.equal(weekKey(now), "2026-10-05");
  const r = resetTimes(now);
  assert.equal(new Date(r.day).toISOString(), "2026-10-07T04:00:00.000Z");
  assert.equal(new Date(r.week).toISOString(), "2026-10-12T04:00:00.000Z");
  // Late Sunday night in New York is still the same week
  const sun = Date.parse("2026-10-12T03:30:00Z");
  assert.equal(weekKey(sun), "2026-10-05");
});
test("budgets: admin panel beats Vercel beats defaults; 0 = unlimited", () => {
  assert.deepEqual(budgets(null, {}).plus, DEFAULT_BUDGETS.plus);
  const env = { USAGE_BUDGETS: JSON.stringify({ plus: { day: 40, week: 120 } }), SITE_DAILY_CENTS: "5000" };
  assert.deepEqual(budgets(null, env).plus, { day: 40, week: 120 });
  assert.equal(budgets(null, env).site, 5000);
  assert.deepEqual(budgets({ plusDayCents: 55, plusWeekCents: null }, env).plus, { day: 55, week: 120 });
  assert.equal(budgets({ freeDayCents: 0 }, {}).free.day, 0);
  assert.equal(budgets(null, { USAGE_BUDGETS: "not json" }).free.day, DEFAULT_BUDGETS.free.day);
});
test("plans stay profitable: a month of full weekly use is under 40% of the price", () => {
  const price = { plus: 999, plusplus: 1999, plusplusplus: 4999 };
  for (const [p, cents] of Object.entries(price)) assert.ok(DEFAULT_BUDGETS[p].week * 52 / 12 <= cents * 0.4, p);
  assert.equal(DEFAULT_BUDGETS.plus.week, DEFAULT_BUDGETS.free.week * 3);
});
test("allowance: free, paid, owner and owner testing a plan", () => {
  const env = { ADMIN_EMAILS: "boss@x.com" };
  const free = allowance({ sub: null, cfg: null, env, user: { email: "a@x.com", email_verified: true } });
  assert.equal(free.tier, "free"); assert.equal(free.day, 10); assert.equal(free.week, 30);
  const sub = { plan: "plusplus", status: "active", periodEnd: null };
  const pp = allowance({ sub, cfg: null, env, user: { email: "a@x.com", email_verified: true } });
  assert.equal(pp.day, 60); assert.equal(pp.week, 180); assert.ok(pp.memory);
  const owner = allowance({ sub: null, cfg: null, env, user: { email: "boss@x.com", email_verified: true } });
  assert.equal(owner.day, 0); assert.equal(owner.week, 0); assert.ok(owner.admin);
  const t = allowance({ sub: null, cfg: null, env, user: { email: "boss@x.com", email_verified: true }, viewAs: "plus" });
  assert.equal(t.admin, false); assert.equal(t.day, 30); assert.match(t.dayKey, /:test-plus$/);
});
test("usage percentages and blocking at 100%", () => {
  const now = Date.parse("2026-10-06T21:47:00Z");
  const limits = { day: 10, week: 30, dayKey: "2026-10-06", weekKey: "w2026-10-05" };
  let s = usageState({ day: "2026-10-06", dayCents: 3.4, wkey: "w2026-10-05", weekCents: 3.6 }, limits, now);
  assert.equal(s.dayPct, 34); assert.equal(s.weekPct, 12); assert.equal(usageBlock(s), null);
  s = usageState({ day: "2026-10-05", dayCents: 99, wkey: "w2026-10-05", weekCents: 31 }, limits, now);
  assert.equal(s.dayPct, 0); assert.equal(s.weekPct, 100); assert.equal(usageBlock(s), "usage_week");
  s = usageState({ day: "2026-10-06", dayCents: 12, wkey: "w2026-10-05", weekCents: 12 }, limits, now);
  assert.equal(s.dayPct, 100); assert.equal(usageBlock(s), "usage_day");
  assert.equal(publicUsage(s).dayCents, undefined); // never send cents to the page
  const un = usageState(null, { day: 0, week: 0, dayKey: "x", weekKey: "y" }, now);
  assert.ok(un.unlimited); assert.equal(usageBlock(un), null);
});
test("Opus cost: tokens and web searches in cents", () => {
  // 1M input at $4 + 100k output at $20 = $4 + $2 = 600 cents, plus 2 searches at 1 cent
  assert.equal(Math.round(costCents("claude-opus-5-5", { input: 1e6, output: 1e5, searches: 2 })), 602);
  assert.ok(Math.abs(costCents("claude-opus-5-5", { cacheRead: 1e6 }) - 20) < 1e-9);
});
test("old pages that still send model/effort are fine", () => {
  const r = cleanRequest({ orb: "neb", model: 3, effort: 4, messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.error, undefined); assert.equal(r.orb, "neb"); assert.equal(r.model, undefined);
  assert.equal(siteConfig({ dailyCredits: 50, plusDayCents: 70 }).plusDayCents, 70);
  assert.equal(siteConfig({ dailyCredits: 50 }).dailyCredits, undefined);
});

// ---------- The chat endpoint with a fake Claude ----------
function sse(events) { return events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""); }
function fakeFetch(calls) {
  return async (url, opts) => {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (String(url).includes("/v1/models")) return new Response(JSON.stringify({ data: [{ id: "claude-opus-5-5" }, { id: "claude-haiku-4-5-20251001" }] }), { status: 200 });
    const body = sse([
      { type: "message_start", message: { usage: { input_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello!" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 500 } },
    ]);
    return new Response(body, { status: 200 });
  };
}
function req(body) {
  return new Request("http://x/api/chat", { method: "POST", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function lines(res) { return (await res.text()).trim().split("\n").map((l) => JSON.parse(l)); }
const env = { ANTHROPIC_API_KEY: "k", FIREBASE_SERVICE_ACCOUNT: "{}", ADMIN_EMAILS: "" };
const base = (over = {}) => ({
  verifyToken: async () => ({ uid: "u1", email: "a@x.com", email_verified: true }),
  getKids: async () => ({ age: "adult" }), getConfig: async () => null, getSub: async () => null, env, ...over,
});

test("chat: always Opus with a fixed effort, bills the real cost after the reply", async () => {
  const calls = [], billed = [];
  let doc = null;
  const h = makeChatHandler(base({
    fetchImpl: fakeFetch(calls),
    getUsage: async () => doc,
    bill: async (uid, cents, limits) => { billed.push(cents); doc = { day: limits.dayKey, dayCents: cents, wkey: limits.weekKey, weekCents: cents }; return doc; },
  }));
  const res = await h(req({ orb: "neb", model: 0, effort: 4, messages: [{ role: "user", content: "hi" }] }));
  assert.equal(res.status, 200);
  const out = await lines(res);
  const msg = calls.find((c) => c.url.endsWith("/v1/messages") && c.body.stream);
  assert.equal(msg.body.model, "claude-opus-5-5");
  assert.equal(msg.body.output_config.effort, "medium");
  // 2000 in x $4/M + 500 out x $20/M = 0.8 + 1.0 = 1.8 cents
  assert.ok(Math.abs(billed[0] - 1.8) < 1e-9);
  const done = out.find((o) => o.done);
  assert.equal(done.usage.dayPct, 18); assert.equal(done.usage.weekPct, 6);
});
test("chat: blocked at 100% before Claude is called", async () => {
  const calls = [];
  const h = makeChatHandler(base({ fetchImpl: fakeFetch(calls), getUsage: async () => ({ day: dayKey(), dayCents: 10, wkey: "w" + weekKey(), weekCents: 10 }) }));
  const res = await h(req({ orb: "neb", messages: [{ role: "user", content: "hi" }] }));
  assert.equal(res.status, 429);
  const j = await res.json();
  assert.equal(j.error, "usage_day"); assert.equal(j.usage.dayPct, 100); assert.ok(j.usage.dayResetAt > Date.now());
  assert.equal(calls.filter((c) => c.url.endsWith("/v1/messages")).length, 0);
});
test("chat: site-wide daily cap", async () => {
  const h = makeChatHandler(base({ fetchImpl: fakeFetch([]), getConfig: async () => ({ siteDayCents: 100 }), siteUsed: async () => 100 }));
  const res = await h(req({ orb: "neb", messages: [{ role: "user", content: "hi" }] }));
  assert.equal(res.status, 429); assert.equal((await res.json()).error, "site_busy");
});
