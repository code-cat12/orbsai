// The chat endpoint's logic, kept apart from Firebase/Vercel so it can be tested on its own.
// Flow: check who's asking -> clean up their messages -> check there's usage left -> ask Claude (Opus) -> stream the reply back
//       -> bill what the reply really cost against today's and this week's usage.
import { createHash } from "node:crypto";
import { ORBS, CHAT, HELPER, inSeason, activeOrder } from "./_orbs.js";
import { latestModels, HAIKU, modelForTier } from "./_models.js";
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
import { dayKey, BUDGET_KEYS, tenths, usageState, usageBlock, publicUsage } from "./_limits.js";
import { allowance, PLANS } from "./_plans.js";
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
  // "model" and "effort" from older pages are ignored: every orb runs on Opus with one fixed effort
  const { orb, messages } = body;
  if (typeof orb !== "string" || !Object.hasOwn(ORBS, orb)) return { error: "bad_request" };
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
  // Orb team: the helpers, in order (the lead is "orb"). Up to 5 orbs in total.
  let team = [];
  if (body.team !== undefined) {
    if (!Array.isArray(body.team) || body.team.length > MAX_TEAM - 1) return { error: "bad_request" };
    for (const k of body.team) if (typeof k !== "string" || !Object.hasOwn(ORBS, k) || k === orb || team.includes(k)) return { error: "bad_request" }; else team.push(k);
  }
  let total = turns.reduce((n, t) => n + t.content.length, 0);
  while (total > MAX_TOTAL_CHARS && turns.length > 1) {
    total -= turns.shift().content.length;
    while (turns.length > 1 && turns[0].role !== "user") total -= turns.shift().content.length;
  }
  return { orb, turns, files: att.files, team, think: body.think === true, web: body.web === true, count: messages.length,
    wantTitle: body.title === true && messages.length === 1, memory: body.memory === true };
}

// Smart chat title: Haiku names a new chat in a few words in the background. Costs a tiny fraction of a cent and never counts toward usage.
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
  "Search as few times as you can, and mention which sites the info came from. " +
  "If a search result gives a direct link to a picture (a .jpg, .png, .webp or .gif address) that would really help, you can show up to 4 with Markdown like ![short description](https://...). Never make up a picture address.";

// Site switches the owner can change in the admin panel (config/site in Firestore)
// Usage budgets (cents of real Claude cost, see _limits.js): null = use Vercel's USAGE_BUDGETS / the built-in defaults, 0 = unlimited.
export const SITE_DEFAULTS = { paused: false, pausedMsg: "", webSearch: true, searchesPerUser: 5, searchesSite: 100, kidsForAll: false, halloween: "auto",
  ...Object.fromEntries(BUDGET_KEYS.map((k) => [k, null])) };
export function siteConfig(raw) {
  const c = { ...SITE_DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const k of ["paused", "webSearch", "kidsForAll"]) if (typeof raw[k] === "boolean") c[k] = raw[k];
    if (typeof raw.pausedMsg === "string") c.pausedMsg = raw.pausedMsg.slice(0, 300);
    if (["auto", "on", "off"].includes(raw.halloween)) c.halloween = raw.halloween;
    for (const k of ["searchesPerUser", "searchesSite", ...BUDGET_KEYS]) {
      const v = raw[k];
      if (v === null && BUDGET_KEYS.includes(k)) c[k] = null;
      else if (BUDGET_KEYS.includes(k) && typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e7) c[k] = tenths(v); // budgets can be fractional cents
      else if (Number.isInteger(v) && v >= 0 && v <= 1e7) c[k] = v;
    }
  }
  return c;
}
export const MAX_SEARCHES_PER_MESSAGE = 3;

export function systemPrompt(orb, seasonMode = "auto") {
  const o = ORBS[orb];
  const others = activeOrder(Date.now(), seasonMode).filter((k) => k !== orb).map((k) => `${ORBS[k].name} (${ORBS[k].role})`).join(", ");
  return [o.rules, `Other orbs they can pick: ${others}.`, ASK_FIRST, FORMAT, `Reply as ${o.name}.`]
    .filter(Boolean).join(" ");
}

// ---------- Orb teams (Light and up) ----------
// The helpers each do their own part, one after another, then the lead orb puts it all together.
// Usage: every helper call and the lead's reply are billed at what they really cost, all together after the run.
export const MAX_TEAM = 5;            // orbs in a team, lead included
const HELPER_TOKENS = HELPER.maxTokens; // a helper's part stays short
const PEEK_CHARS = 1500;              // how much of earlier helpers' parts the next helper sees
const NOTE_CHARS = 6000;              // how much of each part the lead sees
const HELPERS_TIME = 150000;          // after 2.5 minutes of helpers, skip the rest so the lead has time to build
const HELPER_CONTEXT = 6;             // helpers only see the latest few messages
const teamNames = (lead, team) => [`${ORBS[lead].name} (${ORBS[lead].role}, the lead)`, ...team.map((k) => `${ORBS[k].name} (${ORBS[k].role})`)].join(", ");
export function helperPrompt(key, lead, team, kidsOn) {
  const o = ORBS[key];
  return [o.rules,
    `TEAM MODE: right now you're one orb on an Orbs team working on the person's request together. The team: ${teamNames(lead, team)}.`,
    `Do only YOUR part: the piece of the request that fits your specialty (${o.role}). ${ORBS[lead].name} will put everyone's parts together into the finished result, so don't build the whole thing.`,
    "Ignore any rule about sending them to another orb: in team mode you just do your part. Don't ask questions; make smart guesses. No intro or sign-off.",
    "Keep it short and useful: under 300 words, or the actual piece itself (like a plot, lore, a song plan, a list of features).",
    FORMAT, `Write as ${o.name}.`, kidsOn ? KIDS_RULES : ""].filter(Boolean).join(" ");
}
export function leadRules(lead, team) {
  return `TEAM MODE: you're the lead of an Orbs team: ${teamNames(lead, team)}. Your teammates already did their parts, ` +
    "which are in <team_notes> at the end of the person's newest message (the person can open the notes, but your reply is what they really see). " +
    "Use their work to make ONE finished result: you're the one who builds it. Keep the good parts, fix anything that doesn't fit together, " +
    "and add one short line saying who did what (like \"Plot by Abyss, lore by Quill\"). If a teammate's part is missing, do that part yourself.";
}
const noteTag = (k, text, max) => `<note orb="${ORBS[k].name}">\n${String(text).slice(0, max).replace(/<\/?(team_notes|note)\b[^>]*>/gi, "")}\n</note>`;
export function notesBlock(notes, max = NOTE_CHARS) {
  return notes.length ? `\n\n<team_notes>\n${notes.map((n) => noteTag(n.k, n.text, max)).join("\n")}\n</team_notes>` : "";
}

// deps: verifyToken(idToken) -> decoded token, getUsage(uid) -> usage/{uid}, bill(uid, cents, limits) -> new usage/{uid},
//       siteUsed(day) -> cents used by everyone today, getKids(uid) -> kids settings, flag(uid, info) -> safety log,
//       getConfig() -> site switches, searchesLeft(uid, day, cfg) -> number, countSearches(uid, n, day),
//       record(day, info) -> spending stats, fetchImpl (for tests), env
export function makeChatHandler({
  verifyToken, getUsage = async () => null, bill = async () => null, siteUsed = async () => 0, getKids, flag = async () => {}, getConfig = async () => null,
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
    if ([req.orb, ...req.team].some((k) => !inSeason(k, Date.now(), cfg.halloween))) return json(400, { error: "season_over" });
    const siteEnv = cfg.kidsForAll ? { ...env, KIDS_MODE: "all" } : env;

    // Age check and Kids Mode, decided on the server so nobody can switch it off from the page
    let kids, rawKids;
    try { rawKids = await getKids(user.uid); kids = publicState(rawKids, siteEnv); } catch { return json(503, { error: "upstream_error" }); }
    if (rawKids && rawKids.banned) return json(403, { error: "banned" });
    if (!kids.age) return json(403, { error: "age_required" });
    if (kids.blocked) return json(403, { error: "blocked_age" });
    const kidsOn = kids.on;

    // What this person's plan allows (free, Light, Pro, Max)
    let sub = null;
    try { sub = await getSub(user.uid); } catch { sub = null; }
    const allow = allowance({ sub, cfg, env, user, viewAs: rawKids && rawKids.viewAs });
    // Orb teams come with Light and up
    const team = req.team;
    if (team.length && !allow.plan && !allow.admin) return json(403, { error: "plan_team", need: "plus", needName: PLANS.plus.name });

    // Usage: make sure there's some left today and this week (blocks at 100%). What the reply really costs is billed at the end.
    const limits = { day: allow.day, week: allow.week, dayKey: allow.dayKey, weekKey: allow.weekKey };
    let before;
    try { before = usageState(await getUsage(user.uid), limits); } catch { return json(503, { error: "upstream_error" }); }
    const blocked = usageBlock(before);
    if (blocked) return json(429, { error: blocked, usage: publicUsage(before) });
    if (allow.site > 0) {
      let used = 0;
      try { used = await siteUsed(dayKey()); } catch { used = 0; }
      if (used >= allow.site) return json(429, { error: "site_busy", usage: publicUsage(before) });
    }
    const allModels = await latestModels({ apiKey: env.ANTHROPIC_API_KEY, fetchImpl });
    const live = allModels[modelForTier(allow.tier, allow.admin)]; // Free/Light: newest Sonnet; Pro and up: newest Opus
    const checkerId = allModels[HAIKU].id;      // Haiku does the quick background checks (never billed to the person)
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
    const effort = live.effort ? CHAT.effort : null;
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

    let spent = 0; // cents, all Claude calls for this message added up
    const charge = async () => {
      try { const doc = await bill(user.uid, spent, { ...limits, day }); return publicUsage(usageState(doc, limits)); }
      catch { return publicUsage(before); }
    };

    // Memory (Pro and up, never in Kids Mode): use what they told Orbs before, and save new things from this message
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
    const headers = { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" };
    // An anonymous id (not the email) so Anthropic can spot abuse from one person
    const metadata = { user_id: createHash("sha256").update(user.uid).digest("hex").slice(0, 32) };
    // The lead orb's (or the only orb's) streamed reply. notes = the team's parts, added to the newest message.
    const askLead = async (notes = []) => {
      try {
        return await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST", headers,
          body: JSON.stringify({
            model: live.id,
            max_tokens: Math.min(CHAT.maxTokens, live.maxTokens || Infinity),
            ...(effort ? { output_config: { effort } } : {}),
            ...(showThinking ? { thinking: { type: "adaptive", display: "summarized" } } : {}),
            ...(searchCap ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: searchCap }] } : {}),
            // Re-reading earlier messages from cache is much cheaper than sending them fresh each time
            cache_control: { type: "ephemeral" },
            system: [systemPrompt(req.orb, cfg.halloween), team.length ? leadRules(req.orb, team) : "", memOn ? memoryRules(memItems) : "", searchCap ? WEB_RULES : "", kidsOn ? KIDS_RULES : "", extraRules].filter(Boolean).join("\n\n"),
            messages: req.turns.map((t, i) => (i === req.turns.length - 1 ? { role: t.role, content: withFiles(t.content + notesBlock(notes), req.files) } : t)),
            stream: true,
            metadata,
          }),
          signal: request.signal,
        });
      } catch { return null; }
    };
    const upstreamError = async (up) => {
      let detail = "";
      try { detail = up ? await up.text() : ""; } catch {}
      const broke = /credit balance|billing|spend limit|spending limit/i.test(detail);
      const busy = up && (up.status === 429 || up.status === 529);
      return broke ? "out_of_funds" : busy ? "overloaded" : "upstream_error";
    };
    // One helper's part (not streamed, kept short). Earlier helpers' parts come along so they build on each other.
    const askHelper = async (k, notes) => {
      const recent = req.turns.slice(-HELPER_CONTEXT);
      while (recent.length > 1 && recent[0].role !== "user") recent.shift();
      const fileNote = req.files.length ? `\n\n(The person also sent files: ${req.files.map((f) => f.name).join(", ")}. Only ${ORBS[req.orb].name} can open them.)` : "";
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST", headers,
        body: JSON.stringify({
          model: live.id,
          max_tokens: Math.min(HELPER_TOKENS, live.maxTokens || Infinity),
          ...(live.effort ? { output_config: { effort: HELPER.effort } } : {}),
          system: helperPrompt(k, req.orb, team, kidsOn),
          messages: recent.map((t, i) => (i === recent.length - 1 ? { role: t.role, content: t.content + fileNote + notesBlock(notes, PEEK_CHARS) } : t)),
          metadata,
        }),
        signal: request.signal,
      });
      if (!res.ok) throw new Error("helper");
      const j = await res.json();
      const u = j.usage || {};
      const hu = { input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0, searches: 0 };
      const cents = costCents(live.id, hu);
      spent += cents;
      record(day, { family: familyOf(live.id), ...hu, cents }).catch(() => {});
      const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
      if (!text) throw new Error("empty");
      return text;
    };

    // Just one orb: start Claude now, so a failure can still answer with a normal error
    let upstream = null;
    if (!team.length) {
      upstream = await askLead();
      if (!upstream || !upstream.ok || !upstream.body) {
        return json(502, { error: await upstreamError(upstream), usage: publicUsage(before) });
      }
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
        const send = (o) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch {} };
        if (searchNote) send({ nosearch: searchNote });
        const text = (t) => { wroteText = true; if (kidsOn) held += t; else send({ d: t }); };
        // Orb team: helpers go one by one ({tm:{k, s:"go"|"ok"|"fail"|"skip", n:part}}), then the lead builds the final answer
        if (team.length) {
          const notes = [], t0 = Date.now();
          for (const k of team) {
            if (request.signal?.aborted) continue;
            if (Date.now() - t0 > HELPERS_TIME) { send({ tm: { k, s: "skip" } }); continue; }
            send({ tm: { k, s: "go" } });
            try {
              const part = await askHelper(k, notes);
              notes.push({ k, text: part });
              send({ tm: { k, s: "ok", ...(kidsOn ? {} : { n: part.slice(0, NOTE_CHARS) }) } });
            } catch { send({ tm: { k, s: "fail" } }); }
          }
          send({ tm: { k: req.orb, s: "lead" } });
          upstream = request.signal?.aborted ? null : await askLead(notes);
          if (!upstream || !upstream.ok || !upstream.body) {
            // No final answer: only the helpers' real cost is billed
            const err = await upstreamError(upstream);
            send({ error: err, usage: await charge() });
            try { controller.close(); } catch {}
            return;
          }
        }
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
        // What the reply really cost (Opus tokens + web searches), added to any team helpers
        spent += costCents(live.id, usage);
        if (!failed && kidsOn && held) {
          let label = null;
          try { label = await classify({ apiKey: env.ANTHROPIC_API_KEY, fetchImpl, modelId: checkerId, text: held, kind: "reply" }); } catch {}
          if (!label) failed = "safety_unavailable";
          else if (BLOCKED.has(label)) { failed = "kids_reply_blocked"; logFlag({ type: "reply_blocked", category: label }); }
          else send({ d: held });
        }
        if (!failed && titleP) { const t = await titleP; if (t) send({ title: t }); }
        if (!failed && memP) { const added = await memP; if (added && added.length) send({ mem: added }); }
        // Bill it before saying "done", so the page gets the new percentages right away
        const now = await charge();
        if (failed) send({ error: failed, usage: now });
        else send({ done: true, truncated: stop === "max_tokens", refused: stop === "refusal", kids: kidsOn, searched: usage.searches || 0, usage: now });
        try { controller.close(); } catch {}
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
