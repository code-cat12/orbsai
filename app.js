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
  },
  // Halloween orbs (October only)
  spooks: {
    name:"Spooks", role:"Halloween Party", glyph:"S", color:"--c-spooks", season:true,
    ask:"Oh my gourd, what are we planning?",
    chips:["Last-minute costume with stuff I have","Easy pumpkin carving design","Spooky snacks for a party"]
  },
  hex: {
    name:"Hex", role:"Ghost Stories", glyph:"H", color:"--c-hex", season:true,
    ask:"Hehehe… what do you seek, mortal?",
    chips:["Tell me a cozy spooky story","Give me a spooky riddle","Read my (totally made-up) fortune"]
  }
};
const ORDER = ["neb","tech","cook","game","web","write","study","music","lang"];
// Halloween orbs show up in October (Eastern time)
const IN_OCT = (() => { try { return new Date().toLocaleString("en-US", { timeZone:"America/New_York", month:"numeric", year:"numeric" }) === "10/2026"; } catch(_) { const n = new Date(); return n.getMonth() === 9 && n.getFullYear() === 2026; } })();   // October 2026 only, no yearly repeat
let seasonOn = IN_OCT;   // the owner can force Halloween on or off in the admin panel
const pickOrder = () => seasonOn ? [...ORDER, "spooks", "hex"] : ORDER;
const seasonP = fetch("/api/season").then(r => r.ok ? r.json() : null).then(j => {
  if (j && typeof j.halloween === "boolean" && j.halloween !== seasonOn) { seasonOn = j.halloween; renderLandingBonus(); if (user) renderPicker(); }
}).catch(() => {});

const $ = id => document.getElementById(id);
const app = $("app"), log = $("log"), box = $("box"), sendBtn = $("send"), status = $("status"), form = $("form");
let active = null, busy = false, ctl = null, user = null;
let webOn = false, incogNext = false;      // web search for this chat; next new chat is incognito
let opts = { think: true, memory: true };                // your settings that aren't per-orb (saved to your account)
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
setInterval(() => { if (app.dataset.view === "home" && $("greet") && !incogNext && active) $("greet").textContent = greeting(); }, 60000);

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
// 🎃 Spooks (pumpkin) and 👻 Hex (blue ghost with a bow), drawn in the same flat style as the others
ORB.spooks = { shape:`<ellipse cx="33" cy="66" rx="20" ry="24"/><ellipse cx="67" cy="66" rx="20" ry="24"/>
    <ellipse cx="33" cy="66" rx="20" ry="24" fill="#000" opacity=".13"/><ellipse cx="67" cy="66" rx="20" ry="24" fill="#000" opacity=".13"/>
    <ellipse cx="50" cy="65" rx="22" ry="26"/>`, ey:60, tilt:14, eyeFill:"#ffd23f",
  back:() => { const id = "spg" + (++nebN); return `<defs><radialGradient id="${id}"><stop offset="0" stop-color="#ffb02e" stop-opacity=".9"/><stop offset="1" stop-color="#ffb02e" stop-opacity="0"/></radialGradient></defs><ellipse class="o-candle" cx="50" cy="64" rx="46" ry="40" fill="url(#${id})"/>`; },
  acc:`<path class="o-dk" d="M46.5 41C46 34 47.5 29 51.5 25.5L56.5 28C53.5 31.5 53 35.5 53.5 41Z" fill="#2f7d32"/>
    <path d="M55 29C59 23 67 23 67 29C67 33 62 33 62 30" fill="none" stroke="#2f7d32" stroke-width="2.6" stroke-linecap="round"/>
    <g class="o-spider"><path d="M22 8V38" stroke="${INK}" stroke-width="1" opacity=".55"/><g class="o-dk" fill="${INK}"><circle cx="22" cy="40" r="3.6"/><path d="M18.5 38l-4-3M18.5 41l-4.5 0M18.5 43l-4 3M25.5 38l4-3M25.5 41l4.5 0M25.5 43l4 3" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/></g></g>
    <g class="o-bat o-dk" fill="${INK}"><path class="wl" d="M82 20C78 15 73 15 71 18C74 18 75 20 75 22C77 21 79 21 82 23Z"/><path class="wr" d="M82 20C86 15 91 15 93 18C90 18 89 20 89 22C87 21 85 21 82 23Z"/><ellipse cx="82" cy="21" rx="2.6" ry="3.2"/></g>` };
ORB.hex = { shape:`<g class="o-ghostbody"><path d="M50 27C66 27 76 39 76 53C76 68 68 77 60 83C55 87 54 92 59 96C48 97 41 91 43 84C33 79 24 69 24 53C24 39 34 27 50 27Z" fill="url(#hexg)" stroke="currentColor" stroke-opacity=".55" stroke-width="1.2"/>
    <ellipse cx="50" cy="52" rx="15" ry="14" fill="#fff" opacity=".22"/></g>`, ey:52, tilt:0,
  back:() => `<defs><linearGradient id="hexg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".85"/><stop offset=".6" stop-color="currentColor" stop-opacity=".55"/><stop offset="1" stop-color="currentColor" stop-opacity=".05"/></linearGradient></defs>`,
  acc:`<g class="o-bow"><path class="o-dk" d="M37 30.5C33 24 25 21 23.5 26C22 31 25 37.5 37 30.5Z" fill="#ff5fb8"/><path class="o-dk" d="M37 30.5C41 24 49 21 50.5 26C52 31 49 37.5 37 30.5Z" fill="#ff5fb8"/><path d="M35 33C33.5 36 32 38 30 39.5M39 33C40.5 36 42 38 44 39.5" stroke="#ff5fb8" stroke-width="2.4" stroke-linecap="round" fill="none"/><circle cx="37" cy="30.8" r="3.7" fill="#ff8fcd"/></g>
    <g class="o-wisp w1"><circle cx="16" cy="66" r="5" fill="#bfe6ff" opacity=".35"/><circle cx="16" cy="66" r="2.3" fill="#e8f6ff"/></g>
    <g class="o-wisp w2"><circle cx="85" cy="38" r="4.4" fill="#bfe6ff" opacity=".35"/><circle cx="85" cy="38" r="2" fill="#e8f6ff"/></g>
    <g class="o-wisp w3"><circle cx="80" cy="80" r="3.4" fill="#bfe6ff" opacity=".35"/><circle cx="80" cy="80" r="1.6" fill="#e8f6ff"/></g>` };
let nebN = 0;
// Orbs 2.0: same characters, now soft glowing gradient spheres-ish: a halo behind, a glossy highlight, a little ground shadow
function orbSVG(k){
  const o = ORB[k], y = o.ey, n = ++nebN;
  const eye = x => `<rect x="${x-3}" y="${y-8.5}" width="6" height="17" rx="3" fill="${o.eyeFill || (k === "neb" ? "var(--neb-eye)" : "#111")}" transform="rotate(${o.tilt} ${x} ${y})"/>`;
  const gloss = k === "hex" ? "" : `<g fill="url(#oh${n})" pointer-events="none">${o.shape}</g>`;
  return `<svg class="orb orb-${k}" viewBox="0 0 100 100" aria-hidden="true" style="color:var(${BOTS[k].color})">
    <defs><radialGradient id="og${n}" cx="50%" cy="55%" r="50%"><stop offset="0" stop-color="currentColor" stop-opacity=".42"/><stop offset=".6" stop-color="currentColor" stop-opacity=".12"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient>
      <radialGradient id="oh${n}" cx="34%" cy="26%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset=".34" stop-color="#fff" stop-opacity=".08"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient></defs>
    <ellipse class="o-halo2" cx="50" cy="62" rx="48" ry="42" fill="url(#og${n})"/>
    <ellipse class="o-shadow" cx="50" cy="96" rx="21" ry="3" fill="#000" fill-opacity=".12"/>
    <g class="o-hop"><g class="o-extra"><g class="o-squish">
      ${o.back ? o.back() : ""}<g fill="var(${BOTS[k].color})">${o.shape}</g>${gloss}
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
  for (const k of pickOrder()) {
    const b = BOTS[k], el = document.createElement("button");
    const inTeam = teamMode && (teamDraft.lead === k || teamDraft.helpers.includes(k));
    el.type = "button"; el.className = "bot" + (b.season ? " spooky" : "") + (teamMode && teamDraft.lead === k ? " lead" : ""); el.id = "pick-" + k;
    el.setAttribute("aria-pressed", String(teamMode ? inTeam : k === active));
    el.style.setProperty("--c", `var(${b.color})`);
    el.innerHTML = `<span class="g"></span><span class="n"></span><span class="r"></span>`;
    orbInto(el.querySelector(".g"), k);
    el.querySelector(".n").textContent = b.name;
    el.querySelector(".r").textContent = b.role;
    el.onclick = () => pick(k);
    wrap.appendChild(el);
  }
  const chips = $("chips"); chips.innerHTML = "";
  if (active) for (const c of teamMode ? TEAM_CHIPS : BOTS[active].chips) {
    const ch = document.createElement("button"); ch.type = "button"; ch.className = "chip"; ch.textContent = c;
    ch.onclick = () => send(c); chips.appendChild(ch);
  }
}

function renderHome(){
  app.dataset.view = "home"; log.innerHTML = "";
  const mark = $("mark");
  // Home with no orb picked = the dashboard (greeting, clock, usage, orbs, recent chats). Typing there asks Nebula.
  const dash = !active && !teamMode;
  app.classList.toggle("dashv", dash);
  $("greet").textContent = teamMode ? "Orb Teams" : greeting();
  if (dash) {
    mark.className = "mark empty"; mark.innerHTML = "";
    box.disabled = false; form.classList.remove("locked");
    box.placeholder = `Ask ${BOTS[DASH_ORB].name} anything…`;
    renderDash();
  } else if (active) {
    const b = BOTS[active];
    mark.className = "mark"; orbInto(mark, active);
    box.disabled = false; form.classList.remove("locked");
    box.placeholder = teamMode && teamHelpers(teamDraft).length ? "What should the team make?" : b.ask;
  } else {
    mark.className = "mark empty"; mark.innerHTML = ""; mark.textContent = "?";
    box.disabled = true; form.classList.add("locked");
    box.placeholder = teamMode ? "Pick orbs below for your team…" : "Pick an orb below to start…";
  }
  stopSpeak(); setAccent(); renderPicker(); updateSend(); snap(); renderSide(); renderIncog(); renderTeam();
}
// ---------- Home dashboard: greeting, live clock and date, usage, orbs, Orb Teams, recent chats ----------
const QUICK = [["neb","Plan a fun weekend for me"],["study","Help me study for a test"],["cook","What can I make for dinner tonight?"],["web","Make me a simple landing page"],["write","Give me a spooky story idea"],["tech","Why is my phone so slow?"]];
let lastClock = "";
function renderClock(){
  const now = new Date();
  const t = now.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  const key = t + now.getDate();
  if (key === lastClock) return; lastClock = key;
  const m = /^(.*?)(\s?[AaPp]\.?\s?[Mm]\.?)$/.exec(t);
  const c = $("dClock"); c.replaceChildren(m ? m[1] : t); if (m) c.append(el("small", null, m[2].trim()));
  $("dDate").textContent = now.toLocaleDateString([], { weekday:"long", month:"long", day:"numeric" });
  $("dGreet").textContent = greeting();
}
setInterval(() => { if (app.classList.contains("dashv")) renderClock(); }, 1000);
function orbCard(k){
  const b = BOTS[k], c = el("button", "ocard" + (b.season ? " spooky" : "")); c.type = "button";
  c.style.setProperty("--c", `var(${b.color})`);
  const g = el("span", "g"); orbInto(g, k);
  c.append(g, el("b", null, b.name), el("small", null, b.role));
  if (pins.includes(k)) c.append(el("span", "opin", "★"));
  c.onclick = () => pick(k);
  return c;
}
function renderDash(){
  lastClock = ""; renderClock();
  // Quick starts: each goes to the orb that fits it
  const chips = $("dChips"); chips.replaceChildren();
  for (const [k, text] of QUICK) {
    const ch = el("button", "qchip"); ch.type = "button"; ch.style.setProperty("--c", `var(${BOTS[k].color})`);
    const g = el("span", "g"); orbInto(g, k); ch.append(g, el("span", null, text));
    ch.onclick = () => { if (busy) return; active = k; cur = null; send(text); };
    chips.append(ch);
  }
  // Orbs: pinned first, then the ones used most recently, then the rest
  const used = Object.values(convs).filter(c => c.turns.length && !c.incog).sort((a, b) => (b.updated || 0) - (a.updated || 0)).map(c => c.orb);
  const order = [...new Set([...pins, ...used, ...pickOrder()])].filter(k => pickOrder().includes(k));
  $("dOrbs").replaceChildren(...order.map(orbCard));
  // Recent chats (chat and team)
  const rec = Object.values(convs).filter(c => c.turns.length && !c.incog).sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 5);
  const list = $("dRecent"); list.replaceChildren();
  for (const c of rec) {
    const r = el("button", "ritem"); r.type = "button"; r.style.setProperty("--c", `var(${BOTS[c.orb].color})`);
    const g = el("span", "g"); orbInto(g, c.orb);
    const tx = el("span", "tx"); tx.append(el("b", null, c.title || "New chat"), el("small", null, teamName(c.orb, c.team)));
    r.append(g, tx, el("time", null, fmtTime(c.updated)));
    r.onclick = () => openConv(c.id);
    list.append(r);
  }
  if (!rec.length) list.append(el("p", "pempty", "Your chats will show up here. Ask anything below, or tap an orb to start."));
  $("dAll").hidden = !rec.length;
  // Orb Teams card
  const allowed = teamAllowed();
  $("pTeamsTag").textContent = allowed ? "Ready" : "Light";
  $("pTeamsTag").classList.toggle("on", allowed);
  $("pTeamsGo").textContent = allowed ? "Start a team" : "Unlock with Light";
  const st = $("pTeamsOrbs"); if (!st.childElementCount) for (const k of ["web", "write", "music", "game"]) { const g = el("span", "g"); g.style.setProperty("--c", `var(${BOTS[k].color})`); orbInto(g, k); st.append(g); }
  renderUsage();
}
$("dAll").onclick = () => { setSide(true); };
$("pTeamsGo").onclick = () => { if (busy) return; if (!teamAllowed()) { openPlans(); return; } setTab(true); renderHome(); };
$("pUsageUp").onclick = () => openPlans();
$("searchTop").onclick = () => focusSearch();
$("avBtn").onclick = () => openSet();
// Incognito switch (top right after you pick an orb)
function renderIncog(){
  const home = app.dataset.view === "home", btn = $("incogBtn");
  btn.hidden = !home || !user || app.classList.contains("dashv"); btn.setAttribute("aria-pressed", String(incogNext)); btn.classList.toggle("on", incogNext);
  btn.title = incogNext ? "Turn off incognito" : "Incognito chat (not saved)";
  app.classList.toggle("incog", home && incogNext);
  if (home) {
    $("greet").textContent = incogNext ? "Incognito chat" : teamMode ? "Orb Teams" : greeting();
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
    if (Array.isArray(turn.tn) && turn.tn.length) col.appendChild(teamBox(turn.tn, false));
    if (turn.th) col.appendChild(thinkBox(turn.th, turn.tm));
    if (Array.isArray(turn.q) && turn.q.length) col.appendChild(searchedLine(turn.q));
    m.innerHTML = md(splitOptions(turn.content).body); col.appendChild(m);
    if (Array.isArray(turn.src) && turn.src.length) col.appendChild(sourcesBox(turn.src));
    if (Array.isArray(turn.mem) && turn.mem.length) col.appendChild(memChip(turn.mem));
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
  const col = el("div", "col"), team = el("div"), think = thinkBox("", 0, true), searched = el("div", "searched"), msg = el("div", "msg"), src = el("div");
  think.hidden = true; searched.hidden = true;
  col.append(team, think, searched, msg, src); row.appendChild(col); log.appendChild(row);
  return { row, team, think, searched, msg, src };
}
// Typing indicator: three soft dots in a bubble while the orb thinks (no avatar clutter under replies)
function tailOrb(thinking){
  log.querySelector(".tail")?.remove();
  if (!thinking) return null;
  const t = el("div", "tail row bot-row"); t.style.setProperty("--c", `var(${BOTS[active].color})`);
  const b = el("div", "typing"); b.setAttribute("aria-label", `${BOTS[active].name} is typing`);
  b.append(el("i"), el("i"), el("i")); t.append(b);
  log.appendChild(t); return t;
}

function renderChat(){
  const c = curConv(); if (!c) { renderHome(); return; }
  active = c.orb; webOn = !!c.web;
  app.dataset.view = "chat";
  const b = BOTS[active];
  orbInto($("topGlyph"), active); $("topName").textContent = teamName(active, c.team); $("topRole").textContent = c.incog ? "Incognito chat" : c.title || b.role;
  $("incogTag").hidden = !c.incog;
  box.disabled = false; form.classList.remove("locked");
  box.placeholder = `Reply to ${teamName(active, c.team)}…`;
  setAccent();
  log.innerHTML = "";
  if (c.incog) log.appendChild(el("div", "incognote", "🕶️ Incognito chat. It won't be saved, and it disappears when you leave."));
  const turns = c.turns;
  turns.forEach((t, i) => {
    bubble(t.role === "user" ? "user" : "assistant", t, i, i === turns.length - 1);
  });
  log.scrollTop = log.scrollHeight;
  updateSend(); snap(); renderSide(); renderIncog(); renderTeam();
}

// Incognito chats are never saved and vanish when you leave them
function dropIncog(keep){ for (const id of Object.keys(convs)) if (convs[id].incog && id !== keep) delete convs[id]; }

// ---------- Orb teams (Light and up): helpers each do their part, then the lead orb builds the final result ----------
const TEAM_MAX = 5;   // max orbs (lead included)
// The Teams tab (like Chat and Code in the Claude app): its own home screen and its own list of chats
let teamMode = false, teamDraft = { lead: null, helpers: [] }, teamOk = null, lastChatOrb = null;
try { teamMode = localStorage.getItem("orbs-tab") === "team"; } catch(_) {}
const teamAllowed = () => !!kids.plan || (!!kids.owner && (!kids.viewAs || kids.viewAs === "owner"));
const TEAM_CHIPS = ["Make me a video game", "Plan a birthday party with food and music", "Make a comic with a story and songs"];
// The team for what's on screen: the open chat's team, or the one being picked on the home screen
function curTeam(){ if (app.dataset.view === "chat") { const c = curConv(); return c && c.team || null; } return teamMode ? teamDraft : null; }
const teamHelpers = t => t ? t.helpers.filter(k => k !== t.lead && pickOrder().includes(k)) : [];
const teamName = (k, t) => BOTS[k].name + (t && teamHelpers(t).length ? "'s team" : "");
function teamToggle(k){
  const t = teamDraft;
  if (t.lead === k) t.lead = t.helpers.shift() || null;
  else if (t.helpers.includes(k)) t.helpers = t.helpers.filter(x => x !== k);
  else if (!t.lead) t.lead = k;
  else if (t.helpers.length + 1 >= TEAM_MAX) { status.textContent = `A team can have up to ${TEAM_MAX} orbs.`; return; }
  else t.helpers.push(k);
  status.textContent = "";
}
// "add Beat", "remove Quill and Abyss", "make Pixel the lead": only when the whole message is that (no Claude call, free)
const TEAM_ALIAS = { cook: ["miso", "chef"] };
function teamCommand(text){
  const s = String(text).toLowerCase().replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > 80) return null;
  const m = s.match(/^(?:please |pls |can you |hey )*(add|invite|bring in|bring|remove|kick out|kick|drop|take out|take off|make|set)\b(.*)$/);
  if (!m) return null;
  const words = [];
  for (const k of pickOrder()) { words.push([BOTS[k].name.toLowerCase(), k]); for (const a of TEAM_ALIAS[k] || []) words.push([a, k]); }
  words.sort((a, b) => b[0].length - a[0].length);
  let rest = " " + m[2] + " "; const found = [];
  for (const [w, k] of words) { const re = new RegExp("(^|\\s)" + w + "(?=\\s|$)", "g"); if (re.test(rest)) { if (!found.includes(k)) found.push(k); rest = rest.replace(re, " "); } }
  const left = rest.replace(/(^|\s)(and|&|also|too|the|to|from|in|into|out|of|on|my|our|this|team|teams|orb|orbs|as|be|lead|leader|boss|main|one|please|pls|back|again|now)(?=\s|$)/g, " ").trim();
  if (!found.length || left) return null;
  if (m[1] === "make" || m[1] === "set") return found.length === 1 && /(^|\s)(lead|leader|boss|main)(\s|$)/.test(s) ? { lead: found[0] } : null;
  return /^(add|invite|bring)/.test(m[1]) ? { add: found } : { remove: found };
}
function applyTeam(cmd){
  const conv = app.dataset.view === "chat" ? curConv() : null;
  const t = conv ? conv.team : teamMode ? teamDraft : null;
  if (!t) return "";
  const names = ks => ks.map(k => BOTS[k].name).join(" and ");
  const out = [], added = [], gone = [];
  for (const k of cmd.add || []) {
    if (!t.lead) { t.lead = k; added.push(k); }
    else if (k === t.lead || t.helpers.includes(k)) out.push(`${BOTS[k].name} is already on the team.`);
    else if (t.helpers.length + 1 >= TEAM_MAX) { out.push(`A team can have up to ${TEAM_MAX} orbs.`); break; }
    else { t.helpers.push(k); added.push(k); }
  }
  for (const k of cmd.remove || []) {
    if (k === t.lead) { if (!t.helpers.length) { out.push("A team needs at least one orb."); continue; } t.lead = t.helpers.shift(); gone.push(k); }
    else if (t.helpers.includes(k)) { t.helpers = t.helpers.filter(x => x !== k); gone.push(k); }
    else out.push(`${BOTS[k].name} isn't on the team.`);
  }
  if (cmd.lead && !t.lead) { t.lead = cmd.lead; out.unshift(`${BOTS[cmd.lead].name} is the lead now.`); }
  else if (cmd.lead && cmd.lead !== t.lead) {
    const k = cmd.lead;
    if (!t.helpers.includes(k) && t.helpers.length + 1 >= TEAM_MAX) out.push(`A team can have up to ${TEAM_MAX} orbs.`);
    else { t.helpers = [t.lead, ...t.helpers.filter(x => x !== k)]; t.lead = k; out.unshift(`${BOTS[k].name} is the lead now.`); }
  }
  if (added.length) out.unshift(`Added ${names(added)} to the team.`);
  if (gone.length) out.unshift(`Removed ${names(gone)} from the team.`);
  active = t.lead;
  if (conv) { conv.orb = t.lead; conv.updated = Date.now(); save(); renderChat(); } else renderHome();
  return out.join(" ");
}
// The row of team members above the chat box
function renderTeam(){
  const bar = $("teamBar"), t = curTeam(), home = app.dataset.view === "home";
  // Free people can open the Teams tab, but everything is locked behind the Upgrade card
  const locked = home && teamMode && !!user && !teamAllowed();
  app.classList.toggle("teamlocked", locked); $("teamGate").hidden = !locked;
  $("teamNote").hidden = !(home && teamMode) || locked;
  for (const id of ["box", "send"]) $(id).toggleAttribute("inert", locked);
  $("pickLbl").textContent = home && teamMode ? "Pick your team (the first one you tap is the lead)" : "Pick your orb";
  if (!t || !t.lead || (home && !teamMode)) { bar.hidden = true; bar.replaceChildren(); return; }
  bar.hidden = false; bar.replaceChildren(el("span", "tl", "Team"));
  for (const k of [t.lead, ...teamHelpers(t)]) {
    const chip = el("span", "tchip" + (k === t.lead ? " lead" : "")); chip.style.setProperty("--c", `var(${BOTS[k].color})`);
    const g = el("span", "g"); orbInto(g, k);
    const n = el("button", "tn", BOTS[k].name); n.type = "button"; if (k === t.lead) n.append(el("span", "lb", "Lead"));
    n.title = k === t.lead ? "The lead builds the final result" : `Make ${BOTS[k].name} the lead`;
    n.onclick = () => { if (busy || k === t.lead) return; status.textContent = applyTeam({ lead: k }); };
    const x = el("button", "tx", "×"); x.type = "button"; x.title = `Remove ${BOTS[k].name}`; x.setAttribute("aria-label", `Remove ${BOTS[k].name}`);
    x.onclick = () => { if (busy) return; status.textContent = applyTeam({ remove: [k] }); };
    chip.append(g, n); if (t.helpers.length) chip.append(x); bar.append(chip);
  }
  bar.append(el("span", "ttip", teamHelpers(t).length ? 'Say "add Beat" or "remove Quill" any time. Tap a name to make it the lead.' : 'Add orbs to the team: say "add Quill and Beat"' + (home ? " or tap them below." : ".")));
}
function setTab(team){
  if (team !== teamMode) { if (team) lastChatOrb = active; teamMode = team; teamDraft = { lead: null, helpers: [] }; if (app.dataset.view !== "chat") active = team ? null : lastChatOrb; }
  try { localStorage.setItem("orbs-tab", team ? "team" : "chat"); } catch(_) {}
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String((b.dataset.tab === "team") === teamMode));
}
for (const b of document.querySelectorAll("[data-tab]")) b.onclick = () => {
  if (busy) return;
  dropIncog(null); cur = null; webOn = false; teamOk = null; status.textContent = ""; box.value = ""; autosize();
  app.dataset.view = "home"; setTab(b.dataset.tab === "team"); if (!teamMode) active = null; renderHome(); if (mobile()) setSide(false);
};
setTab(teamMode);
$("teamUp").onclick = () => openPlans();
// Team progress and notes that go with a reply
function teamBox(list, live, lead){
  const d = el("details", "teambox"); if (live) d.open = true;
  const done = list.filter(x => x.s === "ok");
  d.append(el("summary", null, live ? "The team is working…" : `Team notes: ${done.map(x => BOTS[x.k] ? BOTS[x.k].name : "").filter(Boolean).join(", ") || "none"}`));
  for (const x of list) {
    const b = BOTS[x.k]; if (!b) continue;
    const step = el("div", "tstep"), name = el("b", null, b.name);
    if (x.s === "go") { step.classList.add("go"); step.append(name, " is doing their part…"); }
    else if (x.s === "ok") step.append(name, x.n ? " did their part:" : " did their part.");
    else if (x.s === "fail") step.append(name, " couldn't help this time.");
    else if (x.s === "skip") step.append(name, " was skipped to save time.");
    d.append(step);
    if (x.s === "ok" && x.n) { const n = el("div", "tnote"); n.style.setProperty("--c", `var(${b.color})`); const m = el("div", "msg"); m.innerHTML = md(x.n); n.append(m); d.append(n); }
  }
  if (live && lead && BOTS[lead]) { const step = el("div", "tstep"); step.classList.add("go"); step.append(el("b", null, BOTS[lead].name), " is putting it all together…"); d.append(step); }
  return d;
}

function pick(k){
  if (busy) return;
  dropIncog(null);
  if (teamMode) { if (!teamAllowed()) { openPlans(); return; } teamToggle(k); k = teamDraft.lead; }
  active = k; cur = null; if (!teamMode) status.textContent = ""; webOn = false;
  renderHome();
  const mark = $("mark"); mark.classList.remove("pop"); void mark.offsetWidth; mark.classList.add("pop"); setTimeout(() => mark.classList.remove("pop"), 600);
  box.focus();
}
function openConv(id){
  if (busy || !convs[id]) return;
  dropIncog(id); stopSpeak();
  if (!!convs[id].team !== teamMode) { app.dataset.view = "chat"; setTab(!!convs[id].team); }
  cur = id; active = convs[id].orb; status.textContent = ""; box.value = ""; autosize();
  renderChat(); if (mobile()) setSide(false);
}

function updateSend(){
  if (busy) { sendBtn.disabled = false; sendBtn.setAttribute("aria-label","Stop");
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'; return; }
  sendBtn.setAttribute("aria-label","Send");
  sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  sendBtn.disabled = (!active && !app.classList.contains("dashv")) || (!box.value.trim() && !pendingFiles.length);
}

const ERR = {
  unauthenticated:"You got signed out. Sign in again.",
  unverified:"Verify your email first, then try again.",
  bad_request:"That message didn't go through. Try again.",
  site_busy:"Orbs is extra busy today and hit its limit for everyone. Try again after midnight New York time.",
  overloaded:"Claude is super busy right now. Try again in a minute.",
  upstream_error:"Something went wrong reaching Claude. Try again.",
  not_configured:"The site isn't fully set up yet. The owner needs to add the keys on Vercel.",
  server_error:"Orbs had a server problem. Try again.",
  out_of_funds:"Orbs can't reach Claude right now. The owner has been told. Try again a bit later.",
  paused:"Orbs is taking a little break right now. Try again later!",
  banned:"This account can't chat on Orbs anymore.",
  network:"Can't reach Orbs. Check your internet connection.",
  season_over:"Spooks and Hex went back to sleep until next October! 🎃👻 Pick another orb."
};
const NOSEARCH = { kids:"Web search is off in Kids Mode, so that answer didn't search the web.", off:"Web search is turned off on Orbs right now, so that answer didn't search the web.", limit:"You've used all your web searches for today, so that answer didn't search the web. They refill at midnight." };

// Files sent with each message, kept on this device so "Try again" and edits can send them again
const fileStore = {};
async function send(text, regen, filesOverride){
  text = (text || "").trim();
  if ((!text && !regen && !pendingFiles.length && !filesOverride) || busy) return;
  if (needOrb()) return;
  if (!user) return;
  // Team changes said in words ("add Beat", "remove Quill") are done right here, for free
  if (!regen && !filesOverride && !pendingFiles.length && text && curTeam() && teamAllowed()) {
    const cmd = teamCommand(text);
    if (cmd) { box.value = ""; autosize(); status.textContent = applyTeam(cmd); return; }
  }
  const key = active, b = BOTS[key];
  const helpers = teamHelpers(curTeam());
  if (helpers.length && !teamAllowed()) { status.textContent = "Orb Teams come with Light and up."; openPlans(); return; }
  // Out of usage: say when it comes back instead of sending (the server checks too)
  const out = usageOut();
  if (out) { limitHit = out; renderUsage(); status.textContent = ""; return; }
  teamOk = null;
  // Start a new chat if none is open for this orb
  if (!curConv() || curConv().orb !== key) {
    const id = (incogNext ? "x_" : "") + newId(), now = Date.now();
    convs[id] = { id, orb:key, title:"", turns:[], created:now, updated:now, web:webOn, ...(incogNext ? { incog:true } : {}),
      ...(teamMode && teamDraft.lead === key ? { team: { lead:key, helpers:[...teamDraft.helpers] } } : {}) };
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
  let reply = "", thinking = "", thinkStart = 0, thinkSecs = 0, queries = [], sources = [], noSearch = null, raf = 0, memSaved = [], teamSteps = [], leadAt = null;
  const paint = () => {
    raf = 0;
    if (thinking) { live.think.hidden = false; live.think.querySelector(".thinktext").innerHTML = md(thinking); }
    if (reply) { live.msg.innerHTML = md(splitOptions(reply).body); enhance(live.msg, false); }
    stickBottom();
  };
  const later = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const extras = () => {
    const o = {};
    if (thinking) { o.th = thinking.slice(0, 20000); if (thinkSecs) o.tm = thinkSecs; }
    if (queries.length) o.q = queries.slice(0, 5);
    if (sources.length) o.src = sources.slice(0, 10);
    if (memSaved.length) o.mem = memSaved;
    if (teamSteps.length) o.tn = teamSteps.filter(x => x.s !== "go");
    return o;
  };
  try {
    const token = await user.getIdToken();
    let res;
    try {
      res = await fetch("/api/chat", {
        method:"POST",
        headers:{ "content-type":"application/json", authorization:"Bearer " + token },
        body: JSON.stringify({ orb:key, messages:ctx, think: opts.think !== false, web: !!webOn, ...(helpers.length ? { team: helpers } : {}),
          ...(ctx.length === 1 && !conv.incog && !conv.renamed ? { title: true } : {}),
          ...(kids.memory && opts.memory !== false && !conv.incog ? { memory: true } : {}),
          ...(files.length ? { attachments: files.map(f => f.kind === "text" ? { kind:"text", name:f.name, text:f.text } : { kind:f.kind, name:f.name, media_type:f.media_type, data:f.data }) } : {}) }),
        signal: ctl.signal
      });
    } catch (e) { throw { code: e && e.name === "AbortError" ? "cancelled" : "network" }; }
    if (!res.ok) { let j = {}; try { j = await res.json(); } catch(_) {} throw { code: res.status === 413 ? "files_too_big" : (j.error || "upstream_error"), usage: j.usage, msg: j.msg, needName: j.needName }; }
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
            if (!reply && teamSteps.length) live.team.replaceChildren(teamBox(teamSteps.filter(x => x.s !== "go"), false));
            reply += ev.d; tail?.remove(); later();
          }
          else if (typeof ev.t === "string") { if (!thinking) thinkStart = Date.now(); thinking += ev.t; later(); }
          else if (typeof ev.q === "string") { queries.push(ev.q); live.searched.hidden = false; live.searched.textContent = "🔎 Searching the web: " + queries.map(q => "“" + q + "”").join(", "); stickBottom(); }
          else if (Array.isArray(ev.src)) { for (const x of ev.src) if (x && typeof x.u === "string" && sources.length < 10 && !sources.some(y => y.u === x.u)) sources.push({ u: x.u, t: String(x.t || "") }); live.src.replaceChildren(sourcesBox(sources)); }
          else if (typeof ev.nosearch === "string") noSearch = ev.nosearch;
          else if (Array.isArray(ev.mem)) { memSaved = ev.mem.filter(x => typeof x === "string").slice(0, 3); live.src.after(memChip(memSaved)); }
          else if (ev.tm && typeof ev.tm === "object" && typeof ev.tm.k === "string") {
            const x = ev.tm;
            if (x.s === "lead") leadAt = x.k;
            else if (BOTS[x.k]) { const i = teamSteps.findIndex(y => y.k === x.k), step = { k: x.k, s: String(x.s), ...(typeof x.n === "string" ? { n: x.n.slice(0, 6000) } : {}) }; if (i >= 0) teamSteps[i] = step; else teamSteps.push(step); }
            live.team.replaceChildren(teamBox(teamSteps, !reply, leadAt)); stickBottom();
          }
          else if (typeof ev.title === "string") { if (!conv.renamed && ev.title.trim()) { conv.title = ev.title.trim().slice(0, 80); if (cur === cid) $("topRole").textContent = conv.title; renderSide(); } }
          else end = ev;
        }
      }
    } catch (e) { throw { code: e && e.name === "AbortError" ? "cancelled" : "network", text: reply }; }
    if (!end) throw { code:"upstream_error", text: reply };
    if (end.error) throw { code:end.error, usage:end.usage, text: reply };
    setUsage(end.usage);
    if (end.refused && !reply.trim()) throw { code:"refused" };
    conv.turns.push({ role:"assistant", content:reply, t:Date.now(), ...extras() }); conv.updated = Date.now(); save(); renderUsage();
    if (end.truncated) status.textContent = "That answer got cut off. Ask for a shorter one.";
    else if (end.refused) status.textContent = "The orb stopped there. Try asking a different way.";
    else if (noSearch && NOSEARCH[noSearch]) status.textContent = NOSEARCH[noSearch];
  } catch (e) {
    const code = e && e.code || "upstream_error";
    if (e && e.usage) setUsage(e.usage);
    tail?.remove();
    if (e && e.text) { conv.turns.push({ role:"assistant", content:e.text, t:Date.now(), ...extras() }); save(); }
    if (code === "cancelled") status.textContent = "Stopped.";
    else if (code === "plan_team") { status.textContent = "Orb Teams come with Light and up."; refreshStatus(); openPlans(); }
    else if (code === "usage_day" || code === "usage_week") { limitHit = code === "usage_week" ? "week" : "day"; renderUsage(); status.textContent = ""; }
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
  postFeedback({ key: conv.id + ":" + turn.t, orb: conv.orb, vote: next });
  if (next === "up") status.textContent = "Thanks! Glad that helped.";
  if (next === "down") { fbTurn = turn; fbConv = conv; $("fbReason").value = ""; $("fbShare").checked = false; $("fbMsg").textContent = ""; $("fbSend").disabled = false;
    for (const b of document.querySelectorAll("#fbTags button")) b.setAttribute("aria-pressed", "false"); openLegal("fbModal"); }
}
for (const b of document.querySelectorAll("#fbTags button")) b.onclick = () => { for (const o of document.querySelectorAll("#fbTags button")) o.setAttribute("aria-pressed", String(o === b)); };
$("fbSend").onclick = () => busyBtn($("fbSend"), async () => {
  if (!fbTurn || !fbConv) return;
  const tag = document.querySelector('#fbTags button[aria-pressed="true"]')?.dataset.tag;
  await postFeedback({ key: fbConv.id + ":" + fbTurn.t, orb: fbConv.orb, vote: "down",
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
// On Home (the dashboard) there's no orb picked yet: whatever you type goes to Nebula
const DASH_ORB = "neb";
function needOrb(){
  if (active) return false;
  if (app.dataset.view === "home" && !teamMode) { active = DASH_ORB; setAccent(); return false; }
  nudge(); return true;
}

function autosize(){ box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 180) + "px"; }
box.addEventListener("input", () => { autosize(); updateSend(); });
box.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(box.value); } });
form.addEventListener("submit", e => { e.preventDefault(); if (busy) { ctl?.abort(); return; } send(box.value); });
form.addEventListener("click", () => { if (!active && !app.classList.contains("dashv")) nudge(); });
// The house (top left) always goes back Home to the dashboard
function goHome(){ if (busy) return; dropIncog(null); cur = null; webOn = false; incogNext = false; status.textContent = ""; box.value = ""; autosize();
  if (teamMode) setTab(false); active = null; teamDraft = { lead: null, helpers: [] }; renderHome(); if (mobile()) setSide(false); }
$("homeBtn").onclick = goHome;
$("houseBtn").onclick = goHome;
let freshNext = false;
const shell = $("shell"), mobile = () => matchMedia("(max-width:760px)").matches;
function setSide(open){ shell.classList.toggle("closed", !open); try { if (!mobile()) localStorage.setItem("orbs-side", open ? "1" : "0"); } catch(e) {} }
// The sidebar (all your chats) starts tucked away; Home already shows recent chats. It remembers if you open it.
let sideOpen = false; try { if (!mobile() && localStorage.getItem("orbs-side") === "1") sideOpen = true; } catch(e) {}
setSide(sideOpen);
$("hideBtn").onclick = () => { setSide(false); };
$("openBtn").onclick = () => setSide(true);
$("scrim").onclick = () => { setSide(false); };
$("sideNew").onclick = () => { if (busy) return; dropIncog(null); active = null; teamDraft = { lead: null, helpers: [] }; teamOk = null; cur = null; webOn = false; incogNext = false; freshNext = true; status.textContent = ""; box.value = ""; renderHome(); if (mobile()) setSide(false); };
function openSet(){ if (user) kidsApi(user, { action:"status" }).then(() => { renderUsage(); renderKids(); renderPlan(); renderMemSet(); }).catch(() => {}); if (mobile()) setSide(false); renderPlan(); $("settings").hidden = false; $("setBtn").setAttribute("aria-expanded", "true"); wipeArmed(false); killArmed(false); $("setMsg").textContent = ""; renderAccount(); renderUsage(); renderKids(); renderThinkSet(); renderMemSet(); }
// ---------- Memory ----------
function memChip(list){
  const d = el("div", "memchip"); d.append(el("span", null, "📝 Saved to memory: " + list.join(" · ")));
  const b = el("button", "linkbtn", "Manage"); b.type = "button"; b.onclick = () => openMemory(); d.append(b); return d;
}
function renderMemSet(){
  const allowed = !!kids.memory, on = allowed && opts.memory !== false;
  $("memSw").setAttribute("aria-checked", String(on)); $("memSw").disabled = !allowed; $("memManage").hidden = !allowed;
  $("memTxt").textContent = !allowed ? (kids.on ? "Off in Kids Mode" : "🔒 Pro") : on ? "On" : "Off";
  $("memHelp").textContent = allowed ? "Orbs remember things you tell them (like your name, hobbies, and projects) so you don't have to repeat yourself. You can see and delete everything in Manage."
    : kids.on ? "Memory is turned off in Kids Mode to keep things private." : "Orbs can remember things you tell them across chats. Memory comes with Pro and Max.";
}
$("memSw").onclick = () => { if (!kids.memory) { openPlans(); return; } opts = { ...opts, memory: opts.memory === false }; renderMemSet(); cloudSave(); };
$("memManage").onclick = () => openMemory();
const memRef = () => F.doc(db, "users", user.uid, "data", "memory");
let memItems = [];
async function openMemory(){
  if (!user) return;
  openLegal("memModal"); $("memMsg").textContent = ""; $("memList").replaceChildren(el("li", "empty", "Loading…"));
  try { const snap = await F.getDoc(memRef()); const v = snap.exists() ? snap.data() : {}; memItems = Array.isArray(v.items) ? v.items.filter(m => m && typeof m.text === "string") : []; renderMemList(); }
  catch (_) { $("memList").replaceChildren(el("li", "empty", "Couldn't load your memory. Try again.")); }
}
function renderMemList(){
  const ul = $("memList"); ul.innerHTML = "";
  if (!memItems.length) ul.append(el("li", "empty", "Nothing yet. Tell an orb about yourself and it'll remember."));
  for (const m of memItems.slice().reverse()) {
    const li = el("li"); li.append(el("span", null, m.text));
    const x = el("button", "icon-btn delb"); x.type = "button"; x.innerHTML = TRASH_SVG; x.title = "Forget this"; x.setAttribute("aria-label", "Forget: " + m.text);
    x.onclick = () => saveMem(memItems.filter(i => i !== m), "Forgotten.");
    li.append(x); ul.append(li);
  }
}
async function saveMem(items, msg){
  try { await F.setDoc(memRef(), { items: items.slice(-60) }); memItems = items; renderMemList(); $("memMsg").textContent = msg; }
  catch (_) { $("memMsg").textContent = "Couldn't save. Try again."; }
}
$("memAdd").addEventListener("submit", e => { e.preventDefault(); const t = $("memNew").value.trim().slice(0, 160); if (!t) return;
  $("memNew").value = ""; saveMem([...memItems, { id: Date.now().toString(36), text: t, at: Date.now() }], "Added."); });
$("memWipe").onclick = () => armed($("memWipe"), "Tap again to forget everything", () => saveMem([], "Everything forgotten."));

// "Show thinking" switch
function renderThinkSet(){ const on = opts.think !== false; $("thinkSw").setAttribute("aria-checked", String(on)); $("thinkTxt").textContent = on ? "On" : "Off"; }
$("thinkSw").onclick = () => { opts = { ...opts, think: opts.think === false }; renderThinkSet(); cloudSave(); };
$("setBtn").onclick = openSet;
function closeSet(){ $("settings").hidden = true; $("setBtn").setAttribute("aria-expanded", "false"); wipeArmed(false); }
$("setClose").onclick = closeSet;
$("settings").addEventListener("click", e => { if (e.target === $("settings")) closeSet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("settings").hidden) closeSet(); });
// One look everywhere: there is no light/dark theme anymore. Clear any old saved choice so nothing stale lingers.
document.documentElement.removeAttribute("data-theme");
try { localStorage.removeItem("orbs-theme"); } catch(e) {}
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
const commas = n => typeof n === "number" ? n.toLocaleString("en-US") : n;
let prefs = {};   // older saves kept per-orb model picks here; it's kept as-is so nothing gets lost
function closeMenus(){ for (const [m, b] of [["addMenu","addBtn"]]) { $(m).hidden = true; $(b).setAttribute("aria-expanded","false"); } }
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
// The globe (web search) and the note under the chat box
function syncSel(){
  const canWeb = (!!active || app.classList.contains("dashv")) && kids.web !== false && !kids.on;
  $("webBtn").hidden = !canWeb; if (!canWeb) webOn = false;
  $("webBtn").setAttribute("aria-pressed", String(webOn)); $("webBtn").classList.toggle("on", webOn);
  $("webBtn").title = webOn ? "Web search is on (tap to turn off)" : "Search the web";
  hint();
}
function hint(){
  const h = $("hint");
  const web = webOn ? `Web search is on: up to 3 searches per message, ${Number.isInteger(kids.webPerDay) ? kids.webPerDay : 5} a day.` : "";
  const low = usage && !usage.unlimited ? Math.max(usage.dayLimited ? usage.dayPct : 0, usage.weekLimited ? usage.weekPct : 0) : 0;
  const warn = low >= 80 && low < 100 ? `You've used ${Math.round(low)}% of your ${usage.weekLimited && usage.weekPct >= (usage.dayLimited ? usage.dayPct : 0) ? "weekly" : "daily"} usage.` : "";
  const msg = [web, warn].filter(Boolean).join(" ");
  h.textContent = msg; h.hidden = !msg; h.classList.toggle("warn", !!warn);
}
$("webBtn").onclick = e => { e.stopPropagation(); if (!active && !app.classList.contains("dashv")) { nudge(); return; } webOn = !webOn; const c = curConv(); if (c) c.web = webOn; syncSel(); box.focus(); };
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
  el.querySelector("small").textContent = sub || teamName(c.orb, c.team);
  el.onclick = () => openConv(c.id);
  el.ondblclick = e => { e.preventDefault(); startRename(c.id, el.parentNode); };
  return el;
}
function renderSide(){
  syncSel();
  const rec = $("recent"); rec.innerHTML = ""; const term = $("q").value.trim().toLowerCase();
  const secs = document.querySelectorAll(".scroller .sec");
  secs[0].hidden = $("pins").hidden = teamMode; secs[1].textContent = teamMode ? "Recent team chats" : "Recent chats";
  const shown = Object.values(convs).filter(c => c.turns.length && !c.incog && !!c.team === teamMode && (!term || (c.title || "").toLowerCase().includes(term) || BOTS[c.orb].name.toLowerCase().includes(term) || c.turns.some(m => m.content.toLowerCase().includes(term))))
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
  if (!shown.length) { const d = document.createElement("div"); d.className = "pin-empty"; d.textContent = term ? "No chats match." : teamMode ? "Your team chats will show up here." : "Your chats will show up here."; rec.appendChild(d); }
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
  for (const id of ["pinTop","pinHome"]) { const e = $(id); e.classList.toggle("on", !!on); e.hidden = !active || teamMode; e.setAttribute("aria-label", on ? "Unpin this orb" : "Pin this orb"); }
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


// ---------- Usage (measured on the server in what each message really costs; shown here as percentages) ----------
// usage = { unlimited, dayPct, weekPct, dayLimited, weekLimited, dayResetAt, weekResetAt } or null before it loads
let usage = null, limitHit = false;   // limitHit: false, "day" or "week"
function setUsage(u){
  if (u && typeof u === "object" && typeof u.dayPct === "number") usage = u;
  limitHit = usageOut();
  renderUsage(); hint();
}
function usageOut(){
  if (!usage || usage.unlimited) return false;
  if (usage.weekLimited && usage.weekPct >= 100) return "week";
  if (usage.dayLimited && usage.dayPct >= 100) return "day";
  return false;
}
// "12:00 AM" or "Monday 12:00 AM", in the person's own time zone
const fmtClock = t => new Date(t).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
function resetText(t, week){
  if (!t) return "";
  const d = new Date(t), now = new Date();
  if (!week) {
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    return d.toDateString() === now.toDateString() || d.toDateString() === tomorrow.toDateString() ? `Resets at ${fmtClock(t)}` : `Resets ${d.toLocaleDateString([], { weekday:"long" })} ${fmtClock(t)}`;
  }
  return `Resets ${d.toLocaleDateString([], { weekday:"long" })} ${fmtClock(t)}`;
}
const pctText = p => (p > 0 && p < 1 ? "<1" : String(Math.round(p))) + "%";
function fillBar(fill, pct){
  fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  const bar = fill.parentNode; bar.classList.toggle("low", pct >= 75 && pct < 100); bar.classList.toggle("out", pct >= 100);
}
function renderUsage(){
  const u = usage, unl = !u || u.unlimited;
  const rows = [["useDay", "uDay", u && u.dayLimited, u ? u.dayPct : 0, u && u.dayResetAt, false], ["useWeek", "uWeek", u && u.weekLimited, u ? u.weekPct : 0, u && u.weekResetAt, true]];
  for (const [set, dash, limited, pct, at, week] of rows) {
    const on = !unl && limited;
    $(set + "Pct").textContent = on ? pctText(pct) : "∞"; $(dash + "Pct").textContent = on ? pctText(pct) : "∞";
    fillBar($(set + "Fill"), on ? pct : 0); fillBar($(dash + "Fill"), on ? pct : 0);
    const r = on ? resetText(at, week) : !u ? "" : kids.owner ? "Unlimited for the owner" : "No limit right now";
    $(set + "More").textContent = r; $(dash + "Reset").textContent = r;
  }
  $("useDayLbl").textContent = "of today's usage"; $("useWeekLbl").textContent = "of this week";
  const p = kids.plan, testing = kids.owner && kids.viewAs && kids.viewAs !== "owner";
  $("pPlan").replaceChildren(planIcon(myPlanId(), 18), testing ? `Testing ${p ? p.name : "Free"}` : p ? p.name : kids.owner ? "Owner" : "Free");
  $("pUsageUp").hidden = !kids.billing || !!(p && p.id === "plusplusplus") || (kids.owner && !testing);
  // Out of usage: a friendly note with when it comes back, and Upgrade
  const out = limitHit && u;
  $("limit").hidden = !out;
  if (out) {
    const week = limitHit === "week";
    if (!$("limitUp").hidden) $("limitUp").replaceChildren(planIcon(nextPlanId(), 20), "Upgrade for more");
    $("limitTxt").textContent = week ? `You've used all of this week's usage. ${resetText(u.weekResetAt, true)}.` : `You've used all of today's usage. ${resetText(u.dayResetAt, false)}.`;
  }
}

// ---------- Account panel ----------
function renderProfile(){
  const img = $("profImg"), av = $("profAv");
  const aImg = $("avImg"), aTxt = $("avTxt");
  const nm = user ? (user.displayName || (user.email || "").split("@")[0] || "You") : "";
  aTxt.textContent = nm.trim().charAt(0).toUpperCase() || "?";
  if (user && user.photoURL) { aImg.referrerPolicy = "no-referrer"; aImg.src = user.photoURL; aImg.hidden = false; aTxt.hidden = true; aImg.onerror = () => { aImg.hidden = true; aTxt.hidden = false; }; }
  else { aImg.hidden = true; aTxt.hidden = false; }
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
  pins = []; prefs = {}; lastSent = {}; opts = { think: true, memory: true }; webOn = false; incogNext = false; stopSpeak();
  active = null; hist = []; hi = -1; usage = null; limitHit = false;
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
        if (Array.isArray(m.mem)) o.mem = m.mem.filter(x => typeof x === "string").slice(0, 3).map(x => x.slice(0, 160));
        if (Array.isArray(m.tn)) o.tn = m.tn.filter(x => x && Object.hasOwn(BOTS, x.k) && ["ok","fail","skip"].includes(x.s)).slice(0, 4).map(x => ({ k: x.k, s: x.s, ...(typeof x.n === "string" ? { n: x.n.slice(0, 6000) } : {}) }));
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
      const data = { orb:c.orb, title:c.title || "New chat", turns:fitTurns(c.turns), created:c.created || Date.now(), updated:c.updated || Date.now(), ...(c.team ? { team: { lead: c.team.lead, helpers: c.team.helpers.slice(0, TEAM_MAX - 1) } } : {}) };
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
    // An orb team chat keeps its team
    if (v.team && typeof v.team === "object" && v.team.lead === v.orb && Array.isArray(v.team.helpers))
      c.team = { lead: v.orb, helpers: v.team.helpers.filter((k, i, a) => Object.hasOwn(BOTS, k) && k !== v.orb && a.indexOf(k) === i).slice(0, TEAM_MAX - 1) };
    convs[c.id] = c;
    lastSent["c_" + c.id] = JSON.stringify({ orb:c.orb, title:c.title || "New chat", turns:fitTurns(c.turns), created:c.created, updated:c.updated, ...(c.team ? { team: c.team } : {}) });
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
      opts = { think: !(v.opts && v.opts.think === false), memory: !(v.opts && v.opts.memory === false) };
      lastSent.settings = JSON.stringify({ pins, prefs, opts });
    }
  });
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
  $("aMfa").hidden = mode !== "mfa"; if (mode === "mfa") return;
  if (mode === "age") { $("aTitle").textContent = "How old are you?"; $("aText").textContent = "Orbs uses this to keep everyone safe. You can't change it later, so please be honest."; return; }
  if (mode === "blocked") { $("aTitle").textContent = "Sorry!"; $("aText").textContent = "Orbs is only for people 13 and older. Come back when you're older!"; return; }
  if (mode === "banned") { $("aTitle").textContent = "Account blocked"; $("aText").textContent = "This account can't use Orbs anymore because it broke the rules. If you think that's a mistake, email contact@orbsai.app."; return; }
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
$("navSignin").onclick = () => setAuthMode("in");
// Landing nav: scroll to a section (or the top)
for (const b of document.querySelectorAll("#landing [data-go]")) b.onclick = () => { lvMenu(false); lvGo(b.dataset.go === "top" ? 0 : lvScenes.findIndex(x => x.id === b.dataset.go)); };
// Landing hero: phone menu, entrance animations, and only playing the video while the landing shows
function lvMenu(open){ $("landing").classList.toggle("menu-open", open); $("lvBurger").setAttribute("aria-expanded", String(open)); $("lvBurger").setAttribute("aria-label", open ? "Close menu" : "Open menu"); }
// If autoplay was blocked (iPhone Low Power Mode, data saver), start the video on the first tap, swipe, or key
$("lvBurger").onclick = () => lvMenu(!$("landing").classList.contains("menu-open"));
// Landing scenes: the page doesn't scroll. Wheel, swipe, arrow keys, the dots, and the nav swap the content with GSAP while the video stays put.
// A scene taller than the screen scrolls on its own first, then the next swipe at its edge moves on.
const lvScenes = [...document.querySelectorAll("#lvStage .lv-scene")];
let lvAt = 0, lvBusy = false, lvScrolledAt = 0;
const lvCalm = () => !window.gsap || matchMedia("(prefers-reduced-motion: reduce)").matches;
$("lvDots").append(...lvScenes.map((sc, i) => { const d = el("button"); d.type = "button"; d.setAttribute("aria-label", sc.dataset.name); d.onclick = () => lvGo(i); return d; }));
function lvDots(){ [...$("lvDots").children].forEach((d, i) => d.setAttribute("aria-current", String(i === lvAt))); }
lvDots();
for (const sc of lvScenes) sc.addEventListener("scroll", () => { lvScrolledAt = performance.now(); }, { passive:true });
function lvGo(i){
  if (i < 0 || i >= lvScenes.length || i === lvAt || lvBusy) return;
  const from = lvScenes[lvAt], to = lvScenes[i], dir = i > lvAt ? 1 : -1;
  lvAt = i; lvDots();
  to.scrollTop = dir > 0 ? 0 : to.scrollHeight;
  if (lvCalm()) { from.classList.remove("on"); to.classList.add("on"); return; }
  lvBusy = true;
  const bits = to.querySelectorAll(".lv-badge, .lv-line > span, .lv-lede, .lv-actions, .lv-stat, .lv-panel h2, .lv-panel .lsub, .lbonus, .lo, .lfeat li, .pcard, .lv-panel > .lsec > p, .faq details, .legalnote");
  gsap.timeline({ onComplete(){ from.classList.remove("on"); gsap.set([from, to, ...bits], { clearProps:"opacity,visibility,transform,filter" }); lvBusy = false; } })
    .to(from, { autoAlpha:0, y:-50 * dir, scale:.98, duration:.42, ease:"power2.in" })
    .add(() => to.classList.add("on"))
    .fromTo(to, { autoAlpha:0, y:50 * dir }, { autoAlpha:1, y:0, duration:.7, ease:"power3.out" }, "-=.05")
    .from(bits, { autoAlpha:0, y:22 * dir, duration:.55, stagger:{ each:.035, from:dir > 0 ? "start" : "end" }, ease:"power3.out" }, "<.08");
}
const lvRoom = (sc, dir) => dir > 0 ? sc.scrollHeight - sc.clientHeight - sc.scrollTop > 40 : sc.scrollTop > 40; // a sliver of overflow doesn't need its own swipe
const lvFree = () => !(lvBusy || gate.hidden || $("landing").hidden || $("landing").classList.contains("menu-open"));
function lvStep(dir){
  if (!lvFree()) return;
  const room = lvRoom(lvScenes[lvAt], dir);
  // Let a tall scene scroll first, and don't jump while its wheel momentum is still going
  if (room || performance.now() - lvScrolledAt < 260) return room;
  lvGo(lvAt + dir);
}
if (window.Observer) Observer.create({ target:$("lvTop"), type:"wheel", wheelSpeed:-1, tolerance:14, onUp:() => lvStep(1), onDown:() => lvStep(-1) });
else $("lvTop").addEventListener("wheel", e => { if (Math.abs(e.deltaY) > 14) lvStep(Math.sign(e.deltaY)); }, { passive:true });
// Swipes: plain touch events, so the browser can still natively scroll a tall scene (pointer events get cancelled when it does).
// Whether a swipe changes scenes depends on where the scene was when the finger went down: already at its end means "next",
// otherwise the swipe was just scrolling. (Time-based checks fail on iPhones, where the edge bounce fires scroll events mid-swipe.)
let lvTouch = null;
$("lvTop").addEventListener("touchstart", e => {
  const sc = lvScenes[lvAt];
  lvTouch = e.touches.length === 1 ? { y:e.touches[0].clientY, down:!lvRoom(sc, 1), up:!lvRoom(sc, -1) } : null;
}, { passive:true });
$("lvTop").addEventListener("touchend", e => {
  const t = lvTouch; lvTouch = null;
  if (!t || !lvFree()) return;
  const dy = t.y - e.changedTouches[0].clientY;
  if (dy > 48 && t.down) lvGo(lvAt + 1); else if (dy < -48 && t.up) lvGo(lvAt - 1);
}, { passive:true });
document.addEventListener("keydown", e => {
  if (gate.hidden || $("landing").hidden || document.querySelector(".modal:not([hidden])") || e.target.closest("input, textarea, select, [contenteditable]")) return;
  const k = { ArrowDown:1, PageDown:1, ArrowUp:-1, PageUp:-1 }[e.key];
  if (k) { e.preventDefault(); const sc = lvScenes[lvAt]; if (lvStep(k)) sc.scrollBy({ top:k * sc.clientHeight * .7, behavior:"smooth" }); } else if (e.key === "Home") lvGo(0); else if (e.key === "End") lvGo(lvScenes.length - 1);
});
$("lvBackdrop").onclick = () => lvMenu(false);
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("landing").classList.contains("menu-open")) lvMenu(false); });
matchMedia("(min-width:901px)").addEventListener("change", e => { if (e.matches) lvMenu(false); });
(function lvAppear(){
  const els = [...document.querySelectorAll("#lvTop .appear")];
  for (const el of els) el.addEventListener("animationend", function done(e){ if (e.target !== el) return; el.classList.add("is-in"); el.removeEventListener("animationend", done); });
  // If animations never start (old browser, hidden tab), show everything right away
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const ran = els.some(el => el.getAnimations && el.getAnimations().some(a => a.playState === "running" || a.playState === "finished"));
    if (!ran) els.forEach(el => el.classList.add("is-in"));
  }));
})();
$("aBack").onclick = () => showGate("home");
$("lineup").innerHTML = ORDER.map(k => `<div class="lo"><div class="has-orb">${orbSVG(k)}</div><b></b><small></small></div>`).join("");
$("lineup").querySelectorAll(".lo").forEach((el, i) => { el.querySelector("b").textContent = BOTS[ORDER[i]].name; el.querySelector("small").textContent = BOTS[ORDER[i]].role; });
// Halloween: show the 2 bonus orbs on the front page too
function renderLandingBonus(){
  document.querySelectorAll(".lbonus, .lo.bonus").forEach(x => x.remove());
  if (!seasonOn) return;
  const note = el("p", "lbonus", "+2 bonus orbs for Halloween! 🎃👻 They leave on November 1."); $("lineup").before(note);
  for (const k of ["spooks", "hex"]) { const d = el("div", "lo bonus"); const g = el("div", "has-orb"); g.innerHTML = orbSVG(k); d.append(g, el("b", null, BOTS[k].name), el("small", null, BOTS[k].role)); $("lineup").append(d); }
}
renderLandingBonus();
$("gGoogle").onclick = () => busyBtn($("gGoogle"), async () => {
  say("");
  try { const p = new A.GoogleAuthProvider(); p.setCustomParameters({ prompt:"select_account" }); await A.signInWithPopup(auth, p); }
  catch (e) { say(authErr(e)); }
});
// Pretty Orbs confirm email (server, through Brevo). If that's off or fails, Firebase sends its plain one.
async function sendVerify(u){
  try {
    const r = await fetch("/api/verify-email", { method:"POST", headers:{ authorization:"Bearer " + await u.getIdToken(true) } });
    if (r.ok) return;
    if (r.status === 429) { const e = new Error("too many"); e.code = "auth/too-many-requests"; throw e; }
  } catch (e) { if (e && e.code) throw e; }
  await A.sendEmailVerification(u);
}
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
      await sendVerify(cred.user);
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
  try { await sendVerify(auth.currentUser); say("Sent! Check your inbox, and your spam folder too.", true); } catch (e) { say(authErr(e)); }
});
$("vOut").onclick = () => A.signOut(auth);

// ---------- Age + Kids Mode (the server decides; the page just shows it) ----------
let kids = { age:null, on:false, locked:false, blocked:false, forcedForAll:false, banned:false, web:true }, pending = null;
async function kidsApi(u, body){
  const r = await fetch("/api/kids", { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer " + await u.getIdToken() }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch(_) {}
  if (typeof j.age !== "undefined") kids = { ...kids, ...j };
  if (j.usage && typeof j.usage === "object") { usage = j.usage; limitHit = usageOut(); }
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
  try { const m = await mfaApi(u, { action:"status" }); mfa = m.httpOk ? m : null; } catch(_) { mfa = null; }
  if (mfa && mfa.need) { showGate("mfa"); setMfaKind(mfa.totp ? "totp" : "email"); return; }
  try { await loadAccount(u); await kidsApi(u, { action:"status" }); }
  catch (e) { user = null; showGate("signin"); say("Couldn't load your account. Check your connection and try again."); return; }
  if (kids.banned) { showGate("banned"); return; }
  if (!kids.age) { showGate("age"); return; }
  if (kids.blocked) { showGate("blocked"); return; }
  pending = null; user = u; renderProfile(); renderUsage(); renderKids(); renderThinkSet(); renderPlan(); renderMfa(); gate.hidden = true; renderHome();
  cloudSave(); // finishes moving any old-style chats
  checkAdmin(); afterBilling(); maybePromo();
}

// ---------- Two-step sign-in (MFA) ----------
let mfa = null, mfaKind = "totp";
async function mfaApi(u, body){
  const r = await fetch("/api/mfa", { method:"POST", headers:{ "content-type":"application/json", authorization:"Bearer " + await u.getIdToken() }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch(_) {}
  j.httpOk = r.ok; return j;
}
const MFA_ERR = { wrong_code:"That code didn't work. Check it and try again.", locked:"Too many wrong tries. Wait 15 minutes, then try again.", email_off:"Email codes aren't working right now. Use your authenticator app or a backup code.", expired:"That took too long. Start again.", mfa_required:"Sign in again first.", unverified:"Confirm your email first." };
const mfaErr = j => (j.error === "wait" && j.wait ? `Wait ${j.wait} seconds before asking for another code.` : MFA_ERR[j.error]) || "Something went wrong. Try again.";
// Sign-in screen
function setMfaKind(k){
  mfaKind = k; say("");
  const email = pending && pending.email || "your email";
  $("aTitle").textContent = "Two-step sign-in";
  $("aText").textContent = k === "totp" ? "Open your authenticator app and type the 6-digit code for Orbs AI."
    : k === "email" ? `Tap "Email me a code", then type the 6-digit code we send to ${email}. Can't find it? Check your spam or junk folder. It comes from Orbs AI.` : "Type one of your backup codes (like abcd-1234). Each one works once.";
  $("mfaMail").hidden = !(mfa && mfa.email && k !== "backup");
  $("mfaMail").textContent = k === "totp" ? "Email me a code instead" : "Email me a code";
  const c = $("mfaCode"); c.value = ""; c.placeholder = k === "backup" ? "abcd-1234" : "123456"; c.inputMode = k === "backup" ? "text" : "numeric";
  const next = k === "backup" ? (mfa && mfa.totp ? "totp" : "email") : "backup";
  $("mfaSwap").dataset.k = next;
  $("mfaSwap").textContent = next === "backup" ? "Lost your phone? Use a backup code" : next === "totp" ? "Use my authenticator app" : "Use an email code";
  setTimeout(() => c.focus(), 50);
}
$("mfaSwap").onclick = () => setMfaKind($("mfaSwap").dataset.k);
$("mfaOut").onclick = () => A.signOut(auth);
$("mfaMail").onclick = () => busyBtn($("mfaMail"), async () => {
  const u = pending; if (!u) return;
  if (mfaKind !== "email") setMfaKind("email");
  const j = await mfaApi(u, { action:"send" });
  say(j.sent ? "Sent! Check your inbox, and your spam folder too." : mfaErr(j), !!j.sent);
});
$("aMfa").addEventListener("submit", e => { e.preventDefault(); busyBtn($("mfaGo"), async () => {
  const u = pending; if (!u) return;
  const code = $("mfaCode").value.trim(); if (!code) return say("Type the code first.");
  try {
    const j = await mfaApi(u, { action:"verify", kind: mfaKind, code });
    if (!j.ok) return say(mfaErr(j));
    await u.getIdToken(true); await enter(u);
  } catch (_) { say("Couldn't reach Orbs. Check your connection."); }
}); });
// Settings
function renderMfa(){
  const on = !!(mfa && mfa.on);
  $("mfaTxt").textContent = !on ? "Off" : mfa.totp && mfa.email ? "On (app and email)" : mfa.totp ? "On (authenticator app)" : "On (email codes)";
  $("mfaDot").classList.toggle("ok", on); $("mfaBtn").textContent = on ? "Manage" : "Set up";
}
async function mfaRefresh(){ try { const j = await mfaApi(user, { action:"status" }); if (j.httpOk) mfa = j; } catch(_) {} renderMfa(); }
$("mfaBtn").onclick = async () => { if (!user) return; openLegal("mfaModal"); $("mfaBody").replaceChildren(el("p", "fine", "Loading…")); await mfaRefresh(); mfaMain(); };
const mfaBtn = (t, fn, cls = "outline small") => { const b = el("button", cls, t); b.type = "button"; b.onclick = () => busyBtn(b, fn); return b; };
const MFA_ICONS = {"phone": "<svg class=\"li\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect width=\"14\" height=\"20\" x=\"5\" y=\"2\" rx=\"2\" ry=\"2\"/><path d=\"M12 18h.01\"/></svg>", "mail": "<svg class=\"li\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"/><path d=\"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7\"/></svg>", "key": "<svg class=\"li\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z\"/><circle cx=\"16.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/></svg>"};
function mfaRow(title, sub, ...btns){ const r = el("div", "mrow"), t = el("div"); const b = el("b"); const [ic, ...rest] = title.split(" "); if (MFA_ICONS[ic]) { b.innerHTML = MFA_ICONS[ic]; b.append(rest.join(" ")); } else b.textContent = title; t.append(b, el("small", null, sub)); const bs = el("span", "setrow"); btns.filter(Boolean).forEach(b => bs.append(b)); r.append(t, bs); return r; }
function mfaShow(...nodes){ const box = el("div", "mfam"); box.append(...nodes); const m = el("p", "fine"); m.id = "mfaMsg"; m.setAttribute("role", "status"); box.append(m); $("mfaBody").replaceChildren(box); return m; }
const mfaSay = t => { const m = $("mfaMsg"); if (m) m.textContent = t || ""; };
function mfaMain(msg){
  const on = !!(mfa && mfa.on), ready = !!(mfa && mfa.emailReady);
  const parts = [];
  if (!on) parts.push(el("p", null, "Turn this on and Orbs asks for a code after your password, so nobody can get in with just your password. Pick how you want to get codes:"));
  parts.push(mfaRow("phone Authenticator app", mfa && mfa.totp ? "On. Codes come from your app." : "Google Authenticator, Microsoft Authenticator, Authy, or the Passwords app on iPhone and iPad.",
    mfa && mfa.totp ? mfaBtn("Turn off", () => mfaNeedCode("off", "totp")) : mfaBtn("Set up", mfaTotpStart)));
  parts.push(mfaRow("mail Email codes", mfa && mfa.email ? "On. We email you a 6-digit code." : ready ? "We email a 6-digit code to " + (user && user.email || "you") + "." : "Not available yet. Email sending isn't turned on for Orbs.",
    mfa && mfa.email ? mfaBtn("Turn off", () => mfaNeedCode("off", "email")) : ready ? mfaBtn("Set up", mfaEmailStart) : null));
  if (on) parts.push(mfaRow("key Backup codes", (mfa.backupLeft || 0) + " left. Use one if you lose your phone or can't get emails.", mfaBtn("Get new codes", () => mfaNeedCode("newBackup"))));
  mfaShow(...parts); mfaSay(msg);
}
async function drawQr(text){
  const { default: qrcode } = await import("./vendor/qrcode.mjs");
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(), s = 6, pad = 4, cv = document.createElement("canvas");
  cv.width = cv.height = (n + pad * 2) * s; cv.className = "mfaqr";
  const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + pad) * s, (r + pad) * s, s, s);
  cv.setAttribute("role", "img"); cv.setAttribute("aria-label", "QR code to scan with your authenticator app");
  return cv;
}
function mfaCodeForm(btnText, onSubmit, placeholder = "123456"){
  const f = el("form", "vbox"); f.noValidate = true;
  const i = el("input", "mfacode"); i.inputMode = "numeric"; i.autocomplete = "one-time-code"; i.maxLength = 9; i.placeholder = placeholder; i.setAttribute("aria-label", "Code");
  const b = el("button", "gbtn", btnText); b.type = "submit";
  f.append(i, b);
  f.onsubmit = e => { e.preventDefault(); const v = i.value.trim(); if (!v) return mfaSay("Type the code first."); busyBtn(b, () => onSubmit(v, i)); };
  setTimeout(() => i.focus(), 50);
  return f;
}
async function mfaTurnedOn(j, what){
  await user.getIdToken(true); await mfaRefresh();
  if (j.backup) mfaBackup(j.backup, `${what} is on!`); else mfaMain(`${what} is on!`);
}
async function mfaTotpStart(){
  const j = await mfaApi(user, { action:"totpStart" }); if (!j.secret) return mfaSay(mfaErr(j));
  const steps = el("ol"); ["Open your authenticator app and tap + to add an account.", "Scan this QR code. On this device? Tap the button below instead.", "Type the 6-digit code the app shows."].forEach(t => steps.append(el("li", null, t)));
  const open = el("a", "outline", "Open in my authenticator app"); open.href = j.uri; open.style.textAlign = "center"; open.style.textDecoration = "none";
  const back = mfaBtn("‹ Back", async () => mfaMain(), "linkbtn");
  mfaShow(steps, await drawQr(j.uri), open, el("small", "fine", "Can't scan? Type this key into the app:"), el("div", "mfasecret", j.secret.match(/.{1,4}/g).join(" ")),
    mfaCodeForm("Turn on", async v => { const r = await mfaApi(user, { action:"totpConfirm", code: v }); if (!r.ok) return mfaSay(mfaErr(r)); await mfaTurnedOn(r, "Authenticator app"); }), back);
}
async function mfaEmailStart(){
  const j = await mfaApi(user, { action:"emailStart" }); if (!j.sent) return mfaSay(mfaErr(j));
  const again = mfaBtn("Send it again", async () => { const r = await mfaApi(user, { action:"emailStart" }); mfaSay(r.sent ? "Sent again! Check your spam folder too." : mfaErr(r)); }, "linkbtn");
  mfaShow(el("p", null, `We sent a 6-digit code to ${user.email}. Type it here. Can't find it? Check your spam or junk folder. It comes from Orbs AI, so tap "Not spam" if it's there.`),
    mfaCodeForm("Turn on", async v => { const r = await mfaApi(user, { action:"emailConfirm", code: v }); if (!r.ok) return mfaSay(mfaErr(r)); await mfaTurnedOn(r, "Email codes"); }),
    again, mfaBtn("‹ Back", async () => mfaMain(), "linkbtn"));
}
// Turning something off or making new backup codes needs a code first (in case someone else grabbed your device)
function mfaNeedCode(action, method){
  const kinds = [mfa.totp && ["totp", "App"], mfa.email && ["email", "Email"], ["backup", "Backup code"]].filter(Boolean);
  let kind = kinds[0][0];
  const seg = el("div", "seg"); const form = mfaCodeForm(action === "off" ? "Turn off" : "Get new codes", async v => {
    const r = await mfaApi(user, { action, method, kind, code: v }); if (!r.ok) return mfaSay(mfaErr(r));
    if (action === "newBackup") return mfaBackup(r.backup, "New backup codes made. The old ones don't work anymore.");
    await user.getIdToken(true); await mfaRefresh(); mfaMain(r.on ? "Turned off." : "Two-step sign-in is off.");
  });
  const send = mfaBtn("Email me a code", async () => { const r = await mfaApi(user, { action:"sendCheck" }); mfaSay(r.sent ? "Sent! Check your inbox, and your spam folder too." : mfaErr(r)); });
  const pick = k => { kind = k; for (const b of seg.children) b.setAttribute("aria-pressed", String(b.dataset.k === k)); send.hidden = k !== "email"; form.querySelector("input").placeholder = k === "backup" ? "abcd-1234" : "123456"; form.querySelector("input").inputMode = k === "backup" ? "text" : "numeric"; };
  for (const [k, t] of kinds) { const b = el("button", null, t); b.type = "button"; b.dataset.k = k; b.onclick = () => pick(k); seg.append(b); }
  mfaShow(el("p", null, "To keep your account safe, type a code first."), seg, send, form, mfaBtn("‹ Back", async () => mfaMain(), "linkbtn"));
  pick(kind);
}
function mfaBackup(codes, msg){
  const list = el("div", "mfacodes"); codes.forEach(c => list.append(el("span", null, c)));
  const copy = mfaBtn("Copy codes", async () => { try { await navigator.clipboard.writeText(codes.join("\n")); mfaSay("Copied! Paste them somewhere safe."); } catch(_) { mfaSay("Couldn't copy. Take a screenshot instead."); } });
  mfaShow(el("p", null, msg), el("p", null, "Save these backup codes somewhere safe, like your Notes app or a screenshot. If you lose your phone or can't get emails, they're the only way back in. Each one works once."),
    list, copy, mfaBtn("I saved them", async () => mfaMain(), "gbtn"));
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
const NEWS_VERSION = "2026-10-halloween";
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
const POPUPS = ["tosModal","privModal","safetyModal","reportModal","helpModal","newsModal","keysModal","fbModal","adminModal","planModal","memModal","mfaModal","promoModal","hwModal"];
function closeLegal(){ for (const id of POPUPS) $(id).hidden = true; if (legalBack && legalBack.focus) legalBack.focus(); if (typeof popupQ !== "undefined" && popupQ.length) setTimeout(nextPopup, 450); }
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
const PLAN_NAMES = { plus:"Light", plusplus:"Pro", plusplusplus:"Max" };
// Plan icons (plans/*.webp, PNG fallback): Free = plain black orb, Light = 1 dot, Pro = 2, Max = 3
const PLAN_ICON_IDS = ["free", "plus", "plusplus", "plusplusplus"];
function planIcon(id, px = 24, cls = "picon"){
  id = PLAN_ICON_IDS.includes(id) ? id : "free";
  const big = px > 48 ? 256 : 128;
  const pic = document.createElement("picture"); pic.className = cls;
  const src = document.createElement("source"); src.type = "image/webp"; src.srcset = `/plans/${id}-${big}.webp`;
  const img = document.createElement("img"); img.src = `/plans/${id}-${big}.png`; img.alt = ""; img.width = px; img.height = px; img.decoding = "async"; img.draggable = false;
  pic.append(src, img); pic.style.setProperty("--ps", px + "px"); return pic;
}
// Which icon goes with the account right now (the owner shows the top plan; testing shows the plan being tested)
function myPlanId(){ const p = kids.plan; return p ? p.id : kids.owner ? "plusplusplus" : "free"; }
function nextPlanId(){ const i = PLAN_ICON_IDS.indexOf(myPlanId()); return PLAN_ICON_IDS[Math.min(i + 1, 3)]; }
// Sale: code WELCOME7 = 7% off the first payment of Light and Pro until Nov 1, 2026 11:59 PM EDT (typed at Stripe checkout)
const PROMO_UNTIL = Date.parse("2026-11-02T03:59:59Z"), PROMO_PLANS = ["plus", "plusplus"];
const promoOn = id => Date.now() < PROMO_UNTIL && (!id || PROMO_PLANS.includes(id));
// Popups after sign-in, one after another: Halloween first, then the sale
let popupQ = [];
const seenOnce = key => { try { if (localStorage.getItem(key) === "seen") return true; localStorage.setItem(key, "seen"); } catch(_) {} return false; };
function nextPopup(){ if (!popupQ.length || POPUPS.some(id => !$(id).hidden)) return; openLegal(popupQ.shift()); }
async function maybePromo(){
  await seasonP;
  popupQ = [];
  if (seasonOn && !seenOnce("orbs-hw" + new Date().getFullYear())) { popupQ.push("hwModal"); orbInto($("hwSpooks"), "spooks"); orbInto($("hwHex"), "hex"); }
  if (promoOn() && kids.billing && !kids.plan && !seenOnce("orbs-promo7")) popupQ.push("promoModal");
  setTimeout(nextPopup, 1200);
}
$("hwGoSpooks").onclick = () => { closeLegal(); pick("spooks"); };
$("hwGoHex").onclick = () => { closeLegal(); pick("hex"); };
$("promoNav").onclick = () => openLegal("promoModal");
$("promoGo").onclick = () => { closeLegal(); openPlans(); };
$("promoCopy").onclick = async () => { try { await navigator.clipboard.writeText("WELCOME7"); $("promoCopy").textContent = "Copied!"; } catch(_) { $("promoCopy").textContent = "Copy failed"; } setTimeout(() => { $("promoCopy").textContent = "Copy"; }, 2000); };
const PLAN_INFO = [
  { id:"plus", name:"Light", color:"#4f7bff", month:9.99, year:99.99, perks:["Claude Sonnet", "3.8x the usage of Free", "10 web searches a day", "Orb Teams: up to 5 orbs work together"], soon:[] },
  { id:"plusplus", name:"Pro", color:"#9b5cff", month:19.99, year:199.99, pop:true, perks:["Claude Opus, the smartest model", "16.8x the usage of Free", "25 web searches a day", "Memory: orbs remember you", "Orb Teams: up to 5 orbs work together"], soon:["Custom orbs"] },
  { id:"plusplusplus", name:"Max", color:"#ff5fb8", month:49.99, year:499.99, perks:["Claude Opus, the smartest model", "46.1x the usage of Free", "50 web searches a day", "Memory: orbs remember you", "Orb Teams: up to 5 orbs work together", "New features first"], soon:["Custom orbs"] },
];
// Landing pricing cards (same plans as the Upgrade window)
(function landingPlans(){
  const grid = $("lpGrid"); if (!grid) return;
  const card = (name, color, price, sub, perks, pop, id) => {
    const c = el("div", "pcard" + (pop ? " pop" : "")); c.style.setProperty("--pc", color);
    const pr = el("div", "price", price); if (sub) pr.append(el("small", null, sub));
    const deal = id && promoOn(id) ? el("div", "pdeal", "Code WELCOME7: 7% off first payment · ends Nov 1") : null;
    const ul = el("ul"); perks.forEach(t => ul.append(el("li", null, t)));
    const b = el("button", "gbtn", "Get started"); b.type = "button"; b.onclick = () => setAuthMode("up");
    const h = el("h3"); h.append(planIcon(id || "free", 40), el("span", null, name));
    c.append(h, pr); if (deal) c.append(deal); c.append(ul, b); grid.append(c);
  };
  card("Free", "#6e6b64", "$0", "", ["A little usage every day and week", "Claude Sonnet", "A few web searches a day"]);
  for (const pl of PLAN_INFO) card(pl.name, pl.color, "$" + pl.month, " / month", [...pl.perks, ...pl.soon.map(t => t + " (coming soon)"), "or $" + pl.year + " a year"], pl.pop, pl.id);
})();
let planInterval = "month";
async function refreshStatus(){ if (!user) return; try { await kidsApi(user, { action:"status" }); renderUsage(); renderPlan(); syncSel(); } catch(_) {} }
const fmtDate = sec => sec ? new Date(sec * 1000).toLocaleDateString([], { month:"short", day:"numeric", year:"numeric" }) : "";
function renderPlan(){
  const p = kids.plan, on = !!kids.billing;
  const testing = kids.owner && kids.viewAs && kids.viewAs !== "owner";
  $("planIco").replaceChildren(planIcon(myPlanId(), 28));
  $("avPlan").replaceChildren(user ? planIcon(myPlanId(), 18) : ""); $("avPlan").hidden = !user;
  $("upNavIco").replaceChildren(planIcon(p ? p.id : kids.owner ? "plusplusplus" : "plus", 26));
  $("limitUp").replaceChildren(planIcon(nextPlanId(), 20), "Upgrade for more");
  $("planTxt").textContent = testing ? `Testing as ${p ? "Orbs " + p.name : "Free"} 🧪` : p ? `Orbs ${p.name} (${p.interval === "year" ? "yearly" : "monthly"})` + (kids.owner ? " + Owner 👑" : "") : kids.owner ? "Owner 👑 (everything unlocked)" : "Free";
  $("viewBox").hidden = !kids.owner;
  for (const b of document.querySelectorAll("#viewSeg button")) b.setAttribute("aria-pressed", String(b.dataset.v === (kids.viewAs || "owner")));
  $("planMore").textContent = testing ? "You're seeing Orbs like someone on this plan. Switch back to Owner below when you're done." : p ? (p.cancelAtPeriodEnd ? `Cancelled. You keep ${p.name} until ${fmtDate(p.periodEnd)}.` : p.status === "past_due" ? "Your last payment didn't go through. Update your card in Manage so you don't lose your plan." : `Renews ${fmtDate(p.periodEnd)}.`)
    : kids.owner ? "You get unlimited usage and as many web searches as the site allows. You can still test buying a plan." : on ? "A little usage every day and week. Upgrade for 1.75x to 6.25x more usage, Orb Teams, memory, and more web searches." : "";
  $("planBtn").hidden = !on && !p; $("planBtn").textContent = p ? "Manage" : "Upgrade";
  $("promoNav").hidden = !user || !on || !promoOn() || !!(p && !p.test);
  $("upNav").hidden = !user || !on; $("upNavTxt").textContent = testing ? "Testing 🧪" : p ? `Orbs ${p.name}` : kids.owner ? "Owner 👑" : "Upgrade";
  $("planBtn").hidden = $("planBtn").hidden || testing;
  $("limitUp").hidden = !on || (p && p.id === "plusplusplus");
  renderTeam();   // the Teams lock depends on the plan
}
for (const b of document.querySelectorAll("#viewSeg button")) b.onclick = () => busyBtn(b, async () => {
  $("viewMsg").textContent = "Switching…";
  try { await adminApi({ action:"viewAs", plan: b.dataset.v }); await refreshStatus(); limitHit = usageOut(); renderUsage();
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
  const fl = el("ul"); ["A little usage every day and week", "Claude Sonnet", !cur && Number.isInteger(kids.webPerDay) ? `${kids.webPerDay} web searches a day` : "A few web searches a day"].forEach(t => fl.append(el("li", null, t)));
  const fb = el("button", "outline", !cur ? "Current plan" : "Included"); fb.type = "button"; fb.disabled = true;
  const fh = el("h3"); fh.append(planIcon("free", 40), el("span", null, "Free"));
  free.append(fh, el("div", "price", "$0"), fl, fb); grid.append(free);
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
    const h = el("h3"); h.append(planIcon(pl.id, 40), el("span", null, pl.name));
    c.append(h, price);
    if (promoOn(pl.id) && !cur) c.append(el("div", "pdeal", "Code WELCOME7: 7% off first payment · ends Nov 1"));
    c.append(ul, b); grid.append(c);
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
      msgEl.textContent = j.error === "billing_off" ? "Paid plans aren't turned on yet." : j.error === "no_subscription" ? "You don't have a plan yet." : j.error === "age_required" ? "Set your age in Settings first." : j.error === "unverified" ? "Verify your email first." : "Couldn't open Stripe" + (j.why ? ": " + j.why : ". Try again.");
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
const centsTxt = c => (Math.round(c * 10) / 10) + "¢";   // budgets can be fractional, like 17.5¢
const when = t => t ? new Date(t).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }) : "";
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
    grid.append(card("Spent today (about)", money(today.cents), today.messages + " Claude calls" + (today.messages ? " · " + money(today.cents / today.messages) + " each" : "")), card("This month (about)", money(month)),
      card("Usage billed today", money(d.siteCentsToday || 0), d.budgets && d.budgets.site ? "site cap " + money(d.budgets.site) : "no site-wide cap"),
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
    if (d.budgets) body.append(el("h3", null, "Usage budgets in effect"), el("p", "fine", ["free", "plus", "plusplus", "plusplusplus"].map(t => `${t === "free" ? "Free" : PLAN_NAMES[t]}: ${d.budgets[t].day ? centsTxt(d.budgets[t].day) : "∞"} a day, ${d.budgets[t].week ? centsTxt(d.budgets[t].week) : "∞"} a week${t !== "free" && d.budgets.free.day ? " (" + (Math.round(d.budgets[t].day / d.budgets.free.day * 100) / 100) + "x Free)" : ""}`).join(" · ") + ". Every orb runs on Claude Opus. People only see percentages."));
    body.append(el("p", "fine", "These are estimates from Orbs. Your real bill is in the Claude Console."));
  }
  if (adminTab === "settings") {
    const c = d.config, f = el("form", "aform");
    const sw = (key, label, help) => { const r = el("label", "arow"); const i = el("input"); i.type = "checkbox"; i.name = key; i.checked = !!c[key]; r.append(i, el("span", null, label)); if (help) r.append(el("small", "fine", help)); return r; };
    const numIn = (key, label, help, ph) => { const r = el("label", "arow num"); const i = el("input"); i.type = "number"; i.min = "0"; i.max = "10000000"; i.step = key.endsWith("Cents") ? "0.1" : "1"; i.name = key; i.value = c[key] == null ? "" : c[key]; i.placeholder = ph || (key.startsWith("searches") ? "0" : "No limit"); r.append(el("span", null, label), i); if (help) r.append(el("small", "fine", help)); return r; };
    // Usage budgets, in cents of real Claude cost. Empty = Vercel's USAGE_BUDGETS or the built-in default, 0 = unlimited.
    const defB = d.defaultBudgets || {}, budgetRows = [];
    for (const t of ["free", "plus", "plusplus", "plusplusplus"]) {
      const nm = t === "free" ? "Free" : PLAN_NAMES[t];
      budgetRows.push(numIn(t + "DayCents", `${nm}: daily usage (cents)`, null, "Default " + (defB[t] ? defB[t].day : "")), numIn(t + "WeekCents", `${nm}: weekly usage (cents)`, null, "Default " + (defB[t] ? defB[t].week : "")));
    }
    f.append(
      sw("paused", "Pause Orbs (emergency stop)", "Nobody can send messages while this is on."),
      (() => { const r = el("label", "arow num"); const i = el("input"); i.name = "pausedMsg"; i.maxLength = 300; i.value = c.pausedMsg || ""; i.placeholder = "Message to show (optional)"; r.append(el("span", null, "Pause message"), i); return r; })(),
      sw("webSearch", "Allow web search", "About 1 cent per search, plus a bit more for reading the results."),
      numIn("searchesPerUser", "Web searches per person per day"),
      numIn("searchesSite", "Web searches per day for the whole site"),
      el("p", "fine", "Usage budgets are in cents of real Claude cost (a typical Sonnet message is about 1 to 3 cents, Opus about 2 to 6). Empty = default" + (d.envBudgets ? " (from USAGE_BUDGETS in Vercel)" : "") + ", 0 = unlimited. People only see a percentage."),
      ...budgetRows,
      numIn("siteDayCents", "Whole site: daily usage (cents)", "Empty = SITE_DAILY_CENTS in Vercel, or no cap. 0 = no cap.", "No cap"),
      sw("kidsForAll", "Kids Mode for everyone", "Turns on Kids Mode for every account on the site."),
      (() => { const r = el("label", "arow num"); const sel = el("select"); sel.name = "halloween";
        for (const [v, t] of [["auto", "Auto (October only)"], ["on", "On"], ["off", "Off"]]) { const o = el("option", null, t); o.value = v; if ((c.halloween || "auto") === v) o.selected = true; sel.append(o); }
        r.append(el("span", null, "🎃 Halloween (Spooks and Hex)"), sel, el("small", "fine", "Auto = they show up in October 2026 and leave on November 1, and they do not come back on their own. On or Off overrides that.")); return r; })());
    const go = el("button", "gbtn", "Save settings"); go.type = "submit"; const msg = el("small", "fine"); f.append(go, msg);
    f.onsubmit = e => { e.preventDefault(); busyBtn(go, async () => {
      const out = {};
      for (const i of f.querySelectorAll("select")) out[i.name] = i.value;
      for (const i of f.querySelectorAll("input")) {
        if (i.type === "checkbox") out[i.name] = i.checked;
        else if (i.type === "number") out[i.name] = i.value === "" ? (i.name.startsWith("searches") ? 0 : null) : i.name.endsWith("Cents") ? Math.max(0, Math.round(Number(i.value) * 10) / 10 || 0) : Math.max(0, Math.floor(Number(i.value)) || 0);
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
    const by = {};
    for (const f of d.feedback) { const k = BOTS[f.orb] ? f.orb : "?"; by[k] = by[k] || { up:0, down:0 }; by[k][f.vote === "up" ? "up" : "down"]++; }
    const grid = el("div", "agrid");
    Object.entries(by).forEach(([k, v]) => grid.append(card(BOTS[k] ? BOTS[k].name : "Other", `👍 ${v.up}  👎 ${v.down}`)));
    body.append(el("h3", null, "Thumbs, latest 300"), grid, el("h3", null, "Thumbs down"));
    list(d.feedback.filter(f => f.vote === "down"), "No thumbs down yet.", f => { const x = el("div", "aitem");
      x.append(el("div", "ameta", `${BOTS[f.orb]?.name || "?"} · ${when(f.at)}${f.tag ? " · " + f.tag.replace(/_/g, " ") : ""}`));
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

// ---------- Start ----------
renderUsage();
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
