// Orbs website app. Sign-in and saving use Firebase; chatting goes through /api/chat (your server).
import { firebaseConfig } from "./firebase-config.js";
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
// Chats live in your Firebase account; this is just the copy on screen.
let chats = {};
for (const k of ORDER) chats[k] = [];
function save(){ cloudSave(); }

function greeting(){
  const h = new Date().getHours();
  return h < 5 ? "Up late, huh?" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// Tiny safe markdown: escape first, then code fences, inline code, bold, lists, headings, paragraphs
function esc(s){ return s.replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function inline(s){
  return s.replace(/`([^`]+)`/g, "<code>$1</code>")
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
          .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}
function md(src){
  const parts = esc(src).split(/```/);
  let html = "";
  parts.forEach((part, i) => {
    if (i % 2 === 1) { html += "<pre><code>" + part.replace(/^[\w+-]*\n/, "") + "</code></pre>"; return; }
    for (let b of part.split(/\n{2,}/)) {
      b = b.trim(); if (!b) continue;
      const lines = b.split("\n");
      if (lines.every(l => /^\s*[-*•]\s+/.test(l))) html += "<ul>" + lines.map(l => "<li>" + inline(l.replace(/^\s*[-*•]\s+/, "")) + "</li>").join("") + "</ul>";
      else if (lines.every(l => /^\s*\d+[.)]\s+/.test(l))) html += "<ol>" + lines.map(l => "<li>" + inline(l.replace(/^\s*\d+[.)]\s+/, "")) + "</li>").join("") + "</ol>";
      else if (/^#{1,4}\s/.test(b)) html += "<h3>" + inline(b.replace(/^#{1,4}\s/, "")) + "</h3>";
      else html += "<p>" + inline(lines.join("<br>")) + "</p>";
    }
  });
  return html;
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
  app.dataset.view = "home";
  const mark = $("mark");
  $("greet").textContent = greeting();
  if (active) {
    const b = BOTS[active];
    mark.className = "mark"; orbInto(mark, active);
    box.disabled = false; form.classList.remove("locked");
    box.placeholder = b.ask;
    $("whoText").textContent = b.name;
  } else {
    mark.className = "mark empty"; mark.innerHTML = ""; mark.textContent = "?";
    box.disabled = true; form.classList.add("locked");
    box.placeholder = "Pick an orb below to start…";
    $("whoText").textContent = "No orb picked";
  }
  setAccent(); renderPicker(); updateSend(); snap(); renderSide();
}

const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>', RETRY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
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
function actBtn(svg, label, fn){ const b = document.createElement("button"); b.type = "button"; b.className = "act"; b.innerHTML = svg; b.title = label; b.setAttribute("aria-label", label); b.onclick = () => fn(b); return b; }
// One message row. User: bubble on the right. Orb: plain text, full width, with actions underneath.
function bubble(role, html, raw, turn, isLast){
  const b = BOTS[active];
  const row = document.createElement("div");
  row.className = "row " + (role === "user" ? "me" : "bot-row");
  row.style.setProperty("--c", `var(${b.color})`);
  const col = document.createElement("div"); col.className = "col";
  const m = document.createElement("div"); m.className = "msg";
  if (raw != null) m.textContent = raw; else m.innerHTML = html;
  col.appendChild(m);
  if (turn) {
    const meta = document.createElement("div"); meta.className = "meta" + (isLast ? " show" : "");
    const ts = document.createElement("span"); ts.className = "ts"; ts.textContent = fmtTime(turn.t);
    if (role === "user") { meta.append(ts, actBtn(COPY_SVG, "Copy message", btn => copyText(turn.content, btn))); }
    else {
      meta.append(actBtn(COPY_SVG, "Copy reply", btn => copyText(turn.content, btn)));
      if (isLast) meta.append(actBtn(RETRY_SVG, "Try again", () => retry()));
      meta.append(ts);
    }
    col.appendChild(meta);
    if (role !== "user") addCodeCopy(m);
  }
  row.appendChild(col); log.appendChild(row);
  return m;
}
// The orb sits under the newest reply (like the Claude app); older replies stay still.
function tailOrb(thinking){
  log.querySelector(".tail")?.remove();
  const t = document.createElement("div"); t.className = "tail" + (thinking ? " think" : "");
  const g = document.createElement("div"); g.className = "av"; orbInto(g, active); t.appendChild(g);
  log.appendChild(t); return t;
}

function renderChat(){
  app.dataset.view = "chat";
  const b = BOTS[active];
  orbInto($("topGlyph"), active); $("topName").textContent = b.name; $("topRole").textContent = b.role;
  box.disabled = false; form.classList.remove("locked");
  box.placeholder = `Reply to ${b.name}…`;
  $("whoText").textContent = b.name;
  setAccent();
  log.innerHTML = "";
  const turns = chats[active];
  turns.forEach((t, i) => { const last = i === turns.length - 1; t.role === "user" ? bubble("user", null, t.content, t, last) : bubble("assistant", md(t.content), null, t, last); });
  if (turns.length && turns[turns.length - 1].role === "assistant" && !busy) tailOrb(false);
  log.scrollTop = log.scrollHeight;
  updateSend(); snap(); renderSide();
}

function pick(k){
  if (busy) return;
  active = k; status.textContent = "";
  if (chats[k].length) { renderChat(); }
  else {
    renderHome();
    const mark = $("mark"); mark.classList.remove("pop"); void mark.offsetWidth; mark.classList.add("pop"); setTimeout(() => mark.classList.remove("pop"), 600);
  }
  box.focus();
}

function updateSend(){
  if (busy) { sendBtn.disabled = false; sendBtn.setAttribute("aria-label","Stop");
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'; return; }
  sendBtn.setAttribute("aria-label","Send");
  sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  sendBtn.disabled = !active || !box.value.trim();
}

const ERR = {
  unauthenticated:"You got signed out. Sign in again.",
  unverified:"Verify your email first, then try again.",
  bad_request:"That message didn't go through. Try again.",
  site_busy:"Orbs used up its daily budget for everyone. Try again tomorrow.",
  overloaded:"Claude is super busy right now. Try again in a minute.",
  upstream_error:"Something went wrong reaching Claude. Try again.",
  not_configured:"The site isn't fully set up yet. The owner needs to add the keys on Vercel.",
  out_of_funds:"Orbs ran out of Claude money!! 😤💢 Tell the owner to add more, baka!",
  network:"Can't reach Orbs. Check your internet connection."
};

async function send(text, regen){
  text = (text || "").trim();
  if (!active) { nudge(); return; }
  if ((!text && !regen) || busy) return;
  if (!user) return;
  const key = active, b = BOTS[key], model = MODELS[pf(key).m];
  if (credits && credits.left < msgCost(pf(key))) { creditShort(model); return; }
  if (!regen) chats[key].push({ role:"user", content:text, t:Date.now() }); save();
  recent = [key, ...recent.filter(x => x !== key)]; save();
  box.value = ""; autosize();
  renderChat();
  const out = bubble("assistant", "");
  const tail = tailOrb(true);
  log.scrollTop = log.scrollHeight;
  busy = true; status.textContent = ""; updateSend();
  ctl = new AbortController();
  const ctx = chats[key].slice(-30).map(t => ({ role:t.role, content:t.content }));
  while (ctx.length && ctx[0].role !== "user") ctx.shift();
  let reply = "";
  try {
    const token = await user.getIdToken();
    let res;
    try {
      res = await fetch("/api/chat", {
        method:"POST",
        headers:{ "content-type":"application/json", authorization:"Bearer " + token },
        body: JSON.stringify({ orb:key, model:pf(key).m, effort:pf(key).e, messages:ctx }),
        signal: ctl.signal
      });
    } catch (e) { throw { code: e && e.name === "AbortError" ? "cancelled" : "network" }; }
    if (!res.ok) { let j = {}; try { j = await res.json(); } catch(_) {} throw { code: j.error || "upstream_error", left: j.left }; }
    // The server sends one small JSON object per line: {d:"more text"} ... then {done:true} or {error:"..."}
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
          if (typeof ev.d === "string") { reply += ev.d; tail.classList.remove("think"); out.innerHTML = md(reply); stickBottom(); }
          else end = ev;
        }
      }
    } catch (e) { throw { code: e && e.name === "AbortError" ? "cancelled" : "network", text: reply }; }
    if (!end) throw { code:"upstream_error", text: reply };
    if (end.error) throw { code:end.error, left:end.left, text: reply };
    setCredits(end.left);
    if (end.refused && !reply.trim()) throw { code:"refused" };
    chats[key].push({ role:"assistant", content:reply, t:Date.now() }); save(); limitHit = false; renderUsage();
    if (end.truncated) status.textContent = "That answer got cut off. Ask for a shorter one.";
    else if (end.refused) status.textContent = "The orb stopped there. Try asking a different way.";
  } catch (e) {
    const code = e && e.code || "upstream_error";
    if (typeof (e && e.left) === "number") setCredits(e.left);
    if (e && e.text) { chats[key].push({ role:"assistant", content:e.text, t:Date.now() }); save(); }
    if (code === "cancelled") status.textContent = "Stopped.";
    else if (code === "limit_reached") { if (credits && credits.left > 0) creditShort(model); else { limitHit = true; renderUsage(); status.textContent = "You're out of credits for today."; } }
    else if (code === "refused") status.textContent = "The orb couldn't answer that one. Try asking a different way.";
    else status.textContent = ERR[code] || ERR.upstream_error;
  } finally {
    busy = false; ctl = null;
    if (active === key) renderChat(); else updateSend();
  }
}

function creditShort(model){
  const cheaper = MODELS.filter(m => m.cost <= (credits ? credits.left : 0)).pop();
  if (!cheaper) { limitHit = true; renderUsage(); status.textContent = "You're out of credits for today."; return; }
  status.textContent = `Not enough credits left for ${model.n} today. Switch to ${cheaper.n} to keep chatting.`;
}

function retry(){
  if (busy || !active) return;
  const turns = chats[active];
  if (turns.length && turns[turns.length - 1].role === "assistant") turns.pop();
  if (!turns.length || turns[turns.length - 1].role !== "user") return;
  save(); send("", true);
}
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
$("homeBtn").onclick = () => { if (busy) return; renderHome(); };
let freshNext = false;
const shell = $("shell"), mobile = () => matchMedia("(max-width:760px)").matches;
function setSide(open){ shell.classList.toggle("closed", !open); try { if (!mobile()) localStorage.setItem("orbs-side", open ? "1" : "0"); } catch(e) {} }
let sideOpen = !mobile(); try { if (!mobile() && localStorage.getItem("orbs-side") === "0") sideOpen = false; } catch(e) {}
setSide(sideOpen);
$("hideBtn").onclick = () => { setSide(false); };
$("openBtn").onclick = () => setSide(true);
$("scrim").onclick = () => { setSide(false); };
$("sideNew").onclick = () => { if (busy) return; active = null; freshNext = true; status.textContent = ""; box.value = ""; renderHome(); if (mobile()) setSide(false); };
function openSet(){ $("settings").hidden = false; $("setBtn").setAttribute("aria-expanded", "true"); wipeArmed(false); killArmed(false); $("setMsg").textContent = ""; renderAccount(); renderUsage(); }
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
  for (const k of ORDER) chats[k] = []; save(); wipeArmed(false);
  $("settings").hidden = true; active = null; renderHome(); status.textContent = "All chats deleted.";
};

let pins = [], recent = [];
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
function closeMenus(){ for (const [m, b] of [["modelMenu","modelBtn"],["effMenu","effBtn"]]) { $(m).hidden = true; $(b).setAttribute("aria-expanded","false"); } }
function syncSel(){
  $("sels").hidden = !active; if (!active) return;
  const p = pf(active), m0 = MODELS[p.m];
  $("modelBtn").textContent = m0.n + " " + m0.v + " ▾";
  const menu = $("modelMenu"); menu.innerHTML = "";
  MODELS.forEach((m, i) => menu.appendChild(menuItem(m.n + " " + m.v, credits ? creditWord(m.cost) : "", m.d.charAt(0).toUpperCase() + m.d.slice(1) + ". Built on the latest " + m.base.replace(/ [\d.]+$/, "") + " model (" + m.base.replace(/^Claude /, "") + ").", i === p.m,
    () => { pf(active).m = i; savePrefs(); closeMenus(); syncSel(); })));
  $("effWrap").hidden = !hasEffort(p.m);
  $("effBtn").textContent = EFFORTS[p.e].n + " ▾";
  const em = $("effMenu"); em.innerHTML = "";
  EFFORTS.forEach((e, i) => em.appendChild(menuItem(e.n, credits ? "×" + e.mult : "", e.d.charAt(0).toUpperCase() + e.d.slice(1) + ".", i === p.e,
    () => { pf(active).e = i; savePrefs(); closeMenus(); syncSel(); })));
  hint();
}
function hint(){
  if (!active) { $("hint").textContent = ""; return; }
  const p = pf(active), m = MODELS[p.m];
  $("hint").textContent = m.n + " " + m.v + " (" + m.base + "): " + m.d + "." +
    (hasEffort(p.m) ? " " + EFFORTS[p.e].n + " effort: " + EFFORTS[p.e].d + "." : " No effort setting on " + m.n + ".") +
    (credits ? " Uses " + creditWord(msgCost(p)) + " per message." : "");
}
function toggleMenu(menuId, btnId){
  return e => { e.stopPropagation(); const mm = $(menuId), open = mm.hidden; closeMenus(); mm.hidden = !open; $(btnId).setAttribute("aria-expanded", String(open));
    if (open) mm.classList.toggle("down", $("form").getBoundingClientRect().top < mm.offsetHeight + 16); };
}
$("modelBtn").onclick = toggleMenu("modelMenu", "modelBtn");
$("effBtn").onclick = toggleMenu("effMenu", "effBtn");
document.addEventListener("click", closeMenus);
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
let delArm = null, delTimer = null;
function disarm(){ if (delArm) { delArm.classList.remove("armed"); delArm.innerHTML = TRASH_SVG; } delArm = null; clearTimeout(delTimer); }
function askDelete(k, btn){
  if (busy) return;
  if (delArm !== btn) { disarm(); delArm = btn; btn.classList.add("armed"); btn.textContent = "Delete?"; delTimer = setTimeout(disarm, 3500); return; }
  disarm();
  chats[k] = []; recent = recent.filter(x => x !== k);
  save();
  if (active === k && app.dataset.view === "chat") renderHome(); else renderSide();
  status.textContent = "Chat with " + BOTS[k].name + " deleted.";
}
function renderSide(){
  syncSel();
  const rec = $("recent"); rec.innerHTML = ""; const term = $("q").value.trim().toLowerCase();
  const shown = [...recent, ...ORDER.filter(k => !recent.includes(k))].filter(k => chats[k].length && (!term || chats[k].some(m => m.content.toLowerCase().includes(term))));
  for (const k of shown) { const row = document.createElement("div"); row.className = "rrow"; const hit = term ? chats[k].find(m => m.content.toLowerCase().includes(term)) : [...chats[k]].reverse().find(m => m.role === "user"); row.appendChild(item(k, hit ? hit.content.slice(0, 60) : ""));
    const del = document.createElement("button"); del.type = "button"; del.className = "icon-btn delb"; del.innerHTML = TRASH_SVG;
    del.setAttribute("aria-label", "Delete chat with " + BOTS[k].name); del.title = "Delete chat";
    del.onclick = e => { e.stopPropagation(); askDelete(k, del); };
    row.appendChild(del); rec.appendChild(row); }
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
$("delTop").onclick = () => { if (active) askDelete(active, $("delTop")); }; $("pinHome").onclick = togglePin;

// Back / forward through the screens you visited
let hist = [], hi = -1, restoring = false;
function snap(){
  if (restoring) return;
  const cur = { active, view: app.dataset.view }, top = hist[hi];
  if (!top || top.active !== cur.active || top.view !== cur.view) { hist = hist.slice(0, hi + 1); hist.push(cur); hi = hist.length - 1; }
  $("backBtn").disabled = hi <= 0; $("fwdBtn").disabled = hi >= hist.length - 1;
}
function travel(d){
  if (busy) return;
  const n = hi + d; if (n < 0 || n >= hist.length) return;
  hi = n; const s = hist[n]; restoring = true; active = s.active; status.textContent = "";
  if (s.view === "chat" && active && chats[active].length) renderChat(); else renderHome();
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
function renderUsage(){
  $("useBox").hidden = !credits;
  $("useState").textContent = credits
    ? creditWord(credits.left) + " left today" + (credits.limit ? " (out of " + credits.limit + ")" : "")
    : "Full credits today";
  $("useDot").className = "dot2 " + (limitHit ? "bad" : "ok");
  $("limit").hidden = !limitHit;
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
  for (const k of ORDER) chats[k] = [];
  pins = []; recent = []; prefs = {}; lastSent = {};
  active = null; hist = []; hi = -1; credits = null; limitHit = false;
  log.innerHTML = ""; $("q").value = ""; box.value = ""; status.textContent = "";
}

// ---------- Saving to Firebase ----------
const FB = "https://www.gstatic.com/firebasejs/12.19.0/";
let auth = null, db = null, A = null, F = null;
let lastSent = {}, cloudT = null, loaded = false;
function fitTurns(t){ t = t.slice(); while (t.length > 2 && JSON.stringify(t).length > 200000) t.shift(); return t; }
function cleanTurns(v){
  return Array.isArray(v) ? v.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role:m.role, content:m.content, t: typeof m.t === "number" ? m.t : undefined })).map(m => (m.t === undefined && delete m.t, m)) : [];
}
function cloudSave(){ if (!user || !loaded) return; clearTimeout(cloudT); cloudT = setTimeout(flush, 800); }
async function flush(){
  const uid = user && user.uid; if (!uid || !loaded) return;
  try {
    for (const k of ORDER) {
      const turns = fitTurns(chats[k]), j = JSON.stringify(turns);
      if (lastSent["chat_" + k] !== j) { await F.setDoc(F.doc(db, "users", uid, "data", "chat_" + k), { turns }); lastSent["chat_" + k] = j; }
    }
    const meta = { pins, recent, prefs }, mj = JSON.stringify(meta);
    if (lastSent.settings !== mj) { await F.setDoc(F.doc(db, "users", uid, "data", "settings"), JSON.parse(mj)); lastSent.settings = mj; }
  } catch (e) { status.textContent = "Couldn't save your chats right now. Check your connection."; }
}
async function loadAccount(u){
  loaded = false; resetState();
  const snap = await F.getDocs(F.collection(db, "users", u.uid, "data"));
  snap.forEach(d => {
    const v = d.data() || {};
    if (d.id.startsWith("chat_")) { const k = d.id.slice(5); if (Object.hasOwn(BOTS, k)) { chats[k] = cleanTurns(v.turns); lastSent[d.id] = JSON.stringify(chats[k]); } }
    else if (d.id === "settings") {
      pins = Array.isArray(v.pins) ? v.pins.filter(k => Object.hasOwn(BOTS, k)) : [];
      recent = Array.isArray(v.recent) ? v.recent.filter(k => Object.hasOwn(BOTS, k)) : [];
      prefs = v.prefs && typeof v.prefs === "object" ? JSON.parse(JSON.stringify(v.prefs)) : {};
      lastSent.settings = JSON.stringify({ pins, recent, prefs });
    }
  });
  try { const us = await F.getDoc(F.doc(db, "usage", u.uid)); creditsFromDoc(us.exists() ? us.data() : null); } catch (e) { credits = null; }
  loaded = true;
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

async function enter(u){
  showGate("loading");
  try { await loadAccount(u); }
  catch (e) { user = null; showGate("signin"); say("Couldn't load your chats. Check your connection and try again."); return; }
  user = u; renderProfile(); renderUsage(); gate.hidden = true; renderHome();
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
    const snap = await F.getDocs(F.collection(db, "users", user.uid, "data"));
    for (const d of snap.docs) await F.deleteDoc(d.ref);
    await A.deleteUser(user);
    closeSet();
  } catch (e) {
    loaded = true;
    $("setMsg").textContent = e && e.code === "auth/requires-recent-login"
      ? "For safety, sign out, sign back in, then try again."
      : "Couldn't delete your account. Try again.";
  }
});

// ---------- Terms and Privacy pop-ups ----------
let legalBack = null;
function openLegal(id){ legalBack = document.activeElement; $(id).hidden = false; $(id).querySelector("[data-close]").focus(); }
function closeLegal(){ for (const id of ["tosModal","privModal"]) $(id).hidden = true; if (legalBack && legalBack.focus) legalBack.focus(); }
document.addEventListener("click", e => {
  const o = e.target.closest("[data-open]"); if (o) { e.preventDefault(); openLegal(o.dataset.open); return; }
  if (e.target.closest("[data-close]") || e.target.classList.contains("legal-modal")) closeLegal();
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && (!$("tosModal").hidden || !$("privModal").hidden)) { e.stopImmediatePropagation(); closeLegal(); } }, true);

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
