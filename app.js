// Orbs website app. Sign-in and saving use Firebase; chatting goes through /api/chat (your server).
import { firebaseConfig } from "./firebase-config.js";
import { marked } from "./vendor/marked.esm.js";
import DOMPurify from "./vendor/purify.es.mjs";
const BOTS = {
  neb: {
    name:"Nebula", role:"Everything Else", glyph:"N", color:"--c-neb",
    ask:"What's on your mind?",
    chips:["Plan a fun weekend for me","Explain how black holes work","Help me write a quick email"]
  },
  tech: {
    name:"Byte", role:"Tech Savvy", glyph:"B", color:"--c-tech",
    ask:"What tech problem can I fix?",
    chips:["Why is my phone battery dying so fast?","iPad or laptop for school?","How do I make my Wi-Fi faster?"]
  },
  cook: {
    name:"Chef Miso", role:"Cooking", glyph:"M", color:"--c-cook",
    ask:"What are we cooking today?",
    chips:["I have eggs, rice and cheese. What can I make?","Easy dinner in 20 minutes","How do I make fluffy pancakes?"]
  },
  game: {
    name:"Abyss", role:"Pro Gamer", glyph:"A", color:"--c-game",
    ask:"Ready to level up?",
    chips:["Best Minecraft starter base tips?","How do I win more Fortnite build fights?","Fastest way to level up in Pokémon?","How do I rank up in Valorant?"]
  },
  web: {
    name:"Pixel", role:"Website Dev", glyph:"P", color:"--c-web",
    ask:"What are we building?",
    chips:["Make me a simple landing page","Why won't my CSS center this div?","How do I put my site on Vercel?"]
  },
  write: {
    name:"Quill", role:"Story Writer", glyph:"Q", color:"--c-write",
    ask:"What story are we writing?",
    chips:["Write lore for my Roblox game","Give me a spooky story idea","Help me name my characters"]
  },
  study: {
    name:"Nova", role:"Homework Help", glyph:"N", color:"--c-study",
    ask:"What are we studying?",
    chips:["Explain fractions simply","Help me study for a science test","Check my essay intro"]
  },
  music: {
    name:"Beat", role:"Music", glyph:"B", color:"--c-music",
    ask:"What are we vibing to?",
    chips:["Songs like my favorite song","Make me a chill study playlist","How do I start making beats?"]
  },
  lang: {
    name:"Lingo", role:"Language Tutor", glyph:"L", color:"--c-lang",
    ask:"What do you want to practice?",
    chips:["Teach me 5 useful Chinese phrases","Correct my English sentence","How do I say this in Chinese?"]
  }
};
const ORDER = ["neb","tech","cook","game","web","write","study","music","lang"];

const $ = id => document.getElementById(id);
const app = $("app"), log = $("log"), box = $("box"), sendBtn = $("send"), status = $("status"), form = $("form");
let active = null, busy = false, ctl = null, user = null;
let webOn = false, incogNext = false;      // web search for this chat; next new chat is incognito
let opts = { think: true };                // your settings that aren't per-orb (saved to your account)
// Chats live in your Firebase account; this is just the copy on screen.
// Conversations: each orb can have as many chats as you want.
let convs = {};          // id -> { id, orb, title, turns, created, updated }
let cur = null;          // the chat that's open right now
const deletedIds = new Set(), legacyDel = new Set();
const curConv = () => (cur && convs[cur]) || null;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const titleFrom = text => { const t = String(text || "").replace(/\s+/g, " ").trim(); return !t ? "New chat" : t.length > 48 ? t.slice(0, 47) + "…" : t; };
function save(){ cloudSave(); }

// Greeting that follows the time on your device and uses your name.
// A few versions per time of day; it picks one per hour so it doesn't flicker around.
const GREETS = {
  late:      ["Up late, {n}?", "Burning the midnight oil, {n}?", "Still awake, {n}?"],
  morning:   ["Good morning, {n}", "Morning, {n}", "Rise and shine, {n}"],
  afternoon: ["Good afternoon, {n}", "Hey there, {n}", "Afternoon, {n}"],
  evening:   ["Good evening, {n}", "Evening, {n}", "Welcome back, {n}"],
  night:     ["Good night, {n}", "Winding down, {n}?", "Night owl mode, {n}?"],
};
function firstName(){
  if (!user) return "";
  const raw = (user.displayName || (user.email || "").split("@")[0] || "").trim();
  const first = raw.split(/\s+/)[0] || "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}
function greeting(){
  const now = new Date(), h = now.getHours();
  const part = h < 5 ? "late" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night";
  const list = GREETS[part], pick = list[(now.getDate() * 24 + h) % list.length];
  const n = firstName();
  return n ? pick.replace("{n}", n) : pick.replace(/,? \{n\}/, "").replace("{n}", "");
}
// Keep it up to date if the page stays open across the hour
setInterval(() => { if (app.dataset.view === "home" && $("greet") && !incogNext) $("greet").textContent = greeting(); }, 60000);

// ---------- Formatting replies ----------
// Markdown (tables, lists, links, code) -> cleaned HTML. Code gets colors and math gets drawn once a reply is finished.
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
// A clarifying question can end with "[options: A | B | C]"; that line becomes buttons instead of text
function splitOptions(text){
  const lines = String(text || "").replace(/\s+$/, "").split("\n");
  const last = lines[lines.length - 1] || "";
  const m = /^\s*\[options:\s*([^\]]+)\]\s*$/i.exec(last);
  if (m) return { body: lines.slice(0, -1).join("\n"), options: m[1].split("|").map(s => s.trim()).filter(Boolean).slice(0, 4) };
  if (/^\s*\[opt/i.test(last)) return { body: lines.slice(0, -1).join("\n"), options: [] }; // still streaming in
  return { body: String(text || ""), options: [] };
}
marked.use({ gfm: true, breaks: true });
DOMPurify.addHook("afterSanitizeAttributes", node => {
  if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer nofollow"); }
});
// Only code blocks keep a class (to know their language); every other class is dropped
DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (data.attrName === "class" && !(node.tagName === "CODE" && /^language-[\w+#-]+$/.test(data.attrValue))) data.keepAttr = false;
});
const PURIFY = { FORBID_TAGS: ["img","style","form","input","button","textarea","select","iframe","video","audio","svg","math"], FORBID_ATTR: ["style","id"], ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i };
// Math is pulled out first so Markdown doesn't mangle it: $$...$$, \[...\] (big) and \(...\) (inline). Code is left alone.
const MATH_RE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;
function md(src){
  const maths = [];
  const text = String(src || "").replace(MATH_RE, (all, code, d1, d2, i1) => {
    if (code) return code;
    const tex = d1 !== undefined ? d1 : d2 !== undefined ? d2 : i1, big = i1 === undefined;
    maths.push({ tex, big });
    return "\u0000M" + (maths.length - 1) + "\u0000";
  });
  let html = DOMPurify.sanitize(marked.parse(text.replace(/\u0000/g, "@@"), { async: false }), PURIFY);
  html = html.replace(/@@M(\d+)@@/g, (_, i) => { const m = maths[+i]; return m ? `<span class="math${m.big ? " big" : ""}" data-tex="${esc(m.tex)}">${esc(m.tex)}</span>` : ""; });
  return html;
}
// Extra polish once a reply is on screen: scrolling tables, code colors and copy buttons, drawn math
let hljsP = null, katexP = null;
function loadHljs(){ return hljsP ||= import("./vendor/highlight.min.js").then(m => { const h = m.default; h.configure({ ignoreUnescapedHTML: true }); return h; }); }
function loadKatex(){
  return katexP ||= new Promise((ok, no) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/vendor/katex/katex.min.css"; document.head.appendChild(css);
    const sc = document.createElement("script"); sc.src = "/vendor/katex/katex.min.js"; sc.onload = () => ok(window.katex); sc.onerror = no; document.head.appendChild(sc);
  });
}
function enhance(root, final){
  for (const t of root.querySelectorAll("table")) if (!t.parentNode.classList.contains("tablewrap")) { const w = document.createElement("div"); w.className = "tablewrap"; t.replaceWith(w); w.appendChild(t); }
  for (const pre of root.querySelectorAll("pre")) {
    const code = pre.querySelector("code"); if (!code) continue;
    const lang = ((code.className.match(/language-([\w+#-]+)/) || [])[1] || "").toLowerCase();
    if (lang && !pre.dataset.lang) pre.dataset.lang = lang;
    if (lang === "luau") code.className = "language-lua";
  }
  addCodeCopy(root);
  if (!final) return;
  const codes = root.querySelectorAll("pre code:not(.hljs)");
  if (codes.length) loadHljs().then(h => { for (const c of codes) { if (!c.isConnected) continue; const known = /language-([\w+#-]+)/.exec(c.className); if (known && !h.getLanguage(known[1])) c.className = ""; try { h.highlightElement(c); } catch(_) {} } }).catch(() => {});
  const maths = root.querySelectorAll(".math:not(.done)");
  if (maths.length) loadKatex().then(k => { for (const el of maths) { try { k.render(el.dataset.tex, el, { displayMode: el.classList.contains("big"), throwOnError: false, trust: false, strict: "ignore" }); el.classList.add("done"); } catch(_) {} } }).catch(() => {});
}

// Orb characters: flat shape per orb, slanted dash eyes, no mouth, animated accessory
const INK = "#1d1c1a";
const ORB = {
  tech: { shape:`<rect x="19" y="36" width="62" height="55" rx="27"/>`, ey:60, tilt:0,
    acc:`<g class="o-wifi" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"><path class="w1" d="M44 25.5a8 8 0 0 1 12 0"/><path class="w2" d="M38 19.5a16 16 0 0 1 24 0"/><path class="w3" d="M32 13.5a24 24 0 0 1 36 0"/></g><circle cx="50" cy="31" r="3.2" fill="currentColor"/>` },
  cook: { shape:`<path d="M14 76C14 52 30 40 50 40S86 52 86 76C86 88 74 92 50 92S14 88 14 76Z"/>`, ey:66, tilt:16,
    acc:`<g class="o-hat o-dk"><circle cx="38" cy="27" r="10" fill="#fff"/><circle cx="62" cy="27" r="10" fill="#fff"/><circle cx="50" cy="20" r="13" fill="#fff"/>
      <rect x="33" y="29" width="34" height="15" rx="4" fill="#fff"/></g>
      <g class="o-steam" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M86 44c-4-4 4-7 0-12"/><path class="s2" d="M93 54c-3-3 3-6 0-10"/></g>` },
  game: { shape:`<path d="M50 38C70 38 80 42 81 54C82 64 88 72 86 82C84 91 72 93 66 86C62 81 58 79 50 79S38 81 34 86C28 93 16 91 14 82C12 72 18 64 19 54C20 42 30 38 50 38Z"/>`, ey:57, tilt:-18,
    acc:`<g class="o-dk"><path d="M24 50C24 27 76 27 76 50" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
      <rect x="14" y="41" width="13" height="21" rx="5.5" fill="${INK}"/><rect x="73" y="41" width="13" height="21" rx="5.5" fill="${INK}"/>
      <rect class="o-rgb" x="17" y="45" width="4" height="13" rx="2"/><rect class="o-rgb" x="79" y="45" width="4" height="13" rx="2"/>
      <path d="M20 62Q21 75 33 75" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><circle class="o-rgb" cx="35" cy="75" r="3.6"/></g>` },
  web: { shape:`<path d="M50 34C69 34 82 46 82 62S69 90 50 90C45 90 40 89 36 87C31 90 25 92 21 91C19.5 90.5 19.8 89 21 88C23 86 24.5 83 25 80C20.5 75 18 69 18 62C18 46 31 34 50 34Z"/>`, ey:61, tilt:12,
    acc:`<g><path d="M29 44C29 32 38 28 50 28V44Z" fill="#ff5a5f"/><path d="M50 28C62 28 71 32 71 44H50Z" fill="#3fb5ff"/>
      <rect class="o-dk" x="26" y="42" width="48" height="5.5" rx="2.75" fill="${INK}"/><rect x="48.8" y="17" width="2.4" height="12" fill="${INK}"/>
      <g class="o-prop"><path d="M50 17C44 13.5 36 14.5 36 17S44 20.5 50 17Z" fill="#ffd23f"/><path d="M50 17C56 13.5 64 14.5 64 17S56 20.5 50 17Z" fill="#ff8a3d"/></g>
      <circle cx="50" cy="17" r="2.6" fill="${INK}"/></g>
      <text class="o-tag" x="73" y="31" font-family="ui-monospace,Menlo,monospace" font-size="13" font-weight="800" fill="currentColor">&lt;/&gt;</text>` },
  write: { shape:`<path d="M47.5 27.5C49 25 51 25 52.5 27.5C61 41 76 51 76 67C76 81 64 92 50 92S24 81 24 67C24 51 39 41 47.5 27.5Z"/>`, ey:66, tilt:-10,
    acc:`<path class="o-ink" d="M62 91q3-5 6 0t6 0t6 0t6 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
      <g transform="translate(62 90)"><g class="o-pen"><path class="o-dk" d="M0 0L15-31C24-28 26-12 5-3Z" fill="#fff"/><path d="M0 0L17-35" stroke="${INK}" stroke-width="2" stroke-linecap="round"/></g></g>` },
  study: { shape:`<path d="M50 26C65 26 76 37 76 51C76 61 70 67 66 72C63.5 75 63 77 63 80H37C37 77 36.5 75 34 72C30 67 24 61 24 51C24 37 35 26 50 26Z"/>`, ey:52, tilt:0,
    back:() => `<circle class="o-glow" cx="50" cy="51" r="31" fill="#ffe36b"/>`,
    acc:`<rect x="36" y="80" width="28" height="5.5" rx="2.75" fill="#9aa3ad"/><rect x="37.5" y="86.5" width="25" height="5" rx="2.5" fill="#7f8994"/><rect x="44" y="92.5" width="12" height="4" rx="2" fill="#5f6873"/>
      <g class="o-rays" stroke="#ffc400" stroke-width="3.6" stroke-linecap="round"><path d="M50 13v-6"/><path d="M69 19l4-4.5"/><path d="M31 19l-4-4.5"/><path d="M81 34l5.5-2.5"/><path d="M19 34l-5.5-2.5"/></g>` },
  music: { shape:`<rect x="13" y="44" width="74" height="47" rx="17"/>`, ey:61, tilt:10,
    acc:`<path d="M31 44V37Q31 31 37 31H63Q69 31 69 37V44" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" class="o-dk"/>
      <g class="o-spk"><circle cx="26" cy="74" r="8.5" fill="${INK}"/><circle cx="26" cy="74" r="3.6" fill="currentColor"/></g>
      <g class="o-spk"><circle cx="74" cy="74" r="8.5" fill="${INK}"/><circle cx="74" cy="74" r="3.6" fill="currentColor"/></g>
      <rect x="39" y="75" width="22" height="10" rx="3" fill="${INK}"/>
      <g class="o-eq" fill="currentColor"><rect x="42" y="77" width="3" height="6" rx="1"/><rect x="47" y="77" width="3" height="6" rx="1"/><rect x="52" y="77" width="3" height="6" rx="1"/><rect x="57" y="77" width="1.5" height="6" rx=".7"/></g>
      <g class="o-note" fill="currentColor" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M80 34V20l9-2.5v12" fill="none"/><ellipse cx="77" cy="34" rx="3.8" ry="3" stroke="none"/><ellipse cx="86" cy="30" rx="3.8" ry="3" stroke="none"/></g>
      <g class="o-note n2" fill="currentColor" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M18 34V20q6 2 7 7" fill="none"/><ellipse cx="15" cy="34" rx="3.8" ry="3" stroke="none"/></g>` },
  lang: { shape:`<path d="M50 36C68 36 79 48 79 61S68 86 50 86 21 74 21 61 32 36 50 36Z"/>`, ey:60, tilt:0,
    acc:`<path d="M37 40C29 50 29 72 37 83M63 40C71 50 71 72 63 83" fill="none" stroke="#000" stroke-opacity=".16" stroke-width="2.4"/>
      <path d="M50 30V19" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" class="o-dk"/><circle cx="50" cy="17.5" r="2.6" fill="none" stroke="${INK}" stroke-width="2" class="o-dk"/>
      <rect x="35" y="30" width="30" height="8" rx="3" fill="#ffc233"/><rect x="37" y="84" width="26" height="7" rx="3" fill="#ffc233"/>
      <g class="o-tassel" stroke="#ffc233" stroke-width="2.2" stroke-linecap="round"><path d="M50 91v3"/><path d="M47 94l-1 6M50 94v6.5M53 94l1 6"/></g>
      <g class="o-say"><rect class="o-dk" x="72" y="10" width="23" height="19" rx="8" fill="#fff"/><path d="M76 27l-3 7 9-5z" fill="#fff"/><text x="83.5" y="24.5" text-anchor="middle" font-size="13" font-weight="800" font-family="system-ui,sans-serif" fill="#111">A</text></g>
      <g class="o-say b2"><rect class="o-dk" x="5" y="10" width="23" height="19" rx="8" fill="#fff"/><path d="M24 27l3 7-9-5z" fill="#fff"/><text x="16.5" y="24.5" text-anchor="middle" font-size="12.5" font-weight="800" font-family="'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif" fill="#111">文</text></g>` },
  neb: { shape:`<circle cx="50" cy="56" r="25"/>`, ey:56, tilt:0,
    back:() => { const id = "nbg" + (++nebN); return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f7bff"/><stop offset=".5" stop-color="#9b5cff"/><stop offset="1" stop-color="#ff5fb8"/></linearGradient></defs>
      <g class="o-swirl"><circle cx="50" cy="56" r="34" fill="none" stroke="url(#${id})" stroke-width="13" opacity=".22"/><circle cx="50" cy="56" r="34" fill="none" stroke="url(#${id})" stroke-width="5" stroke-linecap="round" stroke-dasharray="150 64"/></g>
      <g class="o-swirl2"><circle cx="50" cy="56" r="41" fill="none" stroke="url(#${id})" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="26 18" opacity=".85"/></g>
      <g class="o-stars" fill="#9b5cff"><circle cx="14" cy="22" r="1.9"/><circle cx="88" cy="28" r="1.5"/><circle cx="86" cy="90" r="1.9"/></g>`; },
    acc:`` }
};
let nebN = 0;
function orbSVG(k){
  const o = ORB[k], y = o.ey;
  const eye = x => `<rect x="${x-3}" y="${y-8.5}" width="6" height="17" rx="3" fill="${k === "neb" ? "var(--neb-eye)" : "#111"}" transform="rotate(${o.tilt} ${x} ${y})"/>`;
  return `<svg class="orb orb-${k}" viewBox="0 0 100 100" aria-hidden="true" style="color:var(${BOTS[k].color})">
    <g class="o-hop"><g class="o-extra"><g class="o-squish">
      ${o.back ? o.back() : ""}<g fill="var(${BOTS[k].color})">${o.shape}</g>
      <g class="o-eyes"><g class="o-lids">${eye(42)}${eye(58)}</g></g>
      ${o.acc}
    </g></g></g></svg>`;
}
function orbInto(el, k){ if (!el || !k) return; el.innerHTML = orbSVG(k); el.classList.add("has-orb"); }

function setAccent(){
  if (active) document.documentElement.style.setProperty("--c-active", `var(${BOTS[active].color})`);
  else document.documentElement.style.removeProperty("--c-active");
}

function renderPicker(){
  const wrap = $("bots"); wrap.innerHTML = "";
  for (const k of ORDER) {
    const b = BOTS[k], el = document.createElement("button");
    el.type = "button"; el.className = "bot"; el.id = "pick-" + k;
    el.setAttribute("aria-pressed", String(k === active));
    el.style.setProperty("--c", `var(${b.color})`);
    el.innerHTML = `<span class="g"></span><span class="n"></span><span class="r"></span>`;
    orbInto(el.querySelector(".g"), k);
    el.querySelector(".n").textContent = b.name;
    el.querySelector(".r").textContent = b.role;
    el.onclick = () => pick(k);
    wrap.appendChild(el);
  }
  const chips = $("chips"); chips.innerHTML = "";
  if (active) for (const c of BOTS[active].chips) {
    const ch = document.createElement("button"); ch.type = "button"; ch.className = "chip"; ch.textContent = c;
    ch.onclick = () => send(c); chips.appendChild(ch);
  }
}

function renderHome(){
  app.dataset.view = "home"; log.innerHTML = "";
  const mark = $("mark");
  $("greet").textContent = greeting();
  if (active) {
    const b = BOTS[active];
    mark.className = "mark"; orbInto(mark, active);
    box.disabled = false; form.classList.remove("locked");
    box.placeholder = b.ask;
  } else {
    mark.className = "mark empty"; mark.innerHTML = ""; mark.textContent = "?";
    box.disabled = true; form.classList.add("locked");
    box.placeholder = "Pick an orb below to start…";
  }
  stopSpeak(); setAccent(); renderPicker(); updateSend(); snap(); renderSide(); renderIncog();
}
// Incognito switch (top right on the home screen)
function renderIncog(){
  const home = app.dataset.view === "home", btn = $("incogBtn");
  btn.hidden = !home || !user; btn.setAttribute("aria-pressed", String(incogNext)); btn.classList.toggle("on", incogNext);
  btn.title = incogNext ? "Turn off incognito" : "Incognito chat (not saved)";
  app.classList.toggle("incog", home && incogNext);
  if (home) {
    $("greet").textContent = incogNext ? "Incognito chat" : greeting();
    $("incogNote").hidden = !incogNext;
  }
}
$("incogBtn").onclick = () => { if (busy) return; incogNext = !incogNext; renderIncog(); box.focus(); };

const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>', RETRY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
const SPEAK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>';
const UP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z"/></svg>';
const DOWN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3"/><path d="M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9z"/></svg>';
function fmtTime(t){
  if (!t) return "";
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday " + time;
  return d.toLocaleDateString([], { month:"short", day:"numeric" }) + ", " + time;
}
async function copyText(txt, btn){
  let ok = false;
  try { await navigator.clipboard.writeText(txt); ok = true; } catch(e) {
    try { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove(); } catch(_) {}
  }
  const old = btn.innerHTML; btn.textContent = ok ? "Copied" : "Couldn't copy"; btn.classList.add("done");
  setTimeout(() => { btn.innerHTML = old; btn.classList.remove("done"); }, 1400);
}
function addCodeCopy(root){
  for (const pre of root.querySelectorAll("pre")) {
    if (pre.querySelector(".cbtn")) continue;
    const b = document.createElement("button"); b.type = "button"; b.className = "cbtn"; b.textContent = "Copy";
    b.onclick = () => copyText(pre.querySelector("code")?.innerText || pre.innerText, b);
    pre.appendChild(b);
  }
}
const FLAG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>';
let reportText = "";
function openReport(text){ reportText = String(text || "").slice(0, 4000); $("repReason").value = ""; $("repMsg").textContent = ""; $("repSend").disabled = false; openLegal("reportModal"); }
function actBtn(svg, label, fn){ const b = document.createElement("button"); b.type = "button"; b.className = "act"; b.innerHTML = svg; b.title = label; b.setAttribute("aria-label", label); b.onclick = () => fn(b); return b; }
// A button that needs a second tap before it does something that can't be undone
function armed(btn, label, fn){
  if (btn.dataset.armed) { fn(); return; }
  const old = btn.innerHTML; btn.dataset.armed = "1"; btn.classList.add("done", "warn"); btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.innerHTML = old; btn.classList.remove("done", "warn"); } }, 3500);
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// Thinking, web searches and sources that go with a reply
function thinkBox(text, secs, live){
  const d = el("details", "thinkbox"); if (live) d.open = true;
  const sum = el("summary", null, live ? "Thinking…" : secs ? `Thought for ${secs}s` : "Thought process");
  const body = el("div", "thinktext"); body.innerHTML = md(text || "");
  d.append(sum, body); return d;
}
function searchedLine(qs){ const d = el("div", "searched"); d.textContent = "🔎 Searched the web: " + qs.map(q => "“" + q + "”").join(", "); return d; }
function safeUrl(u){ try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x : null; } catch(_) { return null; } }
function sourcesBox(src){
  const box = el("div", "sources"); box.appendChild(el("span", "slabel", "Sources"));
  const seen = new Set();
  for (const s of src) {
    const x = safeUrl(s.u); if (!x || seen.has(x.href)) continue; seen.add(x.href);
    const a = el("a", "src", x.hostname.replace(/^www\./, "")); a.href = x.href; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.title = s.t || x.href;
    box.appendChild(a);
  }
  return box;
}

// One message row. User: bubble on the right. Orb: formatted text, full width, with actions underneath.
function bubble(role, turn, idx, isLast){
  const b = BOTS[active], conv = curConv();
  const row = el("div", "row " + (role === "user" ? "me" : "bot-row"));
  row.style.setProperty("--c", `var(${b.color})`);
  const col = el("div", "col");
  const m = el("div", "msg");
  if (role === "user") {
    if (Array.isArray(turn.files) && turn.files.length) {
      const fl = el("div", "msgfiles");
      for (const f of turn.files) fl.appendChild(el("span", null, (f.kind === "image" ? "🖼️ " : f.kind === "pdf" ? "📄 " : "📎 ") + f.name));
      col.appendChild(fl);
    }
    m.textContent = turn.content; col.appendChild(m);
  } else {
    if (turn.th) col.appendChild(thinkBox(turn.th, turn.tm));
    if (Array.isArray(turn.q) && turn.q.length) col.appendChild(searchedLine(turn.q));
    m.innerHTML = md(splitOptions(turn.content).body); col.appendChild(m);
    if (Array.isArray(turn.src) && turn.src.length) col.appendChild(sourcesBox(turn.src));
    if (isLast && !busy) {
      const opts = splitOptions(turn.content).options;
      if (opts.length) {
        const o = el("div", "opts");
        for (const label of opts) { const btn = el("button", "opt", label); btn.type = "button"; btn.onclick = () => send(label); o.appendChild(btn); }
        col.appendChild(o);
      }
    }
  }
  const meta = el("div", "meta" + (isLast ? " show" : ""));
  const ts = el("span", "ts", fmtTime(turn.t));
  if (role === "user") {
    meta.append(ts, actBtn(EDIT_SVG, "Edit message", () => startEdit(idx, row)), actBtn(COPY_SVG, "Copy message", btn => copyText(turn.content, btn)));
  } else {
    meta.append(actBtn(COPY_SVG, "Copy reply", btn => copyText(splitOptions(turn.content).body, btn)));
    if (TTS) meta.append(actBtn(SPEAK_SVG, "Read aloud", btn => toggleSpeak(splitOptions(turn.content).body, btn)));
    const up = actBtn(UP_SVG, "Good reply", () => vote(conv, turn, "up", up, down)), down = actBtn(DOWN_SVG, "Bad reply", () => vote(conv, turn, "down", up, down));
    up.classList.toggle("on", turn.fb === "up"); down.classList.toggle("on", turn.fb === "down");
    meta.append(up, down);
    meta.append(actBtn(RETRY_SVG, isLast ? "Try again" : "Redo from here", btn => isLast ? retry(idx) : armed(btn, "Redo? Later messages go away", () => retry(idx))));
    meta.append(actBtn(FLAG_SVG, "Report this reply", () => openReport(turn.content)));
    meta.append(ts);
  }
  col.appendChild(meta);
  row.appendChild(col); log.appendChild(row);
  if (role !== "user") enhance(m, true);
  return row;
}
// The reply that's being written right now
function liveReply(){
  const b = BOTS[active];
  const row = el("div", "row bot-row"); row.style.setProperty("--c", `var(${b.color})`);
  const col = el("div", "col"), think = thinkBox("", 0, true), searched = el("div", "searched"), msg = el("div", "msg"), src = el("div");
  think.hidden = true; searched.hidden = true;
  col.append(think, searched, msg, src); row.appendChild(col); log.appendChild(row);
  return { row, think, searched, msg, src };
}
// The orb sits under the newest reply (like the Claude app); older replies stay still.
function tailOrb(thinking){
  log.querySelector(".tail")?.remove();
  const t = document.createElement("div"); t.className = "tail" + (thinking ? " think" : "");
  const g = document.createElement("div"); g.className = "av"; orbInto(g, active); t.appendChild(g);
  log.appendChild(t); return t;
}

function renderChat(){
  const c = curConv(); if (!c) { renderHome(); return; }
  active = c.orb; webOn = !!c.web;
  app.dataset.view = "chat";
  const b = BOTS[active];
  orbInto($("topGlyph"), active); $("topName").textContent = b.name; $("topRole").textContent = c.incog ? "Incognito chat" : c.title || b.role;
  $("incogTag").hidden = !c.incog;
  box.disabled = false; form.classList.remove("locked");
  box.placeholder = `Reply to ${b.name}…`;
  setAccent();
  log.innerHTML = "";
  if (c.incog) log.appendChild(el("div", "incognote", "🕶️ Incognito chat. It won't be saved, and it disappears when you leave."));
  const turns = c.turns;
  turns.forEach((t, i) => {
    bubble(t.role === "user" ? "user" : "assistant", t, i, i === turns.length - 1);
    if (credits && i === 19 && turns.length > 20) log.appendChild(el("div", "incognote", "💬 This chat got long. From here on, each message costs 1 extra credit. Start a new chat to save credits."));
  });
  if (turns.length && turns[turns.length - 1].role === "assistant" && !busy) tailOrb(false);
  log.scrollTop = log.scrollHeight;
  updateSend(); snap(); renderSide(); renderIncog();
}

// Incognito chats are never saved and vanish when you leave them
function dropIncog(keep){ for (const id of Object.keys(convs)) if (convs[id].incog && id !== keep) delete convs[id]; }
function pick(k){
  if (busy) return;
  dropIncog(null);
  active = k; cur = null; status.textContent = ""; webOn = false;
  renderHome();
  const mark = $("mark"); mark.classList.remove("pop"); void mark.offsetWidth; mark.classList.add("pop"); setTimeout(() => mark.classList.remove("pop"), 600);
  box.focus();
}
function openConv(id){
  if (busy || !convs[id]) return;
  dropIncog(id); stopSpeak();
  cur = id; active = convs[id].orb; status.textContent = ""; box.value = ""; autosize();
  renderChat(); if (mobile()) setSide(false);
}

function updateSend(){
  if (busy) { sendBtn.disabled = false; sendBtn.setAttribute("aria-label","Stop");
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'; return; }
  sendBtn.setAttribute("aria-label","Send");
  sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  sendBtn.disabled = !active || (!box.value.trim() && !pendingFiles.length);
}

const ERR = {
  unauthenticated:"You got signed out. Sign in again.",
  unverified:"Verify your email first, then try again.",
  bad_request:"That message didn't go through. Try again.",
  site_busy:"Orbs used up its daily budget for everyone. Try again tomorrow.",
  overloaded:"Claude is super busy right now. Try again in a minute.",
  upstream_error:"Something went wrong reaching Claude. Try again.",
  not_configured:"The site isn't fully set up yet. The owner needs to add the keys on Vercel.",
  server_error:"Orbs had a server problem. Try again.",
  out_of_funds:"Orbs ran out of Claude money!! 😤💢 Tell the owner to add more, baka!",
  paused:"Orbs is taking a little break right now. Try again later!",
  banned:"This account can't chat on Orbs anymore.",
  network:"Can't reach Orbs. Check your internet connection."
};
const NOSEARCH = { kids:"Web search is off in Kids Mode, so that answer didn't search the web.", off:"Web search is turned off on Orbs right now, so that answer didn't search the web.", limit:"You've used all your web searches for today, so that answer didn't search the web. They refill at midnight." };

// Files sent with each message, kept on this device so "Try again" and edits can send them again
const fileStore = {};
async function send(text, regen, filesOverride){
  text = (text || "").trim();
  if (!active) { nudge(); return; }
  if ((!text && !regen && !pendingFiles.length && !filesOverride) || busy) return;
  if (!user) return;
  const key = active, b = BOTS[key], mi = pf(key).m, model = MODELS[mi];
  if (lockedModel(mi)) { status.textContent = `${model.n} needs Orbs ${PLAN_NAMES[needPlan(mi)]}. Upgrade, or pick Koa or Lumina.`; openPlans(); return; }
  if (credits && credits.left < estimate(key, { regen, files: filesOverride }).total) { creditShort(model); return; }
  // Start a new chat if none is open for this orb
  if (!curConv() || curConv().orb !== key) {
    const id = (incogNext ? "x_" : "") + newId(), now = Date.now();
    convs[id] = { id, orb:key, title:"", turns:[], created:now, updated:now, web:webOn, ...(incogNext ? { incog:true } : {}) };
    cur = id; incogNext = false;
  }
  const cid = cur, conv = convs[cid];
  let files = [];
  if (!regen) {
    if (filesOverride) files = filesOverride; else { files = pendingFiles; pendingFiles = []; renderAtts(); }
    if (!text) text = "Here are my files.";
    const turn = { role:"user", content:text, t:Date.now() };
    if (files.length) { turn.files = files.map(f => ({ name:f.name, kind:f.kind })); fileStore[turn.t] = files; }
    conv.turns.push(turn);
    if (!conv.title) conv.title = titleFrom(text);
  } else { const lastU = conv.turns[conv.turns.length - 1] || {}; files = lastU.files ? (fileStore[lastU.t] || []) : []; }
  conv.updated = Date.now();
  save(); stopSpeak();
  box.value = ""; autosize();
  renderChat();
  const live = liveReply();
  const tail = tailOrb(true);
  log.scrollTop = log.scrollHeight;
  busy = true; status.textContent = ""; updateSend();
  ctl = new AbortController();
  const ctx = conv.turns.slice(-30).map(t => ({ role:t.role, content:t.content }));
  while (ctx.length && ctx[0].role !== "user") ctx.shift();
  let reply = "", thinking = "", thinkStart = 0, thinkSecs = 0, queries = [], sources = [], noSearch = null, raf = 0;
  const paint = () => {
    raf = 0;
    if (thinking) { live.think.hidden = false; live.think.querySelector(".thinktext").innerHTML = md(thinking); }
    if (reply) { live.msg.innerHTML = md(splitOptions(reply).body); enhance(live.msg, false); }
    stickBottom();
  };
  const later = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const extras = () => {
    const o = { m: mi };
    if (thinking) { o.th = thinking.slice(0, 20000); if (thinkSecs) o.tm = thinkSecs; }
    if (queries.length) o.q = queries.slice(0, 5);
    if (sources.length) o.src = sources.slice(0, 10);
    return o;
  };
  try {
    const token = await user.getIdToken();
    let res;
    try {
      res = await fetch("/api/chat", {
        method:"POST",
        headers:{ "content-type":"application/json", authorization:"Bearer " + token },
        body: JSON.stringify({ orb:key, model:mi, effort:pf(key).e, messages:ctx, think: opts.think !== false, web: !!webOn,
          ...(ctx.length === 1 && !conv.incog && !conv.renamed ? { title: true } : {}),
          ...(files.length ? { attachments: files.map(f => f.kind === "text" ? { kind:"text", name:f.name, text:f.text } : { kind:f.kind, name:f.name, media_type:f.media_type, data:f.data }) } : {}) }),
        signal: ctl.signal
      });
    } catch (e) { throw { code: e && e.name === "AbortError" ? "cancelled" : "network" }; }
    if (!res.ok) { let j = {}; try { j = await res.json(); } catch(_) {} throw { code: res.status === 413 ? "files_too_big" : (j.error || "upstream_error"), left: j.left, msg: j.msg, needName: j.needName }; }
    // The server sends one small JSON object per line: {d:"text"} {t:"thinking"} {q:"search"} {src:[...]} ... then {done:true} or {error:"..."}
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", end = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream:true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch(_) { continue; }
          if (typeof ev.d === "string") {
            if (!reply && thinking && live.think.open) { thinkSecs = Math.max(1, Math.round((Date.now() - thinkStart) / 1000)); live.think.open = false; live.think.querySelector("summary").textContent = `Thought for ${thinkSecs}s`; }
            reply += ev.d; tail.classList.remove("think"); later();
          }
          else if (typeof ev.t === "string") { if (!thinking) thinkStart = Date.now(); thinking += ev.t; later(); }
          else if (typeof ev.q === "string") { queries.push(ev.q); live.searched.hidden = false; live.searched.textContent = "🔎 Searching the web: " + queries.map(q => "“" + q + "”").join(", "); stickBottom(); }
          else if (Array.isArray(ev.src)) { for (const x of ev.src) if (x && typeof x.u === "string" && sources.length < 10 && !sources.some(y => y.u === x.u)) sources.push({ u: x.u, t: String(x.t || "") }); live.src.replaceChildren(sourcesBox(sources)); }
          else if (typeof ev.nosearch === "string") noSearch = ev.nosearch;
          else if (typeof ev.title === "string") { if (!conv.renamed && ev.title.trim()) { conv.title = ev.title.trim().slice(0, 80); if (cur === cid) $("topRole").textContent = conv.title; renderSide(); } }
          else end = ev;
        }
      }
    } catch (e) { throw { code: e && e.name === "AbortError" ? "cancelled" : "network", text: reply }; }
    if (!end) throw { code:"upstream_error", text: reply };
    if (end.error) throw { code:end.error, left:end.left, text: reply };
    setCredits(end.left);
    if (end.refused && !reply.trim()) throw { code:"refused" };
    conv.turns.push({ role:"assistant", content:reply, t:Date.now(), ...extras() }); conv.updated = Date.now(); save(); limitHit = false; renderUsage();
    if (end.truncated) status.textContent = "That answer got cut off. Ask for a shorter one.";
    else if (end.refused) status.textContent = "The orb stopped there. Try asking a different way.";
    else if (noSearch && NOSEARCH[noSearch]) status.textContent = NOSEARCH[noSearch];
  } catch (e) {
    const code = e && e.code || "upstream_error";
    if (typeof (e && e.left) === "number") setCredits(e.left);
    if (e && e.text) { conv.turns.push({ role:"assistant", content:e.text, t:Date.now(), ...extras() }); save(); }
    if (code === "cancelled") status.textContent = "Stopped.";
    else if (code === "plan_model") { status.textContent = `${model.n} needs Orbs ${e.needName || "Plus"}. Upgrade, or pick Koa or Lumina.`; refreshStatus(); openPlans(); }
    else if (code === "month_limit") { limitHit = true; renderUsage(); status.textContent = "You've used all your credits for this month." + (kids.billing ? " Upgrade for more!" : ""); }
    else if (code === "limit_reached") { if (credits && credits.left > 0) creditShort(model); else { limitHit = true; renderUsage(); status.textContent = "You're out of credits for today."; } }
    else if (code === "refused") status.textContent = "The orb couldn't answer that one. Try asking a different way.";
    else if (code === "kids_personal_info" || code === "kids_blocked" || code === "kids_no_media" || code === "files_too_big") {
      // Take the message back out of the chat (and don't save it)
      const t = conv.turns, lastTurn = t[t.length - 1];
      if (lastTurn && lastTurn.role === "user" && !regen) {
        t.pop(); save();
        if (code !== "kids_blocked") { box.value = lastTurn.content === "Here are my files." ? "" : lastTurn.content; autosize(); pendingFiles = code === "kids_no_media" ? files.filter(f => f.kind === "text") : files; renderAtts(); }
      }
      status.textContent = code === "kids_personal_info" ? "🛡️ Kids Mode: please don't share personal info like phone numbers, emails, or addresses. Take it out and try again."
        : code === "kids_blocked" ? "🛡️ Kids Mode: that topic isn't allowed. Try asking about something else!"
        : code === "kids_no_media" ? "🛡️ Kids Mode only allows text and code files, not pictures or PDFs."
        : "Those files are too big to send. Try fewer or smaller files.";
    }
    else if (code === "kids_reply_blocked") status.textContent = "🛡️ Kids Mode hid that reply because it wasn't kid-safe. Try asking a different way.";
    else if (code === "safety_unavailable") status.textContent = "The safety check couldn't finish. Try again in a moment.";
    else if (code === "age_required" || code === "blocked_age" || code === "banned") { const u = user; user = null; enter(u); }
    else if (code === "paused" && e.msg) status.textContent = "Orbs is taking a break: " + e.msg;
    else status.textContent = ERR[code] || ERR.upstream_error;
  } finally {
    if (raf) cancelAnimationFrame(raf);
    busy = false; ctl = null;
    if (!conv.turns.length) { delete convs[cid]; if (cur === cid) cur = null; }
    if (cur === cid) renderChat(); else if (!cur && active === key) renderHome(); else { updateSend(); renderSide(); }
  }
}

function creditShort(model){
  const ex = active ? estimate(active).total - msgCost(pf(active)) : 0;
  const cheaper = MODELS.filter(m => m.cost + ex <= (credits ? credits.left : 0)).pop();
  if (!cheaper) { limitHit = true; renderUsage(); status.textContent = "You're out of credits for today."; return; }
  status.textContent = `Not enough credits left for ${model.n} today. Switch to ${cheaper.n} to keep chatting.`;
}

// Redo: drop this reply (and anything after it), then ask again
function retry(idx){
  if (busy || !curConv()) return;
  const turns = curConv().turns;
  if (typeof idx === "number" && idx >= 0 && idx < turns.length) turns.splice(idx);
  else if (turns.length && turns[turns.length - 1].role === "assistant") turns.pop();
  if (!turns.length || turns[turns.length - 1].role !== "user") return;
  save(); send("", true);
}
// Edit a message you sent: everything after it is replaced by a new answer
function startEdit(idx, row){
  const c = curConv(); if (busy || !c || !c.turns[idx]) return;
  const turn = c.turns[idx];
  const col = row.querySelector(".col"); col.innerHTML = ""; row.classList.add("editing");
  const ta = el("textarea", "editbox"); ta.value = turn.content; ta.setAttribute("aria-label", "Edit your message");
  const files = turn.files ? fileStore[turn.t] : null;
  const note = el("small", "fine editnote", turn.files ? (files ? "Your files will be sent again." : "Files from this message can't be sent again. Attach them again if you need them.") : "Sending this replaces the replies after it.");
  const bar = el("div", "editbar"), cancel = el("button", "outline", "Cancel"), go = el("button", "gbtn", "Send");
  cancel.type = go.type = "button";
  cancel.onclick = () => renderChat();
  go.onclick = () => {
    const txt = ta.value.trim(); if (!txt || busy) return;
    c.turns = c.turns.slice(0, idx); save();
    send(txt, false, files || []);
  };
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); go.click(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); renderChat(); } };
  bar.append(note, cancel, go); col.append(ta, bar);
  ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 4, 320) + "px";
  ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 4, 320) + "px"; };
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

// ---------- Thumbs up / down ----------
let fbTurn = null, fbConv = null;
async function postFeedback(body){
  try { const token = await user.getIdToken(); await fetch("/api/feedback", { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer " + token }, body: JSON.stringify(body) }); } catch(_) {}
}
function vote(conv, turn, dir, up, down){
  if (!conv || !user) return;
  const next = turn.fb === dir ? null : dir;
  if (next) turn.fb = next; else delete turn.fb;
  up.classList.toggle("on", next === "up"); down.classList.toggle("on", next === "down");
  save();
  postFeedback({ key: conv.id + ":" + turn.t, orb: conv.orb, model: Number.isInteger(turn.m) ? turn.m : pf(conv.orb).m, vote: next });
  if (next === "up") status.textContent = "Thanks! Glad that helped.";
  if (next === "down") { fbTurn = turn; fbConv = conv; $("fbReason").value = ""; $("fbShare").checked = false; $("fbMsg").textContent = ""; $("fbSend").disabled = false;
    for (const b of document.querySelectorAll("#fbTags button")) b.setAttribute("aria-pressed", "false"); openLegal("fbModal"); }
}
for (const b of document.querySelectorAll("#fbTags button")) b.onclick = () => { for (const o of document.querySelectorAll("#fbTags button")) o.setAttribute("aria-pressed", String(o === b)); };
$("fbSend").onclick = () => busyBtn($("fbSend"), async () => {
  if (!fbTurn || !fbConv) return;
  const tag = document.querySelector('#fbTags button[aria-pressed="true"]')?.dataset.tag;
  await postFeedback({ key: fbConv.id + ":" + fbTurn.t, orb: fbConv.orb, model: Number.isInteger(fbTurn.m) ? fbTurn.m : pf(fbConv.orb).m, vote: "down",
    ...(tag ? { tag } : {}), reason: $("fbReason").value.trim().slice(0, 300), ...($("fbShare").checked ? { reply: String(fbTurn.content).slice(0, 4000) } : {}) });
  $("fbMsg").textContent = "Thanks! That helps make Orbs better."; $("fbSend").disabled = true; setTimeout(closeLegal, 1100);
});

// ---------- Read aloud (free, built into the browser) ----------
const TTS = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let speakBtn = null;
function speechText(src){
  return String(src || "")
    .replace(/```[\s\S]*?(```|$)/g, " (code block) ")
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, " (math) ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ").trim();
}
function chunks(text){
  const parts = text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [text], out = [];
  let cur = "";
  for (const p of parts) { if ((cur + p).length > 200 && cur) { out.push(cur); cur = ""; } cur += p; }
  if (cur.trim()) out.push(cur);
  return out;
}
function pickVoice(lang){
  const vs = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  return vs.find(v => /natural|google|premium|enhanced/i.test(v.name)) || vs.find(v => v.default) || vs[0] || null;
}
function stopSpeak(){
  if (!TTS) return;
  if (speakBtn) { speakBtn.innerHTML = SPEAK_SVG; speakBtn.classList.remove("on"); speakBtn.title = "Read aloud"; speakBtn = null; }
  speechSynthesis.cancel();
}
function toggleSpeak(text, btn){
  if (speakBtn === btn) { stopSpeak(); return; }
  stopSpeak();
  const list = chunks(speechText(text)); if (!list.length) return;
  speakBtn = btn; btn.innerHTML = STOP_SVG; btn.classList.add("on"); btn.title = "Stop reading";
  list.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    const cjk = (c.match(/[㐀-鿿]/g) || []).length;
    u.lang = cjk > c.length * 0.2 ? "zh-CN" : (navigator.language || "en-US");
    const v = pickVoice(u.lang); if (v) u.voice = v;
    if (i === list.length - 1) u.onend = u.onerror = () => { if (speakBtn === btn) stopSpeak(); };
    speechSynthesis.speak(u);
  });
}
if (TTS) { speechSynthesis.getVoices(); window.addEventListener("pagehide", () => speechSynthesis.cancel()); }

// Keep following the reply while it streams, unless the person scrolled up to read
function stickBottom(){ if (log.scrollHeight - log.scrollTop - log.clientHeight < 140) log.scrollTop = log.scrollHeight; }
function nudge(){
  const p = $("picker"); p.classList.remove("nudge"); void p.offsetWidth; p.classList.add("nudge");
  status.textContent = "Pick an orb first!";
}

function autosize(){ box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 180) + "px"; }
box.addEventListener("input", () => { autosize(); updateSend(); });
box.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(box.value); } });
form.addEventListener("submit", e => { e.preventDefault(); if (busy) { ctl?.abort(); return; } send(box.value); });
form.addEventListener("click", () => { if (!active) nudge(); });
$("homeBtn").onclick = () => { if (busy) return; cur = null; dropIncog(null); webOn = false; renderHome(); };
let freshNext = false;
const shell = $("shell"), mobile = () => matchMedia("(max-width:760px)").matches;
function setSide(open){ shell.classList.toggle("closed", !open); try { if (!mobile()) localStorage.setItem("orbs-side", open ? "1" : "0"); } catch(e) {} }
let sideOpen = !mobile(); try { if (!mobile() && localStorage.getItem("orbs-side") === "0") sideOpen = false; } catch(e) {}
setSide(sideOpen);
$("hideBtn").onclick = () => { setSide(false); };
$("openBtn").onclick = () => setSide(true);
$("scrim").onclick = () => { setSide(false); };
$("sideNew").onclick = () => { if (busy) return; dropIncog(null); active = null; cur = null; webOn = false; incogNext = false; freshNext = true; status.textContent = ""; box.value = ""; renderHome(); if (mobile()) setSide(false); };
function openSet(){ if (user) kidsApi(user, { action:"status" }).then(() => { renderUsage(); renderKids(); renderPlan(); }).catch(() => {}); renderPlan(); $("settings").hidden = false; $("setBtn").setAttribute("aria-expanded", "true"); wipeArmed(false); killArmed(false); $("setMsg").textContent = ""; renderAccount(); renderUsage(); renderKids(); renderThinkSet(); }
// "Show thinking" switch
function renderThinkSet(){ const on = opts.think !== false; $("thinkSw").setAttribute("aria-checked", String(on)); $("thinkTxt").textContent = on ? "On" : "Off"; }
$("thinkSw").onclick = () => { opts = { ...opts, think: opts.think === false }; renderThinkSet(); cloudSave(); };
$("setBtn").onclick = openSet;
function closeSet(){ $("settings").hidden = true; $("setBtn").setAttribute("aria-expanded", "false"); wipeArmed(false); }
$("setClose").onclick = closeSet;
$("settings").addEventListener("click", e => { if (e.target === $("settings")) closeSet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("settings").hidden) closeSet(); });
function applyTheme(t){
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme");
  for (const b of document.querySelectorAll("#themeSeg button")) b.setAttribute("aria-pressed", String(b.dataset.t === t));
  try { localStorage.setItem("orbs-theme", t); } catch(e) {}
}
let savedTheme = "system"; try { savedTheme = localStorage.getItem("orbs-theme") || "system"; } catch(e) {}
applyTheme(savedTheme);
for (const b of document.querySelectorAll("#themeSeg button")) b.onclick = () => applyTheme(b.dataset.t);
let armTimer;
function wipeArmed(on){ const w = $("wipeBtn"); w.classList.toggle("armed", on); w.textContent = on ? "Tap again to delete" : "Delete all chats"; clearTimeout(armTimer); if (on) armTimer = setTimeout(() => wipeArmed(false), 4000); }
$("wipeBtn").onclick = () => {
  if (busy) return;
  if (!$("wipeBtn").classList.contains("armed")) { wipeArmed(true); return; }
  for (const id of Object.keys(convs)) deletedIds.add(id);
  convs = {}; cur = null; save(); wipeArmed(false);
  $("settings").hidden = true; active = null; renderHome(); status.textContent = "All chats deleted.";
};

let pins = [];
function item(k, sub){
  const b = BOTS[k], el = document.createElement("button");
  el.type = "button"; el.className = "nav" + (k === active ? " on" : ""); el.style.setProperty("--c", `var(${b.color})`);
  el.innerHTML = '<span class="g"></span><span class="tx"><b></b><small></small></span>';
  orbInto(el.querySelector(".g"), k); el.querySelector("b").textContent = b.name;
  const sm = el.querySelector("small"); if (sub) sm.textContent = sub; else sm.remove();
  el.onclick = () => { pick(k); if (mobile()) setSide(false); };
  return el;
}
const MODELS = [{n:"Koa",v:"1.01",cost:1,effort:false,base:"Claude Haiku 4.5",d:"fast and light, best for quick questions"},{n:"Lumina",v:"1.02",cost:3,effort:true,base:"Claude Sonnet 5.5",d:"balanced, good for everyday chats"},{n:"Chrysalis",v:"1.02",cost:6,effort:true,base:"Claude Opus 5.5",d:"slower but deeper, for harder problems"},{n:"Mythos",v:"1.02",cost:10,effort:true,base:"Claude Fable 5.1",d:"the most careful, takes its time"}];
const creditWord = n => n + (n === 1 ? " credit" : " credits");
let prefs = {};
// Real effort levels (the server maps these to Claude's low/medium/high/xhigh/max). Koa (Haiku) has no effort setting.
const EFFORTS = [{n:"Low",d:"quickest and cheapest, thinks a little",mult:1},{n:"Medium",d:"good balance for everyday chats",mult:1},{n:"High",d:"thinks things through more carefully",mult:2},{n:"Extra",d:"thinks a lot, slower and pricier",mult:3},{n:"Max",d:"thinks as hard as it can, slowest and most expensive",mult:4}];
const hasEffort = m => MODELS[m].effort !== false;
const msgCost = p => MODELS[p.m].cost * (hasEffort(p.m) ? EFFORTS[p.e].mult : 1);
// Extras on top (same rules as the server): long chat +1, web search +2 (given back if it doesn't search), big files +2
const EXTRA = { long: 1, web: 2, files: 2 };
function bigFiles(fs){
  if (!fs || !fs.length) return false;
  if (fs.length >= 6) return true;
  if (fs.some(f => f.kind === "pdf" && f.data && f.data.length > 1000000)) return true;
  return fs.reduce((n, f) => n + (f.kind === "text" ? f.text.length : 0), 0) > 100000;
}
function estimate(k, opts2 = {}){
  const p = pf(k), c = curConv();
  const count = (c && c.orb === k ? c.turns.length : 0) + (opts2.regen ? 0 : 1);
  const e = { base: msgCost(p), long: count > 20 ? EXTRA.long : 0, files: bigFiles(opts2.files || pendingFiles) ? EXTRA.files : 0,
    web: webOn && kids.web !== false && !kids.on ? EXTRA.web : 0 };
  e.total = e.base + e.long + e.files + e.web;
  return e;
}
function pf(k){
  if (!prefs || typeof prefs !== "object" || Object.isFrozen(prefs)) prefs = Object.assign({}, prefs || {});
  const old = prefs[k] && typeof prefs[k] === "object" ? prefs[k] : {};
  const okM = Number.isInteger(old.m) && old.m >= 0 && old.m < MODELS.length;
  const okE = Number.isInteger(old.e) && old.e >= 0 && old.e < EFFORTS.length;
  if (!okM || !okE || Object.isFrozen(old) || prefs[k] !== old) prefs[k] = { m: okM ? old.m : 1, e: okE ? old.e : 1 };
  return prefs[k];
}
function savePrefs(){ cloudSave(); }
function menuItem(title, cost, desc, selected, onPick){
  const it = document.createElement("button"); it.type = "button"; it.className = "mitem"; it.setAttribute("role","option"); it.setAttribute("aria-selected", String(selected));
  const b = document.createElement("b"), d = document.createElement("span"); b.textContent = title;
  if (cost) { const c = document.createElement("span"); c.className = "cost"; c.textContent = cost; b.appendChild(c); }
  d.textContent = desc; it.append(b, d); it.onclick = onPick; return it;
}
function closeMenus(){ for (const [m, b] of [["modelMenu","modelBtn"],["addMenu","addBtn"]]) { $(m).hidden = true; $(b).setAttribute("aria-expanded","false"); } }
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
// One button for model + effort. The menu lists the models, then effort as a row of choices.
function syncSel(){
  const canWeb = !!active && kids.web !== false && !kids.on;
  $("webBtn").hidden = !canWeb; if (!canWeb) webOn = false;
  $("webBtn").setAttribute("aria-pressed", String(webOn)); $("webBtn").classList.toggle("on", webOn);
  $("webBtn").title = webOn ? "Web search is on (tap to turn off)" : "Search the web";
  $("sels").hidden = !active; if (!active) { hint(); return; }
  const p = pf(active), m0 = MODELS[p.m];
  const btn = $("modelBtn"); btn.replaceChildren(el("span", null, (lockedModel(p.m) ? "🔒 " : "") + m0.n + " " + m0.v));
  if (hasEffort(p.m)) btn.append(el("small", null, EFFORTS[p.e].n));
  btn.append(el("span", "car", "▾"));
  const menu = $("modelMenu"); menu.innerHTML = "";
  menu.append(el("div", "mh3", "Model"));
  MODELS.forEach((m, i) => {
    const it = menuItem(m.n + " " + m.v, credits ? creditWord(m.cost) : "", cap(m.d) + ". Built on the latest " + m.base.replace(/ [\d.]+$/, "") + " model (" + m.base.replace(/^Claude /, "") + ").", i === p.m,
      () => { pf(active).m = i; savePrefs(); closeMenus(); syncSel(); });
    if (lockedModel(i)) { it.classList.add("locked"); it.querySelector("b").append(el("span", "lock", "🔒 " + PLAN_NAMES[needPlan(i)])); it.onclick = () => { closeMenus(); openPlans(); }; }
    menu.appendChild(it);
  });
  if (hasEffort(p.m)) {
    menu.append(el("div", "msep"), el("div", "mh3", "Effort"));
    const row = el("div", "effrow");
    EFFORTS.forEach((e, i) => {
      const b = el("button", null, e.n); b.type = "button"; b.setAttribute("aria-pressed", String(i === p.e));
      if (credits && e.mult > 1) b.append(el("small", null, "×" + e.mult + " credits"));
      b.onclick = ev => { ev.stopPropagation(); pf(active).e = i; savePrefs(); syncSel(); };
      row.append(b);
    });
    menu.append(row, el("div", "effdesc", cap(EFFORTS[p.e].d) + "."));
  } else menu.append(el("div", "msep"), el("div", "effdesc", m0.n + " doesn't have effort settings. It always answers fast."));
  menu.onclick = e => e.stopPropagation();
  hint(); renderUsage();
}
// Credit note under the chat box: only when credits are on and you picked something heavy, or you're running low
function hint(){
  const h = $("hint");
  const off = () => { h.textContent = ""; h.hidden = true; h.classList.remove("warn", "mid"); };
  const show = (msg, cls) => { if (!msg) return off(); h.textContent = msg; h.hidden = false; h.classList.toggle("warn", cls === "warn"); h.classList.toggle("mid", cls === "mid"); };
  // Web search note (it costs the site owner a little)
  const web = active && webOn ? `🌐 Web search is on (up to 3 searches per message, ${Number.isInteger(kids.webPerDay) ? kids.webPerDay : 5} per day).` : "";
  if (!active || !credits) return show(web);
  const p = pf(active), m = MODELS[p.m], est = estimate(active), cost = est.total, left = credits.left;
  const what = m.n + (hasEffort(p.m) && EFFORTS[p.e].mult > 1 ? " on " + EFFORTS[p.e].n : "");
  const koaTip = p.m !== 0 ? " Koa uses just 1." : "";
  // "This message: Lumina 3 + web search 2 = 5 credits"
  const parts = [`${what} ${est.base}`]; if (est.long) parts.push(`long chat ${est.long}`); if (est.files) parts.push(`big files ${est.files}`); if (est.web) parts.push(`web search ${est.web}`);
  const cost1 = parts.length > 1 ? `This message: ${parts.join(" + ")} = ${creditWord(cost)}${est.web ? " (you get the 2 back if it doesn't search)" : ""}.` : `${what} uses ${creditWord(cost)} per message.`;
  let msg = "", cls = "";
  if (left < cost) {
    const ex = cost - est.base, cheaper = MODELS.filter(x => x.cost + ex <= left).pop();
    msg = left > 0 ? `Not enough credits: this message needs ${cost}, you have ${left}. ${cheaper ? "Switch to " + cheaper.n + " to keep chatting." : "They refill at midnight."}` : "You're out of credits for today. They refill at midnight.";
    cls = "warn";
  } else if (left <= 20) { msg = `Low on credits: ${left} left today. ${cost1}` + koaTip; cls = "warn"; }
  else if (left <= 50) { msg = `${creditWord(left)} left today. ${cost1}`; cls = "mid"; }
  else if (parts.length > 1 || cost > 3) msg = cost1 + (cost > 3 ? ` (${left} left today)` : "");
  // Say plainly when an extra kicks in
  const why = [];
  if (est.long) why.push("💬 This chat is long now, so each message costs 1 extra credit. Start a new chat to save credits.");
  if (est.files) why.push("📁 Big files cost 2 extra credits for this message.");
  show([web, ...why, msg].filter(Boolean).join(" "), cls);
}
function toggleMenu(menuId, btnId){
  return e => { e.stopPropagation(); const mm = $(menuId), open = mm.hidden; closeMenus(); mm.hidden = !open; $(btnId).setAttribute("aria-expanded", String(open));
    if (open) mm.classList.toggle("down", $("form").getBoundingClientRect().top < mm.offsetHeight + 16); };
}
$("modelBtn").onclick = toggleMenu("modelMenu", "modelBtn");
$("webBtn").onclick = e => { e.stopPropagation(); if (!active) { nudge(); return; } webOn = !webOn; const c = curConv(); if (c) c.web = webOn; syncSel(); box.focus(); };
document.addEventListener("click", closeMenus);
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
let delArm = null, delTimer = null;
function disarm(){ if (delArm) { delArm.classList.remove("armed"); delArm.innerHTML = TRASH_SVG; } delArm = null; clearTimeout(delTimer); }
function askDelete(id, btn){
  if (busy || !convs[id]) return;
  if (delArm !== btn) { disarm(); delArm = btn; btn.classList.add("armed"); btn.textContent = "Delete?"; delTimer = setTimeout(disarm, 3500); return; }
  disarm();
  const name = convs[id].title || "Chat";
  delete convs[id]; deletedIds.add(id); save();
  if (cur === id) { cur = null; renderHome(); } else renderSide();
  status.textContent = `Deleted "${name}".`;
}
const PEN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
function startRename(id, row){
  const c = convs[id]; if (!c) return;
  const inp = document.createElement("input"); inp.className = "sq rename"; inp.value = c.title || ""; inp.maxLength = 80; inp.setAttribute("aria-label", "Chat name");
  row.replaceChildren(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => { if (done) return; done = true; if (ok) { const v = inp.value.trim(); if (v && v !== c.title) { c.title = v.slice(0, 80); c.renamed = true; save(); } } renderSide(); if (cur === id) $("topRole").textContent = c.title; };
  inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } };
  inp.onblur = () => finish(true);
}
function convItem(c, sub){
  const b = BOTS[c.orb], el = document.createElement("button");
  el.type = "button"; el.className = "nav" + (c.id === cur ? " on" : ""); el.style.setProperty("--c", `var(${b.color})`);
  el.innerHTML = '<span class="g"></span><span class="tx"><b></b><small></small></span>';
  orbInto(el.querySelector(".g"), c.orb); el.querySelector("b").textContent = c.title || "New chat";
  el.querySelector("small").textContent = sub || b.name;
  el.onclick = () => openConv(c.id);
  el.ondblclick = e => { e.preventDefault(); startRename(c.id, el.parentNode); };
  return el;
}
function renderSide(){
  syncSel();
  const rec = $("recent"); rec.innerHTML = ""; const term = $("q").value.trim().toLowerCase();
  const shown = Object.values(convs).filter(c => c.turns.length && !c.incog && (!term || (c.title || "").toLowerCase().includes(term) || BOTS[c.orb].name.toLowerCase().includes(term) || c.turns.some(m => m.content.toLowerCase().includes(term))))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  for (const c of shown) {
    const row = document.createElement("div"); row.className = "rrow";
    const hit = term ? c.turns.find(m => m.content.toLowerCase().includes(term)) : null;
    row.appendChild(convItem(c, hit ? hit.content.slice(0, 60) : ""));
    const ren = document.createElement("button"); ren.type = "button"; ren.className = "icon-btn delb renb"; ren.innerHTML = PEN_SVG;
    ren.setAttribute("aria-label", "Rename chat"); ren.title = "Rename";
    ren.onclick = e => { e.stopPropagation(); startRename(c.id, row); };
    const del = document.createElement("button"); del.type = "button"; del.className = "icon-btn delb"; del.innerHTML = TRASH_SVG;
    del.setAttribute("aria-label", "Delete chat"); del.title = "Delete chat";
    del.onclick = e => { e.stopPropagation(); askDelete(c.id, del); };
    row.append(ren, del); rec.appendChild(row);
  }
  if (!shown.length) { const d = document.createElement("div"); d.className = "pin-empty"; d.textContent = term ? "No chats match." : "Your chats will show up here."; rec.appendChild(d); }
  const wrap = $("pins"); wrap.innerHTML = "";
  for (const k of pins) {
    const b = BOTS[k], el = document.createElement("button");
    el.type = "button"; el.className = "nav" + (k === active ? " on" : ""); el.style.setProperty("--c", `var(${b.color})`);
    el.innerHTML = '<span class="g"></span><span></span>';
    orbInto(el.firstChild, k); el.lastChild.textContent = b.name;
    el.onclick = () => { pick(k); if (mobile()) setSide(false); };
    wrap.appendChild(el);
  }
  if (!pins.length) { const d = document.createElement("div"); d.className = "pin-empty"; d.textContent = "Pick an orb, then tap the star to pin it here."; wrap.appendChild(d); }
  const on = active && pins.includes(active);
  for (const id of ["pinTop","pinHome"]) { const e = $(id); e.classList.toggle("on", !!on); e.hidden = !active; e.setAttribute("aria-label", on ? "Unpin this orb" : "Pin this orb"); }
}
function togglePin(){
  if (!active) return;
  pins = pins.includes(active) ? pins.filter(k => k !== active) : [...pins, active];
  cloudSave();
  renderSide();
}
$("q").oninput = renderSide;
$("pinTop").onclick = togglePin;
$("delTop").onclick = () => { if (cur) askDelete(cur, $("delTop")); }; $("pinHome").onclick = togglePin;

// Back / forward through the screens you visited
let hist = [], hi = -1, restoring = false;
function snap(){
  if (restoring) return;
  const here = { active, cur, view: app.dataset.view }, top = hist[hi];
  if (!top || top.active !== here.active || top.cur !== here.cur || top.view !== here.view) { hist = hist.slice(0, hi + 1); hist.push(here); hi = hist.length - 1; }
  $("backBtn").disabled = hi <= 0; $("fwdBtn").disabled = hi >= hist.length - 1;
}
function travel(d){
  if (busy) return;
  const n = hi + d; if (n < 0 || n >= hist.length) return;
  hi = n; const s = hist[n]; restoring = true; active = s.active; cur = s.cur && convs[s.cur] ? s.cur : null; status.textContent = ""; dropIncog(cur);
  if (s.view === "chat" && cur) renderChat(); else renderHome();
  restoring = false; $("backBtn").disabled = hi <= 0; $("fwdBtn").disabled = hi >= hist.length - 1; renderSide();
}
$("backBtn").onclick = () => travel(-1); $("fwdBtn").onclick = () => travel(1);


// ---------- Credits (counted on the server; shown here) ----------
let credits = null, limitHit = false;
const dayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
function creditsFromDoc(d){
  if (!d || typeof d.limit !== "number") { credits = null; limitHit = false; return; }
  credits = d.day === dayKey() ? { left: Math.max(0, d.limit - (d.used || 0)), limit: d.limit } : { left: d.limit, limit: d.limit };
  limitHit = credits.left === 0;
}
// left === null means the site has no limits turned on
function setCredits(left){
  if (typeof left === "number") credits = { left, limit: credits ? credits.limit : null };
  else if (left === null) { credits = null; limitHit = false; }
  renderUsage(); hint(); syncSel();
}
function untilMidnight(){
  const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const mid = new Date(ny); mid.setHours(24, 0, 0, 0);
  const mins = Math.max(1, Math.round((mid - ny) / 60000)), h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
function renderUsage(){
  $("limit").hidden = !limitHit;
  const bar = $("useBar"), more = $("useMore"), costs = $("useCost");
  if (!credits) {
    $("useState").textContent = "Unlimited"; $("useDot").className = "dot2 ok";
    bar.hidden = true; costs.hidden = true;
    more.textContent = "There's no daily credit limit right now, so every model is free to use as much as you want.";
    return;
  }
  const { left, limit } = credits;
  $("useState").textContent = limit ? `${left} of ${creditWord(limit)} left today` : `${creditWord(left)} left today`;
  // 20 or less = low (red), 21 to 50 = getting there (yellow), more = fine (green)
  const level = left <= 20 ? "out" : left <= 50 ? "low" : "";
  $("useDot").className = "dot2 " + (level === "out" ? "bad" : level === "low" ? "mid" : "ok");
  bar.hidden = !limit; if (limit) { $("useFill").style.width = Math.max(0, Math.min(100, left / limit * 100)) + "%"; bar.className = "ubar" + (level ? " " + level : ""); }
  let txt = `Refills at midnight New York time (in ${untilMidnight()}).`;
  if (credits.monthLimit) txt += ` This month: ${credits.monthLeft} of ${credits.monthLimit} left.`;
  if (active) { const p = pf(active), c = msgCost(p), m = MODELS[p.m]; txt += ` Your pick for ${BOTS[active].name}, ${m.n}${hasEffort(p.m) ? " on " + EFFORTS[p.e].n : ""}, uses ${creditWord(c)} per message, so about ${Math.floor(left / c)} more message${Math.floor(left / c) === 1 ? "" : "s"} today.`; }
  more.textContent = txt;
  costs.hidden = false; costs.innerHTML = "";
  const curM = active ? pf(active).m : -1;
  MODELS.forEach((m, i) => { const d = el("div", i === curM ? "on" : null); d.append(el("b", null, String(m.cost)), el("small", null, m.n)); costs.append(d); });
  costs.append(el("p", null, "Credits per message. Higher effort costs more: High ×2, Extra ×3, Max ×4. Extras on top: long chat (more than 20 messages) +1, web search +2 (only if it searches), big files (6+ files, a big PDF, or lots of code) +2."));
}

// ---------- Account panel ----------
function renderProfile(){
  const img = $("profImg"), av = $("profAv");
  if (!user) { $("profName").textContent = "Your account"; $("profSub").textContent = ""; img.hidden = true; av.hidden = false; av.textContent = "?"; return; }
  const name = user.displayName || (user.email || "").split("@")[0] || "You";
  $("profName").textContent = name; $("profSub").textContent = user.email || "";
  av.textContent = name.trim().charAt(0).toUpperCase() || "?";
  if (user.photoURL) { img.referrerPolicy = "no-referrer"; img.src = user.photoURL; img.hidden = false; av.hidden = true; img.onerror = () => { img.hidden = true; av.hidden = false; }; }
  else { img.hidden = true; av.hidden = false; }
}
function renderAccount(){ $("acctTxt").textContent = user ? "Signed in as " + (user.email || "you") : "Not signed in"; }
$("prof").onclick = openSet;
$("prof").onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSet(); } };

function resetState(){
  convs = {}; cur = null; deletedIds.clear(); legacyDel.clear();
  pins = []; prefs = {}; lastSent = {}; opts = { think: true }; webOn = false; incogNext = false; stopSpeak();
  active = null; hist = []; hi = -1; credits = null; limitHit = false;
  log.innerHTML = ""; $("q").value = ""; box.value = ""; status.textContent = ""; pendingFiles = []; renderAtts(); stopVoice();
}

// ---------- Saving to Firebase ----------
const FB = "https://www.gstatic.com/firebasejs/12.19.0/";
let auth = null, db = null, A = null, F = null;
let lastSent = {}, cloudT = null, loaded = false;
function fitTurns(t){ t = t.slice(); while (t.length > 2 && JSON.stringify(t).length > 200000) t.shift(); return t; }
function cleanTurns(v){
  return Array.isArray(v) ? v.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => { const o = { role:m.role, content:m.content };
      if (typeof m.t === "number") o.t = m.t;
      if (Array.isArray(m.files)) o.files = m.files.filter(f => f && typeof f.name === "string").slice(0, 40).map(f => ({ name: f.name.slice(0, 200), kind: ["image","pdf","text"].includes(f.kind) ? f.kind : "text" }));
      if (m.role === "assistant") {
        if (typeof m.th === "string" && m.th) o.th = m.th.slice(0, 20000);
        if (Number.isInteger(m.tm) && m.tm > 0) o.tm = m.tm;
        if (Number.isInteger(m.m) && m.m >= 0 && m.m < 4) o.m = m.m;
        if (m.fb === "up" || m.fb === "down") o.fb = m.fb;
        if (Array.isArray(m.q)) o.q = m.q.filter(q => typeof q === "string").slice(0, 5).map(q => q.slice(0, 200));
        if (Array.isArray(m.src)) o.src = m.src.filter(x => x && typeof x.u === "string" && /^https?:\/\//i.test(x.u)).slice(0, 10).map(x => ({ u: x.u.slice(0, 500), t: String(x.t || "").slice(0, 200) }));
      }
      return o; }) : [];
}
function cloudSave(){ if (!user || !loaded) return; clearTimeout(cloudT); cloudT = setTimeout(flush, 800); }
async function flush(){
  const uid = user && user.uid; if (!uid || !loaded) return;
  try {
    for (const c of Object.values(convs)) {
      if (!c.turns.length || c.incog) continue;
      const data = { orb:c.orb, title:c.title || "New chat", turns:fitTurns(c.turns), created:c.created || Date.now(), updated:c.updated || Date.now() };
      const js = JSON.stringify(data);
      if (lastSent["c_" + c.id] !== js) { await F.setDoc(F.doc(db, "users", uid, "chats", c.id), data); lastSent["c_" + c.id] = js; }
    }
    for (const id of Array.from(deletedIds)) { await F.deleteDoc(F.doc(db, "users", uid, "chats", id)); deletedIds.delete(id); delete lastSent["c_" + id]; }
    // Old one-chat-per-orb saves are moved into the new chat list above, then removed
    for (const docId of Array.from(legacyDel)) { await F.deleteDoc(F.doc(db, "users", uid, "data", docId)); legacyDel.delete(docId); }
    const meta = { pins, prefs, opts }, mj = JSON.stringify(meta);
    if (lastSent.settings !== mj) { await F.setDoc(F.doc(db, "users", uid, "data", "settings"), JSON.parse(mj)); lastSent.settings = mj; }
  } catch (e) { status.textContent = "Couldn't save your chats right now. Check your connection."; }
}
async function loadAccount(u){
  loaded = false; resetState();
  const [chatSnap, snap] = await Promise.all([F.getDocs(F.collection(db, "users", u.uid, "chats")), F.getDocs(F.collection(db, "users", u.uid, "data"))]);
  chatSnap.forEach(d => {
    const v = d.data() || {};
    if (!Object.hasOwn(BOTS, v.orb)) return;
    const c = { id:d.id, orb:v.orb, title: typeof v.title === "string" ? v.title.slice(0, 80) : "", turns: cleanTurns(v.turns),
      created: typeof v.created === "number" ? v.created : Date.now(), updated: typeof v.updated === "number" ? v.updated : Date.now() };
    if (!c.turns.length) return;
    convs[c.id] = c;
    lastSent["c_" + c.id] = JSON.stringify({ orb:c.orb, title:c.title || "New chat", turns:fitTurns(c.turns), created:c.created, updated:c.updated });
  });
  let migrate = false;
  snap.forEach(d => {
    const v = d.data() || {};
    if (d.id.startsWith("chat_")) {
      // Older saves had one chat per orb: turn each into its own chat in the new list
      const k = d.id.slice(5), turns = cleanTurns(v.turns);
      if (Object.hasOwn(BOTS, k) && turns.length) {
        const id = "m_" + k;
        if (!convs[id]) { const firstUser = turns.find(m => m.role === "user");
          convs[id] = { id, orb:k, title: titleFrom(firstUser ? firstUser.content : ""), turns, created: turns[0].t || Date.now(), updated: turns[turns.length - 1].t || Date.now() }; }
        migrate = true;
      }
      legacyDel.add(d.id);
    }
    else if (d.id === "settings") {
      pins = Array.isArray(v.pins) ? v.pins.filter(k => Object.hasOwn(BOTS, k)) : [];
      prefs = v.prefs && typeof v.prefs === "object" ? JSON.parse(JSON.stringify(v.prefs)) : {};
      opts = { think: !(v.opts && v.opts.think === false) };
      lastSent.settings = JSON.stringify({ pins, prefs, opts });
    }
  });
  try { const us = await F.getDoc(F.doc(db, "usage", u.uid)); creditsFromDoc(us.exists() ? us.data() : null); } catch (e) { credits = null; }
  loaded = true;
  if (migrate || legacyDel.size) cloudSave();
}

// ---------- Sign-in screen ----------
const gate = $("gate");
let authMode = "in";
const AUTH_ERR = {
  "auth/invalid-credential":"Wrong email or password.", "auth/wrong-password":"Wrong email or password.", "auth/user-not-found":"Wrong email or password.",
  "auth/invalid-login-credentials":"Wrong email or password.",
  "auth/email-already-in-use":"That email already has an account. Try signing in instead.",
  "auth/weak-password":"Use a longer password (at least 8 characters).",
  "auth/password-does-not-meet-requirements":"That password is too simple. Try a longer one.",
  "auth/invalid-email":"That email doesn't look right.",
  "auth/missing-password":"Type your password.",
  "auth/too-many-requests":"Too many tries. Wait a few minutes and try again.",
  "auth/popup-blocked":"Your browser blocked the Google window. Allow pop-ups for this site, then try again.",
  "auth/unauthorized-domain":"This website isn't on Firebase's allowed list yet (Authentication > Settings > Authorized domains).",
  "auth/operation-not-allowed":"This sign-in method isn't turned on in Firebase yet.",
  "auth/network-request-failed":"Can't reach the internet. Check your connection.",
  "auth/user-disabled":"This account has been turned off."
};
function authErr(e){ const c = e && e.code; if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return ""; return AUTH_ERR[c] || "Something went wrong. Try again."; }
function say(msg, ok){ const el = $("aErr"); el.textContent = msg || ""; el.classList.toggle("aok", !!ok); }
function showGate(mode, email){
  gate.hidden = false; say("");
  $("landing").hidden = mode !== "home"; $("authCard").hidden = mode === "home";
  $("aBack").hidden = mode !== "signin";
  if (mode === "home") { gate.scrollTop = 0; return; }
  $("aMain").hidden = mode !== "signin"; $("aVerify").hidden = mode !== "verify";
  $("aAge").hidden = mode !== "age"; $("aBlocked").hidden = mode !== "blocked" && mode !== "banned";
  if (mode === "age") { $("aTitle").textContent = "How old are you?"; $("aText").textContent = "Orbs uses this to keep everyone safe. You can't change it later, so please be honest."; return; }
  if (mode === "blocked") { $("aTitle").textContent = "Sorry!"; $("aText").textContent = "Orbs is only for people 13 and older. Come back when you're older!"; return; }
  if (mode === "banned") { $("aTitle").textContent = "Account blocked"; $("aText").textContent = "This account can't use Orbs anymore because it broke the rules. If you think that's a mistake, contact the person who runs Orbs."; return; }
  if (mode === "loading") { $("aTitle").textContent = "Orbs"; $("aText").textContent = "Loading…"; }
  else if (mode === "setup") { $("aTitle").textContent = "Almost ready"; $("aText").textContent = "Orbs isn't connected to Firebase yet. Paste your Firebase settings into firebase-config.js, then upload it again."; }
  else if (mode === "verify") { $("aTitle").textContent = "Check your email"; $("aText").textContent = "We sent a link to " + (email || "your email") + ". Click it to confirm it's really you, then come back here."; }
  else { $("aTitle").textContent = authMode === "up" ? "Make your account" : "Welcome to Orbs"; $("aText").textContent = authMode === "up" ? "Pick a name, then use your email or Google." : "Sign in to chat with your orbs. Your chats save to your account."; }
}
function setAuthMode(m){
  authMode = m;
  $("aName").hidden = m !== "up";
  $("aSubmit").textContent = m === "up" ? "Create account" : "Sign in";
  $("aPass").setAttribute("autocomplete", m === "up" ? "new-password" : "current-password");
  $("aSwitch").textContent = m === "up" ? "Have an account? Sign in" : "New here? Create an account";
  $("aForgot").hidden = m === "up";
  $("aAgreeRow").hidden = m !== "up"; $("aAgree").checked = false;
  showGate("signin");
}
async function busyBtn(btn, fn){ btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } }
$("aSwitch").onclick = () => setAuthMode(authMode === "up" ? "in" : "up");
$("goBtn").onclick = () => setAuthMode("up");
$("goSignin").onclick = () => setAuthMode("in");
$("aBack").onclick = () => showGate("home");
$("lineup").innerHTML = ORDER.map(k => `<div class="lo"><div class="has-orb">${orbSVG(k)}</div><b></b><small></small></div>`).join("");
$("lineup").querySelectorAll(".lo").forEach((el, i) => { el.querySelector("b").textContent = BOTS[ORDER[i]].name; el.querySelector("small").textContent = BOTS[ORDER[i]].role; });
$("gGoogle").onclick = () => busyBtn($("gGoogle"), async () => {
  say("");
  try { const p = new A.GoogleAuthProvider(); p.setCustomParameters({ prompt:"select_account" }); await A.signInWithPopup(auth, p); }
  catch (e) { say(authErr(e)); }
});
$("aForm").addEventListener("submit", e => { e.preventDefault(); busyBtn($("aSubmit"), async () => {
  const email = $("aEmail").value.trim(), pass = $("aPass").value, name = $("aName").value.trim();
  if (!email) return say("Type your email.");
  if (authMode === "up" && pass.length < 8) return say("Use a password with at least 8 characters.");
  if (authMode === "up" && !$("aAgree").checked) return say("Please agree to the Terms of Service and Privacy Policy first.");
  if (!pass) return say("Type your password.");
  try {
    if (authMode === "up") {
      const cred = await A.createUserWithEmailAndPassword(auth, email, pass);
      if (name) await A.updateProfile(cred.user, { displayName: name });
      await A.sendEmailVerification(cred.user);
      showGate("verify", email);
    } else {
      await A.signInWithEmailAndPassword(auth, email, pass);
    }
    $("aPass").value = "";
  } catch (err) { say(authErr(err)); }
}); });
$("aForgot").onclick = () => busyBtn($("aForgot"), async () => {
  const email = $("aEmail").value.trim();
  if (!email) return say("Type your email first, then tap Forgot password.");
  try { await A.sendPasswordResetEmail(auth, email); say("If that email has an account, a reset link is on its way.", true); }
  catch (e) { say(authErr(e)); }
});
$("vDone").onclick = () => busyBtn($("vDone"), async () => {
  const u = auth.currentUser; if (!u) return showGate("signin");
  try {
    await u.reload();
    if (!auth.currentUser.emailVerified) return say("Not confirmed yet. Check your inbox (and your spam folder).");
    await auth.currentUser.getIdToken(true);
    await enter(auth.currentUser);
  } catch (e) { say(authErr(e)); }
});
$("vResend").onclick = () => busyBtn($("vResend"), async () => {
  try { await A.sendEmailVerification(auth.currentUser); say("Sent! Check your inbox.", true); } catch (e) { say(authErr(e)); }
});
$("vOut").onclick = () => A.signOut(auth);

// ---------- Age + Kids Mode (the server decides; the page just shows it) ----------
let kids = { age:null, on:false, locked:false, blocked:false, forcedForAll:false, banned:false, web:true }, pending = null;
async function kidsApi(u, body){
  const r = await fetch("/api/kids", { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer " + await u.getIdToken() }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch(_) {}
  if (typeof j.age !== "undefined") kids = { ...kids, ...j };
  if ("credits" in j) { const c = j.credits; credits = c && typeof c.left === "number" ? { left: c.left, limit: c.limit || null, monthLeft: c.monthLeft, monthLimit: c.monthLimit } : null; limitHit = !!credits && credits.left === 0; }
  return { ok: r.ok, ...j };
}
function renderKids(){
  const t = $("kidsTxt"), help = $("kidsHelp");
  $("kidsDot").className = "dot2 " + (kids.on ? "ok" : "");
  $("kidsForm").hidden = true; $("kidsMsg").textContent = "";
  if (kids.forcedForAll) { t.textContent = "On for everyone on this site"; $("kidsBtn").hidden = true; }
  else if (kids.locked) { t.textContent = "On (always on for ages 13 to 17)"; $("kidsBtn").hidden = true; }
  else { t.textContent = kids.on ? "On" : "Off"; $("kidsBtn").hidden = false; $("kidsBtn").textContent = kids.on ? "Turn off Kids Mode" : "Turn on Kids Mode"; }
  help.textContent = kids.on
    ? "Orbs gives kid-safe answers, checks every message and reply with an AI safety check, and blocks personal info."
    : "Extra safety for kids and teens: kid-safe answers, an AI safety check on every message and reply, and a block on sharing personal info.";
  $("kidsPin2").hidden = kids.on; $("kidsGo").textContent = kids.on ? "Turn off with PIN" : "Turn on Kids Mode";
  $("kidsPill").hidden = !kids.on;
  $("aiNote").textContent = (kids.on ? "🛡️ Kids Mode is on. " : "") + "Orbs is AI and can make mistakes. Please double-check important info.";
  syncSel();
}
$("kidsBtn").onclick = () => { $("kidsForm").hidden = false; $("kidsBtn").hidden = true; $("kidsPin").value = ""; $("kidsPin2").value = ""; $("kidsPin").focus(); };
$("kidsForm").addEventListener("submit", e => { e.preventDefault(); busyBtn($("kidsGo"), async () => {
  const pin = $("kidsPin").value.trim(), msg = $("kidsMsg");
  if (!/^\d{4,8}$/.test(pin)) { msg.textContent = "The PIN has to be 4 to 8 numbers."; return; }
  if (!kids.on && pin !== $("kidsPin2").value.trim()) { msg.textContent = "The two PINs don't match."; return; }
  try {
    const r = await kidsApi(user, { action: kids.on ? "off" : "on", pin });
    if (r.ok) { renderKids(); msg.textContent = kids.on ? "Kids Mode is on. Keep the PIN somewhere the kid can't find it." : "Kids Mode is off."; return; }
    msg.textContent = r.error === "wrong_pin" ? `Wrong PIN. ${r.triesLeft} tries left.` : r.error === "too_many_tries" ? "Too many wrong PINs. Try again in 15 minutes." : "Couldn't change Kids Mode. Try again.";
  } catch (_) { msg.textContent = "Couldn't reach Orbs. Check your connection."; }
}); });
for (const b of document.querySelectorAll("[data-age]")) b.onclick = () => busyBtn(b, async () => {
  const u = pending || auth.currentUser; if (!u) return showGate("signin");
  try {
    const r = await kidsApi(u, { action:"age", age: b.dataset.age });
    if (!r.ok && r.error !== "age_already_set") return say("Couldn't save that" + (r.why ? " (" + r.why + ")" : "") + ". Try again.");
    await enter(u);
  } catch (_) { say("Couldn't reach Orbs. Check your connection."); }
});
$("bOut").onclick = () => A.signOut(auth);

async function enter(u){
  showGate("loading"); pending = u;
  try { await loadAccount(u); await kidsApi(u, { action:"status" }); }
  catch (e) { user = null; showGate("signin"); say("Couldn't load your account. Check your connection and try again."); return; }
  if (kids.banned) { showGate("banned"); return; }
  if (!kids.age) { showGate("age"); return; }
  if (kids.blocked) { showGate("blocked"); return; }
  pending = null; user = u; renderProfile(); renderUsage(); renderKids(); renderThinkSet(); renderPlan(); gate.hidden = true; renderHome();
  cloudSave(); // finishes moving any old-style chats
  checkAdmin(); afterBilling();
}

// ---------- Settings: sign out, delete ----------
$("outBtn").onclick = async () => { clearTimeout(cloudT); await flush(); closeSet(); await A.signOut(auth); };
let killTimer;
function killArmed(on){ const b = $("killBtn"); b.classList.toggle("armed", on); b.textContent = on ? "Tap again to delete your account forever" : "Delete my account"; clearTimeout(killTimer); if (on) killTimer = setTimeout(() => killArmed(false), 5000); }
$("killBtn").onclick = () => busyBtn($("killBtn"), async () => {
  if (!user || busy) return;
  if (!$("killBtn").classList.contains("armed")) { killArmed(true); return; }
  killArmed(false);
  const signedInAt = Date.parse(user.metadata && user.metadata.lastSignInTime || "") || 0;
  if (Date.now() - signedInAt > 4 * 60 * 1000) { $("setMsg").textContent = "For safety, sign out, sign back in, then delete your account within a few minutes."; return; }
  try {
    loaded = false; clearTimeout(cloudT);
    for (const col of ["data", "chats"]) {
      const snap = await F.getDocs(F.collection(db, "users", user.uid, col));
      for (const d of snap.docs) await F.deleteDoc(d.ref);
    }
    await A.deleteUser(user);
    closeSet();
  } catch (e) {
    loaded = true;
    $("setMsg").textContent = e && e.code === "auth/requires-recent-login"
      ? "For safety, sign out, sign back in, then try again."
      : "Couldn't delete your account. Try again.";
  }
});

// ---------- Files and folders ----------
// Files ride along with the next message only. Pictures are shrunk first; folders send their text and code files.
let pendingFiles = [];
const lastFiles = {};
const IMG_TYPES = ["image/jpeg","image/png","image/gif","image/webp"];
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|cfg|conf|log|html?|css|scss|sass|less|m?js|cjs|jsx|ts|tsx|vue|svelte|py|rb|php|java|kts?|swift|c|h|cpp|hpp|cc|cs|go|rs|lua|luau|sh|bash|zsh|ps1|bat|sql|r|dart|scala|pl|srt|vtt|tex|rst|gitignore|env\.example)$/i;
const SKIP_PATH = /(^|\/)(node_modules|\.git|\.next|dist|build|out|__pycache__|\.venv|venv|\.idea|\.vscode|coverage)(\/|$)/;
const FILE_LIMITS = { count: 40, text: 300000, perText: 200000, bytes: 3500000, pdf: 3000000 };
const fileBytes = () => pendingFiles.reduce((n, f) => n + (f.data ? f.data.length : f.text.length * 1.1), 0);
function renderAtts(){
  const w = $("atts"); w.innerHTML = ""; w.hidden = !pendingFiles.length;
  pendingFiles.forEach((f, i) => {
    const c = document.createElement("span"); c.className = "att";
    const n = document.createElement("span"); n.textContent = (f.kind === "image" ? "🖼️ " : f.kind === "pdf" ? "📄 " : "📎 ") + f.name;
    const x = document.createElement("button"); x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Remove " + f.name);
    x.onclick = () => { pendingFiles.splice(i, 1); renderAtts(); };
    c.append(n, x); w.appendChild(c);
  });
  updateSend(); if (typeof hint === "function") hint();
}
const readAs = (file, how) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r[how](file); });
async function shrinkImage(file){
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}
async function addFiles(list, fromFolder){
  if (!active) { nudge(); return; }
  let skipped = 0, blockedMedia = 0, full = false;
  let textChars = pendingFiles.reduce((n, f) => n + (f.text ? f.text.length : 0), 0);
  for (const file of Array.from(list || [])) {
    const name = (file.webkitRelativePath || file.name || "file").slice(0, 200);
    if (SKIP_PATH.test(name) || /(^|\/)\.[^/]+\//.test(name)) { skipped++; continue; }
    if (pendingFiles.length >= FILE_LIMITS.count) { full = true; break; }
    try {
      const isImg = IMG_TYPES.includes(file.type), isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
      if ((isImg || isPdf) && kids.on) { blockedMedia++; continue; }
      if (isImg && !fromFolder) {
        const data = await shrinkImage(file);
        if (fileBytes() + data.length > FILE_LIMITS.bytes) { full = true; break; }
        pendingFiles.push({ kind:"image", name, media_type:"image/jpeg", data });
      } else if (isPdf && !fromFolder) {
        if (file.size > FILE_LIMITS.pdf) { skipped++; continue; }
        const data = String(await readAs(file, "readAsDataURL")).split(",")[1] || "";
        if (fileBytes() + data.length > FILE_LIMITS.bytes) { full = true; break; }
        pendingFiles.push({ kind:"pdf", name, data });
      } else if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.test(name)) {
        if (file.size > 2000000) { skipped++; continue; }
        let text = String(await readAs(file, "readAsText"));
        if (text.includes("\u0000")) { skipped++; continue; }
        text = text.slice(0, FILE_LIMITS.perText);
        if (textChars + text.length > FILE_LIMITS.text || fileBytes() + text.length * 1.1 > FILE_LIMITS.bytes) { full = true; break; }
        textChars += text.length; pendingFiles.push({ kind:"text", name, text });
      } else skipped++;
    } catch (e) { skipped++; }
  }
  renderAtts();
  const notes = [];
  if (blockedMedia) notes.push("🛡️ Kids Mode only allows text and code files");
  if (full) notes.push("that's all that fits in one message");
  if (skipped) notes.push(`skipped ${skipped} file${skipped === 1 ? "" : "s"} Orbs can't read`);
  status.textContent = notes.length ? notes.join(", ").replace(/^./, c => c.toUpperCase()) + "." : "";
  box.focus();
}
$("addBtn").onclick = e => { e.stopPropagation(); if (!active) { nudge(); return; } const m = $("addMenu"), open = m.hidden; closeMenus(); m.hidden = !open; $("addBtn").setAttribute("aria-expanded", String(open)); if (open) m.classList.toggle("down", $("form").getBoundingClientRect().top < 140); };
$("addFiles").onclick = () => { closeMenus(); $("fileIn").accept = kids.on ? ".txt,.md,.csv,.json,.html,.css,.js,.ts,.py,.lua,.luau,text/*" : "image/*,.pdf,text/*,.md,.csv,.json,.js,.ts,.py,.lua,.luau,.html,.css,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sh,.sql,.xml,.yml,.yaml,.toml"; $("fileIn").click(); };
$("addFolder").onclick = () => { closeMenus(); $("folderIn").click(); };
$("fileIn").onchange = async e => { await addFiles(e.target.files, false); e.target.value = ""; };
$("folderIn").onchange = async e => { await addFiles(e.target.files, true); e.target.value = ""; };
form.addEventListener("dragover", e => { if (active && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) { e.preventDefault(); form.classList.add("drop"); } });
form.addEventListener("dragleave", () => form.classList.remove("drop"));
form.addEventListener("drop", e => { form.classList.remove("drop"); if (!active || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); addFiles(e.dataTransfer.files, false); });
box.addEventListener("paste", e => { const fs = Array.from((e.clipboardData && e.clipboardData.files) || []); if (fs.length) { e.preventDefault(); addFiles(fs, false); } });

// ---------- Voice typing (free, built into Chrome, Edge and Safari) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, voiceBase = "";
function stopVoice(){ if (rec && listening) { try { rec.stop(); } catch(_) {} } }
function setMic(on){ listening = on; $("micBtn").setAttribute("aria-pressed", String(on)); $("micBtn").title = on ? "Stop voice typing" : "Voice typing"; box.placeholder = on ? "Listening…" : (active ? (app.dataset.view === "chat" ? `Reply to ${BOTS[active].name}…` : BOTS[active].ask) : box.placeholder); }
if (SR) {
  $("micBtn").hidden = false;
  $("micBtn").onclick = () => {
    if (!active) { nudge(); return; }
    if (listening) { stopVoice(); return; }
    rec = new SR();
    rec.lang = navigator.language || "en-US"; rec.interimResults = true; rec.continuous = true;
    voiceBase = box.value ? box.value.replace(/\s*$/, " ") : "";
    rec.onresult = e => {
      let finalText = "", interim = "";
      for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
      box.value = voiceBase + finalText + interim; autosize(); updateSend();
    };
    rec.onerror = e => {
      status.textContent = e.error === "not-allowed" || e.error === "service-not-allowed" ? "Allow the microphone for this site to use voice typing."
        : e.error === "no-speech" ? "Didn't hear anything. Try again." : e.error === "network" ? "Voice typing needs an internet connection." : e.error === "aborted" ? "" : "Voice typing stopped. Try again.";
    };
    rec.onend = () => { setMic(false); box.focus(); };
    try { rec.start(); setMic(true); status.textContent = ""; } catch (_) { setMic(false); }
  };
}
form.addEventListener("submit", stopVoice, true);

// ---------- Sidebar extras: search, what's new, shortcuts ----------
const NEWS_VERSION = "2026-10-bigupdate";
function focusSearch(){ setSide(true); const q = $("q"); q.focus(); q.select(); }
$("searchNav").onclick = focusSearch;
try { $("newDot").hidden = localStorage.getItem("orbs-news") === NEWS_VERSION; } catch(_) { $("newDot").hidden = false; }
document.addEventListener("click", e => { if (e.target.closest('[data-open="newsModal"]')) { $("newDot").hidden = true; try { localStorage.setItem("orbs-news", NEWS_VERSION); } catch(_) {} } }, true);
document.addEventListener("keydown", e => {
  if (!user || !gate.hidden) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const typing = /^(input|textarea|select)$/i.test((document.activeElement || {}).tagName || "");
  if (mod && k === "k") { e.preventDefault(); focusSearch(); }
  else if (mod && e.shiftKey && k === "o") { e.preventDefault(); $("sideNew").click(); }
  else if (mod && k === "b") { e.preventDefault(); setSide(shell.classList.contains("closed")); }
  else if (mod && k === ",") { e.preventDefault(); openSet(); }
  else if (!mod && k === "/" && !typing) { e.preventDefault(); box.focus(); }
  else if (k === "escape" && busy && POPUPS.every(id => $(id).hidden) && $("settings").hidden) { ctl?.abort(); }
});

// ---------- Terms and Privacy pop-ups ----------
let legalBack = null;
function openLegal(id){ legalBack = document.activeElement; $(id).hidden = false; $(id).querySelector("[data-close]").focus(); }
const POPUPS = ["tosModal","privModal","safetyModal","reportModal","helpModal","newsModal","keysModal","fbModal","adminModal","planModal"];
function closeLegal(){ for (const id of POPUPS) $(id).hidden = true; if (legalBack && legalBack.focus) legalBack.focus(); }
document.addEventListener("click", e => {
  const o = e.target.closest("[data-open]"); if (o) { e.preventDefault(); openLegal(o.dataset.open); return; }
  if (e.target.closest("[data-close]") || e.target.classList.contains("legal-modal")) closeLegal();
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && POPUPS.some(id => !$(id).hidden)) { e.stopImmediatePropagation(); closeLegal(); } }, true);

$("repSend").onclick = () => busyBtn($("repSend"), async () => {
  if (!user) return;
  try {
    const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/-/g, "");
    await F.setDoc(F.doc(db, "reports", id), { uid: user.uid, orb: active || "", reply: reportText, reason: $("repReason").value.trim().slice(0, 300), kids: !!kids.on, at: Date.now() });
    $("repMsg").textContent = "Thanks! Your report was sent."; $("repSend").disabled = true; setTimeout(closeLegal, 1200);
  } catch (e) { $("repMsg").textContent = "Couldn't send the report. Try again."; }
});

// ---------- Paid plans (Stripe) ----------
const PLAN_NAMES = { plus:"Plus", plusplus:"Plus Plus", plusplusplus:"Plus Plus Plus" };
const PLAN_INFO = [
  { id:"plus", name:"Plus", color:"#4f7bff", month:9.99, year:99.99, perks:["100 credits a day (2,000 a month)", "Chrysalis unlocked", "10 web searches a day"], soon:[] },
  { id:"plusplus", name:"Plus Plus", color:"#9b5cff", month:19.99, year:199.99, pop:true, perks:["200 credits a day (4,000 a month)", "Chrysalis and Mythos unlocked", "25 web searches a day"], soon:["Memory", "Custom orbs"] },
  { id:"plusplusplus", name:"Plus Plus Plus", color:"#ff5fb8", month:49.99, year:499.99, perks:["500 credits a day (10,000 a month)", "Every model", "50 web searches a day", "New features first"], soon:["Memory", "Custom orbs"] },
];
const needPlan = m => m >= 3 ? "plusplus" : "plus";
function lockedModel(m){ return Array.isArray(kids.models) && !kids.models.includes(m); }
let planInterval = "month";
async function refreshStatus(){ if (!user) return; try { await kidsApi(user, { action:"status" }); renderUsage(); renderPlan(); syncSel(); } catch(_) {} }
const fmtDate = sec => sec ? new Date(sec * 1000).toLocaleDateString([], { month:"short", day:"numeric", year:"numeric" }) : "";
function renderPlan(){
  const p = kids.plan, on = !!kids.billing;
  const testing = kids.owner && kids.viewAs && kids.viewAs !== "owner";
  $("planTxt").textContent = testing ? `Testing as ${p ? "Orbs " + p.name : "Free"} 🧪` : p ? `Orbs ${p.name} (${p.interval === "year" ? "yearly" : "monthly"})` + (kids.owner ? " + Owner 👑" : "") : kids.owner ? "Owner 👑 (everything unlocked)" : "Free";
  $("viewBox").hidden = !kids.owner;
  for (const b of document.querySelectorAll("#viewSeg button")) b.setAttribute("aria-pressed", String(b.dataset.v === (kids.viewAs || "owner")));
  $("planMore").textContent = testing ? "You're seeing Orbs like someone on this plan. Switch back to Owner below when you're done." : p ? (p.cancelAtPeriodEnd ? `Cancelled. You keep ${p.name} until ${fmtDate(p.periodEnd)}.` : p.status === "past_due" ? "Your last payment didn't go through. Update your card in Manage so you don't lose your plan." : `Renews ${fmtDate(p.periodEnd)}.`)
    : kids.owner ? "You get every model, 99,999 credits a day, no monthly cap, and as many web searches as the site allows. You can still test buying a plan." : on ? "Koa and Lumina, with daily free credits. Upgrade for more credits, Chrysalis, Mythos, and more web searches." : "";
  $("planBtn").hidden = !on && !p; $("planBtn").textContent = p ? "Manage" : "Upgrade";
  $("upNav").hidden = !user || !on; $("upNavTxt").textContent = testing ? "Testing 🧪" : p ? `Orbs ${p.name}` : kids.owner ? "Owner 👑" : "Upgrade";
  $("planBtn").hidden = $("planBtn").hidden || testing;
  $("limitUp").hidden = !on || (p && p.id === "plusplusplus");
}
for (const b of document.querySelectorAll("#viewSeg button")) b.onclick = () => busyBtn(b, async () => {
  $("viewMsg").textContent = "Switching…";
  try { await adminApi({ action:"viewAs", plan: b.dataset.v }); await refreshStatus(); limitHit = !!credits && credits.left === 0; renderUsage();
    $("viewMsg").textContent = b.dataset.v === "owner" ? "Back to Owner 👑. Everything unlocked." : `Now testing as ${b.textContent}. Nothing is charged.`; }
  catch (_) { $("viewMsg").textContent = "Couldn't switch. Try again."; }
});
$("planBtn").onclick = () => { if (kids.plan) billing({ action:"portal" }, $("planBtn"), $("setMsg")); else openPlans(); };
$("upNav").onclick = () => openPlans();
$("limitUp").onclick = () => openPlans();
for (const b of document.querySelectorAll("#planSeg button")) b.onclick = () => { planInterval = b.dataset.i; renderPlans(); };
function openPlans(){ $("planMsg").textContent = ""; renderPlans(); openLegal("planModal"); refreshStatus().then(() => { if (!$("planModal").hidden) renderPlans(); }); }
function renderPlans(){
  for (const b of document.querySelectorAll("#planSeg button")) b.setAttribute("aria-pressed", String(b.dataset.i === planInterval));
  const grid = $("planGrid"); grid.innerHTML = "";
  const cur = kids.plan ? kids.plan.id : null, on = !!kids.billing;
  // Free
  const free = el("div", "pcard" + (!cur ? " cur" : "")); free.style.setProperty("--pc", "#6e6b64");
  const fl = el("ul"); [credits && credits.limit && !cur ? `${credits.limit} credits a day` : "Daily free credits", "Koa and Lumina", !cur && Number.isInteger(kids.webPerDay) ? `${kids.webPerDay} web searches a day` : "A few web searches a day"].forEach(t => fl.append(el("li", null, t)));
  const fb = el("button", "outline", !cur ? "Current plan" : "Included"); fb.type = "button"; fb.disabled = true;
  free.append(el("h3", null, "Free"), el("div", "price", "$0"), fl, fb); grid.append(free);
  for (const pl of PLAN_INFO) {
    const c = el("div", "pcard" + (pl.id === cur ? " cur" : "") + (pl.pop && !cur ? " pop" : "")); c.style.setProperty("--pc", pl.color);
    const price = el("div", "price", "$" + (planInterval === "year" ? pl.year : pl.month)); price.append(el("small", null, planInterval === "year" ? " / year" : " / month"));
    const ul = el("ul"); pl.perks.forEach(t => ul.append(el("li", null, t))); pl.soon.forEach(t => ul.append(el("li", "soon", t + " (coming soon)")));
    const b = el("button", "gbtn"); b.type = "button";
    if (kids.plan && kids.plan.test) { b.textContent = pl.id === cur ? "Testing this 🧪" : "Switch to Owner to buy"; b.disabled = true; }
    else if (!on) { b.textContent = "Coming soon"; b.disabled = true; }
    else if (pl.id === cur) { b.textContent = "Manage"; b.onclick = () => billing({ action:"portal" }, b, $("planMsg")); }
    else if (cur) { b.textContent = "Switch"; b.onclick = () => billing({ action:"portal" }, b, $("planMsg")); }
    else { b.textContent = "Upgrade"; b.onclick = () => billing({ action:"checkout", plan: pl.id, interval: planInterval }, b, $("planMsg")); }
    c.append(el("h3", null, pl.name), price, ul, b); grid.append(c);
  }
}
// Sends you to Stripe: checkout to buy, or the portal to change or cancel
function billing(body, btn, msgEl){
  return busyBtn(btn, async () => {
    if (!user) return;
    msgEl.textContent = "Opening Stripe…";
    try {
      const r = await fetch("/api/billing", { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer " + await user.getIdToken() }, body: JSON.stringify(body) });
      let j = {}; try { j = await r.json(); } catch(_) {}
      if (j.url && /^https:\/\/([a-z0-9-]+\.)*stripe\.com\//.test(j.url)) { location.href = j.url; return; }
      if (j.error === "already_subscribed") return billing({ action:"portal" }, btn, msgEl);
      msgEl.textContent = j.error === "billing_off" ? "Paid plans aren't turned on yet." : j.error === "no_subscription" ? "You don't have a plan yet." : "Couldn't open Stripe. Try again.";
    } catch (_) { msgEl.textContent = "Couldn't reach Orbs. Check your connection."; }
  });
}
// Coming back from Stripe
async function afterBilling(){
  const q = new URLSearchParams(location.search), c = q.get("checkout"), back = q.get("billing");
  if (!c && !back) return;
  history.replaceState(null, "", location.pathname);
  if (c === "cancel") { status.textContent = "Checkout cancelled. No worries, nothing was charged."; return; }
  if (back) { await refreshStatus(); return; }
  status.textContent = "🎉 Payment done! Setting up your plan…";
  // Stripe tells Orbs a few seconds after paying, so check a few times
  for (let i = 0; i < 12; i++) {
    await refreshStatus();
    if (kids.plan) { status.textContent = `🎉 Welcome to Orbs ${kids.plan.name}! Thanks for supporting Orbs.`; return; }
    await new Promise(r => setTimeout(r, 2500));
  }
  status.textContent = "Your payment went through. Your plan should show up in a minute. Refresh if it doesn't.";
}

// ---------- Admin panel (only for the emails in ADMIN_EMAILS on Vercel) ----------
async function adminApi(body){
  const r = await fetch("/api/admin", { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer " + await user.getIdToken() }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch(_) {}
  if (!r.ok) throw new Error(j.error || "failed");
  return j;
}
async function checkAdmin(){
  $("adminNav").hidden = true;
  try { const j = await adminApi({ action:"check" }); $("adminNav").hidden = !j.admin; } catch(_) {}
}
let adminData = null, adminTab = "overview";
const money = c => "$" + (c / 100).toFixed(c < 100 ? 3 : 2);
const when = t => t ? new Date(t).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }) : "";
const MODEL_NAMES = ["Koa","Lumina","Chrysalis","Mythos"];
async function openAdmin(){
  openLegal("adminModal"); adminTab = adminTab || "overview";
  $("admBody").replaceChildren(el("p", "fine", "Loading…"));
  try { adminData = await adminApi({ action:"load" }); renderAdmin(); }
  catch (e) { $("admBody").replaceChildren(el("p", "fine", e.message === "not_admin" ? "This account isn't an admin." : "Couldn't load the admin panel. Try again.")); }
}
$("adminNav").onclick = openAdmin;
$("admRefresh").onclick = openAdmin;
for (const b of document.querySelectorAll("#admTabs button")) b.onclick = () => { adminTab = b.dataset.tab; renderAdmin(); };
function card(label, value, sub){ const c = el("div", "astat"); c.append(el("small", null, label), el("b", null, value)); if (sub) c.append(el("span", null, sub)); return c; }
function renderAdmin(){
  for (const b of document.querySelectorAll("#admTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === adminTab));
  const d = adminData, body = $("admBody"); body.innerHTML = ""; if (!d) return;
  const today = d.stats.find(s => s.day === d.today) || { messages:0, cents:0, searches:0 };
  if (adminTab === "overview") {
    const month = d.stats.filter(s => s.day.slice(0, 7) === d.today.slice(0, 7)).reduce((n, s) => n + s.cents, 0);
    const grid = el("div", "agrid");
    grid.append(card("Spent today (about)", money(today.cents), today.messages + " messages"), card("This month (about)", money(month)),
      card("Web searches today", String(d.searchesToday), "limit " + d.config.searchesSite + " for the whole site"),
      card("People", String(d.users.total), d.users.newWeek + " new this week"),
      card("Paying people", String(Object.values(d.subs || {}).reduce((n, v) => n + v, 0)), ["plus","plusplus","plusplusplus"].map(k => (PLAN_NAMES[k] + ": " + ((d.subs || {})[k] || 0))).join(" · ")), card("Kids Mode accounts", String(d.users.kidsOn), d.users.teens + " teens"),
      card("Open reports", String(d.reports.length), d.flags.length + " safety flags"));
    body.append(grid);
    // Last 14 days of spending
    const days = d.stats.slice(0, 14).reverse(), max = Math.max(1, ...days.map(s => s.cents));
    const chart = el("div", "abars"); chart.setAttribute("role", "img"); chart.setAttribute("aria-label", "Spending for the last 14 days");
    for (const s of days) { const col = el("div", "abar"); const bar = el("i"); bar.style.height = Math.max(2, s.cents / max * 100) + "%"; col.title = s.day + ": " + money(s.cents) + ", " + s.messages + " messages"; col.append(bar, el("small", null, s.day.slice(8))); chart.append(col); }
    body.append(el("h3", null, "Spending, last 14 days"), days.length ? chart : el("p", "fine", "No messages yet."));
    const mix = d.stats.slice(0, 7).reduce((o, s) => { o[0] += s.koa; o[1] += s.lumina; o[2] += s.chrysalis; o[3] += s.mythos; return o; }, [0,0,0,0]);
    body.append(el("h3", null, "Messages per model, last 7 days"), el("p", "fine", MODEL_NAMES.map((n, i) => n + ": " + mix[i]).join(" · ")));
    body.append(el("p", "fine", "These are estimates from Orbs. Your real bill is in the Claude Console."));
  }
  if (adminTab === "settings") {
    const c = d.config, f = el("form", "aform");
    const sw = (key, label, help) => { const r = el("label", "arow"); const i = el("input"); i.type = "checkbox"; i.name = key; i.checked = !!c[key]; r.append(i, el("span", null, label)); if (help) r.append(el("small", "fine", help)); return r; };
    const numIn = (key, label, help) => { const r = el("label", "arow num"); const i = el("input"); i.type = "number"; i.min = "0"; i.max = "10000000"; i.name = key; i.value = c[key] == null ? "" : c[key]; i.placeholder = key.startsWith("searches") ? "0" : "No limit"; r.append(el("span", null, label), i); if (help) r.append(el("small", "fine", help)); return r; };
    f.append(
      sw("paused", "Pause Orbs (emergency stop)", "Nobody can send messages while this is on."),
      (() => { const r = el("label", "arow num"); const i = el("input"); i.name = "pausedMsg"; i.maxLength = 300; i.value = c.pausedMsg || ""; i.placeholder = "Message to show (optional)"; r.append(el("span", null, "Pause message"), i); return r; })(),
      sw("webSearch", "Allow web search", "About 1 cent per search, plus a bit more for reading the results."),
      numIn("searchesPerUser", "Web searches per person per day"),
      numIn("searchesSite", "Web searches per day for the whole site"),
      numIn("dailyCredits", "Daily credits per person", "Empty or 0 = unlimited. Koa uses 1 per message, Lumina 3, Chrysalis 6, Mythos 10 (more at higher effort)."),
      numIn("siteCredits", "Daily credits for the whole site", "Empty or 0 = unlimited."),
      sw("kidsForAll", "Kids Mode for everyone", "Turns on Kids Mode for every account on the site."));
    const go = el("button", "gbtn", "Save settings"); go.type = "submit"; const msg = el("small", "fine"); f.append(go, msg);
    f.onsubmit = e => { e.preventDefault(); busyBtn(go, async () => {
      const out = {};
      for (const i of f.querySelectorAll("input")) {
        if (i.type === "checkbox") out[i.name] = i.checked;
        else if (i.type === "number") out[i.name] = i.value === "" ? (i.name.startsWith("searches") ? 0 : null) : Math.max(0, Math.floor(Number(i.value)) || 0);
        else out[i.name] = i.value.trim();
      }
      try { const j = await adminApi({ action:"settings", settings: out }); adminData.config = { ...adminData.config, ...j.settings }; msg.textContent = "Saved! It takes up to 30 seconds to kick in."; }
      catch (_) { msg.textContent = "Couldn't save. Try again."; }
    }); };
    body.append(f);
  }
  const list = (items, empty, row) => { if (!items.length) { body.append(el("p", "fine", empty)); return; } for (const it of items) body.append(row(it)); };
  const banBtn = (uid, banned) => { const b = el("button", "outline small", banned ? "Unban" : "Ban"); b.type = "button";
    b.onclick = () => armed(b, banned ? "Tap to unban" : "Tap to ban", () => busyBtn(b, async () => { try { await adminApi({ action: banned ? "unban" : "ban", uid }); b.textContent = banned ? "Unbanned" : "Banned"; } catch (e) { b.textContent = e.message === "self" ? "That's you!" : "Failed"; } })); return b; };
  const dismissBtn = (kind, id, rowEl) => { const b = el("button", "outline small", "Dismiss"); b.type = "button";
    b.onclick = () => busyBtn(b, async () => { try { await adminApi({ action:"dismiss", kind, id }); rowEl.remove(); } catch (_) { b.textContent = "Failed"; } }); return b; };
  if (adminTab === "reports") {
    body.append(el("h3", null, "Reported replies"));
    list(d.reports, "No reports. Nice!", r => { const x = el("div", "aitem"); x.append(el("div", "ameta", `${BOTS[r.orb]?.name || "?"} · ${when(r.at)}${r.kids ? " · 🛡️ Kids Mode" : ""}`));
      if (r.reason) x.append(el("p", "areason", "“" + r.reason + "”"));
      const q = el("div", "aquote"); q.textContent = r.reply || ""; x.append(q);
      const bar = el("div", "abtns"); bar.append(dismissBtn("report", r.id, x), banBtn(r.uid, false)); x.append(bar); return x; });
    body.append(el("h3", null, "Kids Mode safety flags"), el("p", "fine", "What Kids Mode blocked. The messages themselves aren't saved."));
    list(d.flags, "No safety flags.", f => { const x = el("div", "aitem"); x.append(el("div", "ameta", `${(f.type || "").replace(/_/g, " ")}${f.category ? " (" + f.category.toLowerCase() + ")" : ""} · ${BOTS[f.orb]?.name || "?"} · ${when(f.at)}`));
      const bar = el("div", "abtns"); bar.append(dismissBtn("flag", f.id, x)); x.append(bar); return x; });
  }
  if (adminTab === "feedback") {
    const by = MODEL_NAMES.map(() => ({ up:0, down:0 }));
    for (const f of d.feedback) if (by[f.model]) by[f.model][f.vote === "up" ? "up" : "down"]++;
    const grid = el("div", "agrid");
    MODEL_NAMES.forEach((n, i) => grid.append(card(n, `👍 ${by[i].up}  👎 ${by[i].down}`)));
    body.append(el("h3", null, "Thumbs, latest 300"), grid, el("h3", null, "Thumbs down"));
    list(d.feedback.filter(f => f.vote === "down"), "No thumbs down yet.", f => { const x = el("div", "aitem");
      x.append(el("div", "ameta", `${MODEL_NAMES[f.model] || "?"} · ${BOTS[f.orb]?.name || "?"} · ${when(f.at)}${f.tag ? " · " + f.tag.replace(/_/g, " ") : ""}`));
      if (f.reason) x.append(el("p", "areason", "“" + f.reason + "”"));
      if (f.reply) { const q = el("div", "aquote"); q.textContent = f.reply; x.append(q); }
      const bar = el("div", "abtns"); bar.append(dismissBtn("feedback", f.id, x)); x.append(bar); return x; });
  }
  if (adminTab === "users") {
    body.append(el("h3", null, `Newest people (${d.users.total} total)`));
    list(d.users.list, "Nobody yet.", u => { const x = el("div", "aitem auser");
      const info = el("div"); info.append(el("b", null, u.name || u.email || u.uid), el("div", "ameta", `${u.email} · joined ${when(u.created)}${u.last ? " · last seen " + when(u.last) : ""}${u.age ? " · " + (u.age === "adult" ? "18+" : u.age === "teen" ? "13-17" : "under 13") : ""}${u.plan ? " · " + PLAN_NAMES[u.plan] : ""}${u.banned ? " · BANNED" : ""}`));
      x.append(info, banBtn(u.uid, u.banned)); return x; });
  }
}

// ---------- Newest models ----------
// The server always uses the newest Claude model in each family; this shows its name and Orbs version.
async function loadModels(){
  try {
    const r = await fetch("/api/models"); if (!r.ok) return;
    const j = await r.json();
    (j.models || []).forEach((m, i) => {
      if (!MODELS[i] || !m) return;
      if (typeof m.version === "string" && /^\d+\.\d{2}$/.test(m.version)) MODELS[i].v = m.version;
      if (typeof m.base === "string" && m.base) MODELS[i].base = m.base;
      if (typeof m.effort === "boolean") MODELS[i].effort = m.effort;
    });
    syncSel();
  } catch (e) {}
}

// ---------- Start ----------
renderUsage();
loadModels();
(async () => {
  showGate("loading");
  const ready = firebaseConfig && ["apiKey","authDomain","projectId","appId"].every(k => firebaseConfig[k] && firebaseConfig[k] !== "PASTE_HERE");
  if (!ready) { showGate("setup"); return; }
  try {
    const [appMod, authMod, fsMod] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);
    A = authMod; F = fsMod;
    const app = appMod.initializeApp(firebaseConfig);
    auth = A.getAuth(app); db = F.getFirestore(app);
  } catch (e) { $("aTitle").textContent = "Orbs couldn't start"; $("aText").textContent = "Couldn't load the sign-in tools. Check your connection and refresh."; return; }
  setAuthMode("in"); showGate("loading");
  A.onAuthStateChanged(auth, async u => {
    if (!u) { clearTimeout(cloudT); loaded = false; user = null; resetState(); renderProfile(); closeSet(); renderHome(); showGate("home"); return; }
    const usesPassword = u.providerData.some(p => p.providerId === "password");
    if (usesPassword && !u.emailVerified) { user = null; showGate("verify", u.email); return; }
    await enter(u);
  });
})();
