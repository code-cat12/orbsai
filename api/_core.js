// The chat endpoint's logic, kept apart from Firebase/Vercel so it can be tested on its own.
// Flow: check who's asking -> clean up their messages -> take credits -> ask Claude -> stream the reply back.
import { createHash } from "node:crypto";
import { ORBS, ORDER, MODELS, EFFORTS, DEFAULT_EFFORT } from "./_orbs.js";
import { latestModels } from "./_models.js";
import { KIDS_RULES, SELF_HARM_NOTE, hasPersonalInfo, classify, BLOCKED } from "./_safety.js";
import { publicState } from "./_kids.js";

const MAX_TURNS = 30;        // only the latest messages are sent to Claude
const MAX_MSG_CHARS = 8000;  // one message can't be longer than this
const MAX_TOTAL_CHARS = 60000;
export const RESET_TZ = "America/New_York"; // daily credits refill at midnight New York time

export function dayKey(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: RESET_TZ });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Turn whatever the browser sent into a safe, Claude-ready list of turns.
export function cleanRequest(body) {
  if (!body || typeof body !== "object") return { error: "bad_request" };
  const { orb, model, messages } = body;
  const effort = body.effort === undefined ? DEFAULT_EFFORT : body.effort;
  if (!Number.isInteger(effort) || effort < 0 || effort >= EFFORTS.length) return { error: "bad_request" };
  if (typeof orb !== "string" || !Object.hasOwn(ORBS, orb)) return { error: "bad_request" };
  if (!Number.isInteger(model) || model < 0 || model >= MODELS.length) return { error: "bad_request" };
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 400) return { error: "bad_request" };

  let turns = [];
  for (const m of messages.slice(-MAX_TURNS)) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return { error: "bad_request" };
    const content = m.content.slice(0, MAX_MSG_CHARS).trim();
    if (!content) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + content; // two in a row from the same side: join them
    else turns.push({ role: m.role, content });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return { error: "bad_request" };
  let total = turns.reduce((n, t) => n + t.content.length, 0);
  while (total > MAX_TOTAL_CHARS && turns.length > 1) {
    total -= turns.shift().content.length;
    while (turns.length > 1 && turns[0].role !== "user") total -= turns.shift().content.length;
  }
  return { orb, model, effort, turns };
}

export function systemPrompt(orb, model) {
  const o = ORBS[orb];
  const others = ORDER.filter((k) => k !== orb).map((k) => `${ORBS[k].name} (${ORBS[k].role})`).join(", ");
  return [o.rules, `Other orbs they can pick: ${others}.`, MODELS[model].extra || "", `Reply as ${o.name}.`]
    .filter(Boolean).join(" ");
}

// deps: verifyToken(idToken) -> decoded token, charge(uid, cost, limits, day) -> {ok, left, reason},
//       refund(uid, cost, day), getKids(uid) -> kids settings, flag(uid, info) -> safety log, fetchImpl (for tests), env
export function makeChatHandler({ verifyToken, charge, refund, getKids, flag = async () => {}, fetchImpl = fetch, env = process.env }) {
  return async function POST(request) {
    if (!env.ANTHROPIC_API_KEY || !env.FIREBASE_SERVICE_ACCOUNT) return json(500, { error: "not_configured" });

    const m = (request.headers.get("authorization") || "").match(/^Bearer ([\w.-]+)$/);
    if (!m) return json(401, { error: "unauthenticated" });
    let user;
    try { user = await verifyToken(m[1]); } catch { return json(401, { error: "unauthenticated" }); }
    if (!user || !user.uid) return json(401, { error: "unauthenticated" });
    if (user.email_verified !== true) return json(403, { error: "unverified" });

    let body;
    try { body = await request.json(); } catch { return json(400, { error: "bad_request" }); }
    const req = cleanRequest(body);
    if (req.error) return json(400, { error: req.error });

    // Age check and Kids Mode, decided on the server so nobody can switch it off from the page
    let kids;
    try { kids = publicState(await getKids(user.uid), env); } catch { return json(503, { error: "upstream_error" }); }
    if (!kids.age) return json(403, { error: "age_required" });
    if (kids.blocked) return json(403, { error: "blocked_age" });
    const kidsOn = kids.on;

    const model = MODELS[req.model];
    const allModels = await latestModels({ apiKey: env.ANTHROPIC_API_KEY, fetchImpl });
    const live = allModels[req.model];
    const checkerId = allModels[0].id; // the Haiku model does the quick safety checks
    const logFlag = (info) => flag(user.uid, { orb: req.orb, ...info }).catch(() => {});
    let extraRules = "";
    if (kidsOn) {
      const last = req.turns[req.turns.length - 1].content;
      if (hasPersonalInfo(last)) { logFlag({ type: "personal_info" }); return json(400, { error: "kids_personal_info" }); }
      let label;
      try { label = await classify({ apiKey: env.ANTHROPIC_API_KEY, fetchImpl, modelId: checkerId, text: last, kind: "message" }); }
      catch { return json(503, { error: "safety_unavailable" }); }
      if (BLOCKED.has(label)) { logFlag({ type: "message_blocked", category: label }); return json(400, { error: "kids_blocked" }); }
      if (label === "SELFHARM") { logFlag({ type: "self_harm_support", category: label }); extraRules = SELF_HARM_NOTE; }
    }
    const effort = live.effort ? EFFORTS[req.effort] : null;
    const cost = model.cost * (effort ? effort.mult : 1);
    const day = dayKey();
    // No limits unless you set DAILY_CREDITS and/or SITE_DAILY_CREDITS in Vercel.
    const limited = !!(env.DAILY_CREDITS || env.SITE_DAILY_CREDITS);
    const limits = { perUser: num(env.DAILY_CREDITS, 1e9), site: num(env.SITE_DAILY_CREDITS, 1e9) };
    let paid = { ok: true, left: null };
    if (limited) {
      try { paid = await charge(user.uid, cost, limits, day); } catch { return json(503, { error: "upstream_error" }); }
      if (!paid.ok) return json(429, { error: paid.reason, left: paid.left });
    }
    const giveBack = async () => { if (limited) await refund(user.uid, cost, day).catch(() => {}); };
    const leftAfterRefund = () => (limited ? paid.left + cost : null);

    let upstream;
    try {
      upstream = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: live.id,
          max_tokens: Math.min(effort ? effort.maxTokens : model.maxTokens || 4000, live.maxTokens || Infinity),
          ...(effort ? { output_config: { effort: effort.id } } : {}),
          system: [systemPrompt(req.orb, req.model), kidsOn ? KIDS_RULES : "", extraRules].filter(Boolean).join("\n\n"),
          messages: req.turns,
          stream: true,
          // An anonymous id (not the email) so Anthropic can spot abuse from one person
          metadata: { user_id: createHash("sha256").update(user.uid).digest("hex").slice(0, 32) },
        }),
        signal: request.signal,
      });
    } catch { upstream = null; }

    if (!upstream || !upstream.ok || !upstream.body) {
      await giveBack();
      let detail = "";
      try { detail = upstream ? await upstream.text() : ""; } catch {}
      const broke = /credit balance|billing|spend limit|spending limit/i.test(detail);
      const busy = upstream && (upstream.status === 429 || upstream.status === 529);
      return json(502, { error: broke ? "out_of_funds" : busy ? "overloaded" : "upstream_error", left: leftAfterRefund() });
    }

    // Re-send Claude's reply to the browser as one small JSON object per line.
    const enc = new TextEncoder(), dec = new TextDecoder();
    // In Kids Mode the reply is held back until the safety check has read the whole thing.
    let wroteText = false, stop = null, failed = null, held = "";
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        const reader = upstream.body.getReader();
        let buf = "";
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
              if (!line.startsWith("data:")) continue;
              let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
              if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
                wroteText = true;
                if (kidsOn) held += ev.delta.text; else send({ d: ev.delta.text });
              } else if (ev.type === "message_delta" && ev.delta?.stop_reason) {
                stop = ev.delta.stop_reason;
              } else if (ev.type === "error") {
                failed = ev.error?.type === "overloaded_error" ? "overloaded" : "upstream_error";
              }
            }
          }
        } catch { failed = failed || "upstream_error"; }
        let left = paid.left;
        if (failed && !wroteText) { await giveBack(); left = leftAfterRefund(); }
        if (!failed && kidsOn && held) {
          let label = null;
          try { label = await classify({ apiKey: env.ANTHROPIC_API_KEY, fetchImpl, modelId: checkerId, text: held, kind: "reply" }); } catch {}
          if (!label) failed = "safety_unavailable";
          else if (BLOCKED.has(label)) { failed = "kids_reply_blocked"; logFlag({ type: "reply_blocked", category: label }); }
          else send({ d: held });
        }
        if (failed) send({ error: failed, left });
        else send({ done: true, truncated: stop === "max_tokens", refused: stop === "refusal", left, kids: kidsOn });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  };
}
