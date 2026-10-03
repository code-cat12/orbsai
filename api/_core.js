// The chat endpoint's logic, kept apart from Firebase/Vercel so it can be tested on its own.
// Flow: check who's asking -> clean up their messages -> take credits -> ask Claude -> stream the reply back.
import { createHash } from "node:crypto";
import { ORBS, ORDER, MODELS, EFFORTS, DEFAULT_EFFORT, inSeason, activeOrder } from "./_orbs.js";
import { latestModels } from "./_models.js";
import { KIDS_RULES, SELF_HARM_NOTE, hasPersonalInfo, classify, BLOCKED } from "./_safety.js";
import { publicState } from "./_kids.js";
import { costCents, familyOf } from "./_price.js";

const MAX_TURNS = 30;        // only the latest messages are sent to Claude
const MAX_MSG_CHARS = 8000;  // one message can't be longer than this
const MAX_TOTAL_CHARS = 60000;
// Files sent with the newest message (Vercel caps a request at about 4.5 MB in total)
const MAX_FILES = 40, MAX_FILE_TEXT = 200000, MAX_ALL_FILE_TEXT = 300000, MAX_BASE64 = 4200000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function cleanAttachments(list) {
  if (list === undefined) return { files: [] };
  if (!Array.isArray(list) || list.length > MAX_FILES) return { error: "bad_request" };
  const files = []; let text = 0, b64 = 0;
  for (const a of list) {
    if (!a || typeof a !== "object") return { error: "bad_request" };
    const name = String(a.name || "file").replace(/[<>"\n\r]/g, "").slice(0, 200);
    if (a.kind === "image" && IMAGE_TYPES.has(a.media_type) && typeof a.data === "string" && B64.test(a.data)) {
      b64 += a.data.length; files.push({ kind: "image", name, media_type: a.media_type, data: a.data });
    } else if (a.kind === "pdf" && typeof a.data === "string" && B64.test(a.data)) {
      b64 += a.data.length; files.push({ kind: "pdf", name, data: a.data });
    } else if (a.kind === "text" && typeof a.text === "string") {
      const t = a.text.slice(0, MAX_FILE_TEXT); text += t.length; files.push({ kind: "text", name, text: t });
    } else return { error: "bad_request" };
  }
  if (text > MAX_ALL_FILE_TEXT || b64 > MAX_BASE64) return { error: "files_too_big" };
  return { files };
}

// The newest message, with any files, in the shape Claude's API expects
export function withFiles(content, files) {
  if (!files.length) return content;
  const blocks = [];
  for (const f of files) {
    if (f.kind === "image") blocks.push({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } });
    if (f.kind === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name });
  }
  const texts = files.filter((f) => f.kind === "text");
  if (texts.length) blocks.push({ type: "text", text: texts.map((f) => `<file name="${f.name}">\n${f.text}\n</file>`).join("\n\n") });
  blocks.push({ type: "text", text: content });
  return blocks;
}
import { dayKey } from "./_limits.js";
import { allowance, planFor, PLANS } from "./_plans.js";
import { memoryRules, looksPersonal, extractMemory } from "./_memory.js";
export { RESET_TZ, dayKey } from "./_limits.js";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}


// Turn whatever the browser sent into a safe, Claude-ready list of turns.
export function cleanRequest(body) {
  if (!body || typeof body !== "object") return { error: "bad_request" };
  const { orb, model, messages } = body;
  const effort = body.effort === undefined ? DEFAULT_EFFORT : body.effort;
  if (!Number.isInteger(effort) || effort < 0 || effort >= EFFORTS.length) return { error: "bad_request" };
  if (typeof orb !== "string" || !Object.hasOwn(ORBS, orb)) return { error: "bad_request" };
  if (!inSeason(orb)) return { error: "season_over" };
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
  const att = cleanAttachments(body.attachments);
  if (att.error) return { error: att.error };
  let total = turns.reduce((n, t) => n + t.content.length, 0);
  while (total > MAX_TOTAL_CHARS && turns.length > 1) {
    total -= turns.shift().content.length;
    while (turns.length > 1 && turns[0].role !== "user") total -= turns.shift().content.length;
  }
  return { orb, model, effort, turns, files: att.files, think: body.think === true, web: body.web === true, count: messages.length,
    wantTitle: body.title === true && messages.length === 1, memory: body.memory === true };
}

// Smart chat title: Koa (the cheapest model) names a new chat in a few words. Costs a tiny fraction of a cent, no credits.
export async function makeTitle({ apiKey, fetchImpl = fetch, modelId, text }) {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: modelId, max_tokens: 24, messages: [{ role: "user", content:
      "Write a short title (2 to 6 words) for a chat that starts with the message inside <message> tags. " +
      "Use the same language as the message. Reply with only the title: no quotes, no emoji, no period at the end.\n\n" +
      `<message>\n${String(text).slice(0, 2000).replace(/<\/?message>/gi, "")}\n</message>` }] }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  const t = String((j.content || []).map((b) => b.text || "").join(" ")).split("\n")[0].replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, "").trim();
  return t && t.length <= 80 ? t : null;
}

// Extra credits on top of the model's cost (never multiplied by effort)
export const EXTRAS = { longChat: 1, web: 2, bigFiles: 2 };
export const LONG_CHAT = 20;        // more than this many messages = long chat
export const BIG_PDF = 1000000;     // a PDF bigger than about 750 KB
export const BIG_TEXT = 100000;     // more than this many characters of text files
export function isBigFiles(files) {
  if (!files || !files.length) return false;
  if (files.length >= 6) return true;
  if (files.some((f) => f.kind === "pdf" && f.data.length > BIG_PDF)) return true;
  return files.reduce((n, f) => n + (f.kind === "text" ? f.text.length : 0), 0) > BIG_TEXT;
}

// Ask a quick question first when the request is unclear (the page turns the options line into buttons)
export const ASK_FIRST =
  "If a request is unclear or missing details you really need to give a good answer, ask one short clarifying question " +
  "instead of guessing. When a few choices would help, put them on the last line exactly like this: " +
  "[options: First choice | Second choice | Third choice] (2 to 4 short options, no other text on that line). " +
  "Only ask when it truly matters; if the request is clear enough, just answer.";

// Formatting the page can show nicely (tables, code colors, math)
export const FORMAT =
  "Format replies with Markdown when it helps: short headings, lists, tables, and fenced code blocks with a language tag. " +
  "For math, use LaTeX inside \\( \\) for inline math and $$ $$ for big equations (never single $ signs, so prices stay plain).";
export const WEB_RULES =
  "You can search the web. Only search when the question needs fresh or current info (news, prices, scores, recent releases). " +
  "Search as few times as you can, and mention which sites the info came from.";

// Site switches the owner can change in the admin panel (config/site in Firestore)
export const SITE_DEFAULTS = { paused: false, pausedMsg: "", webSearch: true, searchesPerUser: 5, searchesSite: 100, dailyCredits: null, siteCredits: null, kidsForAll: false };
export function siteConfig(raw) {
  const c = { ...SITE_DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const k of ["paused", "webSearch", "kidsForAll"]) if (typeof raw[k] === "boolean") c[k] = raw[k];
    if (typeof raw.pausedMsg === "string") c.pausedMsg = raw.pausedMsg.slice(0, 300);
    for (const k of ["searchesPerUser", "searchesSite", "dailyCredits", "siteCredits"]) {
      const v = raw[k];
      if (v === null && (k === "dailyCredits" || k === "siteCredits")) c[k] = null;
      else if (Number.isInteger(v) && v >= 0 && v <= 1e7) c[k] = v;
    }
  }
  return c;
}
export const MAX_SEARCHES_PER_MESSAGE = 3;

export function systemPrompt(orb, model) {
  const o = ORBS[orb];
  const others = activeOrder().filter((k) => k !== orb).map((k) => `${ORBS[k].name} (${ORBS[k].role})`).join(", ");
  return [o.rules, `Other orbs they can pick: ${others}.`, MODELS[model].extra || "", ASK_FIRST, FORMAT, `Reply as ${o.name}.`]
    .filter(Boolean).join(" ");
}

// deps: verifyToken(idToken) -> decoded token, charge(uid, cost, limits, day) -> {ok, left, reason},
//       refund(uid, cost, day), getKids(uid) -> kids settings, flag(uid, info) -> safety log,
//       getConfig() -> site switches, searchesLeft(uid, day, cfg) -> number, countSearches(uid, n, day),
//       record(day, info) -> spending stats, fetchImpl (for tests), env
export function makeChatHandler({
  verifyToken, charge, refund, getKids, flag = async () => {}, getConfig = async () => null,
  searchesLeft = async () => 0, countSearches = async () => {}, record = async () => {}, getSub = async () => null,
  getMemory = async () => [], addMemory = async () => [],
  fetchImpl = fetch, env = process.env,
}) {
  return async function POST(request) {
    if (!env.ANTHROPIC_API_KEY || !(env.FIREBASE_SERVICE_ACCOUNT || env.FIREBASE_PRIVATE_KEY)) return json(500, { error: "not_configured" });

    const m = (request.headers.get("authorization") || "").match(/^Bearer ([\w.-]+)$/);
    if (!m) return json(401, { error: "unauthenticated" });
    let user;
    try { user = await verifyToken(m[1]); } catch (e) { if (e && e.setup) throw e; return json(401, { error: "unauthenticated" }); }
    if (!user || !user.uid) return json(401, { error: "unauthenticated" });
    if (user.email_verified !== true) return json(403, { error: "unverified" });

    let body;
    try { body = await request.json(); } catch { return json(400, { error: "bad_request" }); }
    const req = cleanRequest(body);
    if (req.error) return json(400, { error: req.error });

    let cfg;
    try { cfg = siteConfig(await getConfig()); } catch { cfg = siteConfig(null); }
    if (cfg.paused) return json(503, { error: "paused", msg: cfg.pausedMsg });
    const siteEnv = cfg.kidsForAll ? { ...env, KIDS_MODE: "all" } : env;

    // Age check and Kids Mode, decided on the server so nobody can switch it off from the page
    let kids, rawKids;
    try { rawKids = await getKids(user.uid); kids = publicState(rawKids, siteEnv); } catch { return json(503, { error: "upstream_error" }); }
    if (rawKids && rawKids.banned) return json(403, { error: "banned" });
    if (!kids.age) return json(403, { error: "age_required" });
    if (kids.blocked) return json(403, { error: "blocked_age" });
    const kidsOn = kids.on;

    // What this person's plan allows (free, Plus, Plus Plus, Plus Plus Plus)
    let sub = null;
    try { sub = await getSub(user.uid); } catch { sub = null; }
    const allow = allowance({ sub, cfg, env, user, viewAs: rawKids && rawKids.viewAs });
    if (!allow.models.includes(req.model)) { const need = planFor(req.model); return json(403, { error: "plan_model", need, needName: PLANS[need].name }); }

    const model = MODELS[req.model];
    const allModels = await latestModels({ apiKey: env.ANTHROPIC_API_KEY, fetchImpl });
    const live = allModels[req.model];
    const checkerId = allModels[0].id; // the Haiku model does the quick safety checks
    const logFlag = (info) => flag(user.uid, { orb: req.orb, ...info }).catch(() => {});
    let extraRules = "";
    if (kidsOn) {
      if (req.files.some((f) => f.kind !== "text")) return json(400, { error: "kids_no_media" });
      const fileText = req.files.map((f) => `[${f.name}]\n${f.text}`).join("\n\n");
      const last = req.turns[req.turns.length - 1].content + (fileText ? "\n\n" + fileText : "");
      if (hasPersonalInfo(req.turns[req.turns.length - 1].content)) { logFlag({ type: "personal_info" }); return json(400, { error: "kids_personal_info" }); }
      let label;
      try { label = await classify({ apiKey: env.ANTHROPIC_API_KEY, fetchImpl, modelId: checkerId, text: last, kind: "message" }); }
      catch { return json(503, { error: "safety_unavailable" }); }
      if (BLOCKED.has(label)) { logFlag({ type: "message_blocked", category: label }); return json(400, { error: "kids_blocked" }); }
      if (label === "SELFHARM") { logFlag({ type: "self_harm_support", category: label }); extraRules = SELF_HARM_NOTE; }
    }
    const effort = live.effort ? EFFORTS[req.effort] : null;
    const day = dayKey();

    // Web search: only when asked for, never in Kids Mode, and capped per person and for the whole site each day
    let searchCap = 0, searchNote = null;
    if (req.web) {
      if (kidsOn) searchNote = "kids";
      else if (!cfg.webSearch) searchNote = "off";
      else {
        try { searchCap = Math.min(MAX_SEARCHES_PER_MESSAGE, await searchesLeft(user.uid, day, { ...cfg, searchesPerUser: allow.searches })); } catch { searchCap = 0; }
        if (searchCap <= 0) { searchCap = 0; searchNote = "limit"; }
      }
    }

    // Cost = model x effort, plus extras. Web search is charged up front and given back if it didn't search.
    const extraLong = req.count > LONG_CHAT ? EXTRAS.longChat : 0;
    const extraFiles = isBigFiles(req.files) ? EXTRAS.bigFiles : 0;
    const extraWeb = searchCap ? EXTRAS.web : 0;
    const cost = model.cost * (effort ? effort.mult : 1) + extraLong + extraFiles + extraWeb;

    // Credit limits: paid plans use their own numbers; free uses the admin panel's (then Vercel's). 0 = unlimited.
    const perUser = allow.perUser, site = allow.site;
    const limited = perUser > 0 || site > 0;
    const limits = { perUser: perUser > 0 ? perUser : 1e9, site: site > 0 ? site : 1e9, month: perUser > 0 && allow.month > 0 ? allow.month : 1e12, monthKey: allow.monthKey };
    let paid = { ok: true, left: null };
    if (limited) {
      try { paid = await charge(user.uid, cost, limits, day); } catch { return json(503, { error: "upstream_error" }); }
      if (!paid.ok) return json(429, { error: paid.reason, left: paid.left });
      if (perUser <= 0) paid.left = null; // only a site-wide cap: don't show a personal count
    }
    const giveBack = async () => { if (limited) await refund(user.uid, cost, day, limits.monthKey).catch(() => {}); };
    const leftAfterRefund = () => (limited && paid.left !== null ? paid.left + cost : null);

    // Memory (Plus Plus and up, never in Kids Mode): use what they told Orbs before, and save new things from this message
    const memOn = req.memory && allow.memory && !kidsOn;
    let memItems = [];
    if (memOn) { try { memItems = await getMemory(user.uid); } catch { memItems = []; } }
    const lastUser = req.turns[req.turns.length - 1].content;
    const memP = memOn && looksPersonal(lastUser)
      ? extractMemory({ apiKey: env.ANTHROPIC_API_KEY, fetchImpl, modelId: checkerId, text: lastUser, existing: memItems })
          .then((found) => (found.length ? addMemory(user.uid, found) : [])).catch(() => [])
      : null;

    // Name the chat at the same time as the reply is written (not in Kids Mode: there the first words are used)
    const titleP = req.wantTitle && !kidsOn
      ? makeTitle({ apiKey: env.ANTHROPIC_API_KEY, fetchImpl, modelId: checkerId, text: req.turns[req.turns.length - 1].content }).catch(() => null)
      : null;

    // Summarized thinking costs nothing extra on these models (the thinking happens either way); Kids Mode never shows it.
    const showThinking = req.think && !kidsOn && live.effort;
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
          ...(showThinking ? { thinking: { type: "adaptive", display: "summarized" } } : {}),
          ...(searchCap ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: searchCap }] } : {}),
          // Re-reading earlier messages from cache is much cheaper than sending them fresh each time
          cache_control: { type: "ephemeral" },
          system: [systemPrompt(req.orb, req.model), memOn ? memoryRules(memItems) : "", searchCap ? WEB_RULES : "", kidsOn ? KIDS_RULES : "", extraRules].filter(Boolean).join("\n\n"),
          messages: req.turns.map((t, i) => (i === req.turns.length - 1 ? { role: t.role, content: withFiles(t.content, req.files) } : t)),
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

    // Re-send Claude's reply to the browser as one small JSON object per line:
    //   {d:"text"}  {t:"thinking"}  {q:"search words"}  {src:[{u,t}]}  {nosearch:"limit"}  then {done:...} or {error:...}
    const enc = new TextEncoder(), dec = new TextDecoder();
    // In Kids Mode the reply is held back until the safety check has read the whole thing.
    let wroteText = false, stop = null, failed = null, held = "";
    const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, searches: 0 };
    const blocks = {}; // index -> { type, json }
    let lastType = null;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        if (searchNote) send({ nosearch: searchNote });
        const text = (t) => { wroteText = true; if (kidsOn) held += t; else send({ d: t }); };
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
              if (ev.type === "message_start") {
                const u = ev.message?.usage || {};
                usage.input = u.input_tokens || 0; usage.cacheWrite = u.cache_creation_input_tokens || 0; usage.cacheRead = u.cache_read_input_tokens || 0;
              } else if (ev.type === "content_block_start") {
                const cb = ev.content_block || {};
                blocks[ev.index] = { type: cb.type, json: "" };
                // A new text block after a search: start a new paragraph so the words don't run together
                if (cb.type === "text" && wroteText && lastType && lastType !== "text") text("\n\n");
                if (cb.type === "web_search_tool_result" && Array.isArray(cb.content)) {
                  const src = cb.content.filter((r) => r && r.url).slice(0, 8).map((r) => ({ u: String(r.url).slice(0, 500), t: String(r.title || r.url).slice(0, 200) }));
                  if (src.length && !kidsOn) send({ src });
                }
                if (cb.type !== "thinking") lastType = cb.type;
              } else if (ev.type === "content_block_delta") {
                const d = ev.delta || {};
                if (d.type === "text_delta" && d.text) text(d.text);
                else if (d.type === "thinking_delta" && d.thinking && showThinking) send({ t: d.thinking });
                else if (d.type === "input_json_delta" && blocks[ev.index]) blocks[ev.index].json += d.partial_json || "";
              } else if (ev.type === "content_block_stop") {
                const b = blocks[ev.index];
                if (b && b.type === "server_tool_use") {
                  let q = ""; try { q = JSON.parse(b.json || "{}").query || ""; } catch {}
                  if (q && !kidsOn) send({ q: String(q).slice(0, 200) });
                }
              } else if (ev.type === "message_delta") {
                if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
                const u = ev.usage || {};
                if (u.output_tokens) usage.output = u.output_tokens;
                if (u.input_tokens > usage.input) usage.input = u.input_tokens;
                if (u.cache_read_input_tokens > usage.cacheRead) usage.cacheRead = u.cache_read_input_tokens;
                if (u.cache_creation_input_tokens > usage.cacheWrite) usage.cacheWrite = u.cache_creation_input_tokens;
                if (u.server_tool_use?.web_search_requests) usage.searches = u.server_tool_use.web_search_requests;
              } else if (ev.type === "error") {
                failed = ev.error?.type === "overloaded_error" ? "overloaded" : "upstream_error";
              }
            }
          }
        } catch { failed = failed || "upstream_error"; }
        let left = paid.left;
        if (failed && !wroteText) { await giveBack(); left = leftAfterRefund(); }
        else if (extraWeb && !usage.searches && limited) {
          // It didn't end up searching, so the web search credits come back
          await refund(user.uid, extraWeb, day, limits.monthKey).catch(() => {});
          if (left !== null) left += extraWeb;
        }
        if (!failed && kidsOn && held) {
          let label = null;
          try { label = await classify({ apiKey: env.ANTHROPIC_API_KEY, fetchImpl, modelId: checkerId, text: held, kind: "reply" }); } catch {}
          if (!label) failed = "safety_unavailable";
          else if (BLOCKED.has(label)) { failed = "kids_reply_blocked"; logFlag({ type: "reply_blocked", category: label }); }
          else send({ d: held });
        }
        if (!failed && titleP) { const t = await titleP; if (t) send({ title: t }); }
        if (!failed && memP) { const added = await memP; if (added && added.length) send({ mem: added }); }
        if (failed) send({ error: failed, left });
        else send({ done: true, truncated: stop === "max_tokens", refused: stop === "refusal", left, kids: kidsOn, searched: usage.searches || 0,
          cost: limited ? cost - (extraWeb && !usage.searches ? extraWeb : 0) : null });
        controller.close();
        // Bookkeeping after the reply is done (never blocks or breaks the chat)
        if (usage.searches) await countSearches(user.uid, usage.searches, day).catch(() => {});
        await record(day, { family: familyOf(live.id), ...usage, cents: costCents(live.id, usage) }).catch(() => {});
      },
    });
    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  };
}
