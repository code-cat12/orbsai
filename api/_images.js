// Pictures from the web: when someone asks to see pictures of something, real ones are looked up first
// (Google Images or Brave API when a key is set in Vercel, otherwise free Wikipedia, Openverse and Wikimedia Commons) and handed to the orb, which shows the best ones.
const WORDS = "(?:pictures?|pics?|images?|photos?|photographs?)";
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, couple: 2, few: 3 };
// What they want pictures of, and how many, or null when they're not asking for pictures
export function imageAsk(text) {
  const s = String(text || "").slice(0, 600);
  let m = new RegExp(`\\b(?:(\\d+|a|an|one|two|three|four|couple|few|some)\\s+(?:of\\s+)?)?(?:\\w+\\s+)?${WORDS}\\s+(?:of|for|showing|with)\\s+([^?!\\n]{2,90})`, "i").exec(s);
  let subject = m && m[2], n = m && m[1] ? (NUM[m[1].toLowerCase()] || parseInt(m[1], 10) || 2) : 2;
  if (!subject) { const w = /\bwhat (?:does|do|did|would)\s+(.{2,60}?)\s+look like\b/i.exec(s); if (w) subject = w[1]; }
  if (!subject) { const x = new RegExp(`\\b(?:show|send|give|find|get)\\s+(?:me\\s+)?(?:some\\s+|a\\s+few\\s+|\\d+\\s+)?([^?!\\n]{2,60}?)\\s+${WORDS}\\b`, "i").exec(s); if (x) subject = x[1]; }
  if (!subject) { if (new RegExp(`\\b(?:show|send|give|find|get|see)\\b[^?!\\n]{0,30}\\b${WORDS}\\b`, "i").test(s) || new RegExp(`^\\s*(?:more|other|another|some|any)?\\s*${WORDS}\\s*[?!.]*\\s*$`, "i").test(s)) return { q: "", n, vague: true }; return null; }
  subject = subject.replace(/\b(from|on|off)\s+(the\s+)?(web|internet|online|google)\b.*$/i, "").replace(/\b(please|pls|for me|online)\b/gi, "").replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
  // "some images", "more pics", "pictures of it": no subject of their own, so the chat decides what to show
  subject = subject.replace(/^(?:(?:some|any|a few|few|more|other|another|cool|nice|good|random|great|the|a|an|your|me)\s+)+/i, "").trim();
  if (subject.length < 2 || /^(some|any|more|other|another|few|cool|nice|good|random|it|this|that|these|those|them|me|you|one|ones|something|stuff|things?)$/i.test(subject)) return { q: "", n, vague: true };
  return { q: subject.slice(0, 80), n: Math.max(1, Math.min(4, n)) };
}

// What a vague ask ("show me some images") should show: what the chat was last about, else the orb's own topic
const ORB_PICS = { cook: "delicious homemade food dishes", tech: "cool tech gadgets", game: "video game scenery", web: "beautiful website design", write: "fantasy story illustration",
  study: "science and nature", music: "musical instruments", lang: "famous landmarks around the world", spooks: "halloween party decorations", hex: "spooky haunted house", neb: "beautiful nature landscapes" };
export function vagueSubject(turns, orb) {
  const users = (turns || []).filter((t) => t.role === "user").map((t) => typeof t.content === "string" ? t.content : (t.content || []).map((c) => c.text || "").join(" "));
  for (let i = users.length - 2; i >= 0; i--) { const a = imageAsk(users[i]); if (a && a.q) return a.q; }
  const last = users.length > 1 ? users[users.length - 2].replace(/[?!.]+$/, "").trim() : "";
  if (last && last.length <= 60 && !imageAsk(last)) return last;
  return ORB_PICS[orb] || "beautiful nature landscapes";
}
// Sites that mostly copy other people's pictures (or spam), and endings that are rarely good picture sources for English chats
const SPAM_HOST = /(^|\.)(artofit\.org|inspiredpencil\.com|hyperchoreography\.org|engames\.eu|yaf2017\.org|moyanahodka\.ru|pinimg\.com|lookaside\.fbsbx\.com|lookaside\.instagram\.com|x\.com|twimg\.com|tiktok\.com|wallpaperaccess\.com|wallpapercave\.com|i\.pinimg\.com)$/i;
const SPAM_TLD = /\.(ru|su|cn|top|xyz|icu|buzz|cyou|monster|click|rest|bond|sbs|cfd|lol|quest|work|live|kz|by|ua)$/i;
export function goodSource(u) { try { const h = new URL(u).hostname.replace(/^www\./, ""); return !SPAM_HOST.test(h) && !SPAM_TLD.test(h) && !/\d{3,}/.test(h); } catch { return false; } }
// Only the pictures the orb really showed get source chips
export function shownSources(found, reply) {
  const s = String(reply || ""), seen = new Set();
  return found.filter((r) => s.includes(r.url)).map((r) => ({ u: r.page.slice(0, 500), t: r.title.slice(0, 200) })).filter((x) => !seen.has(x.u) && seen.add(x.u)).slice(0, 4);
}
const okUrl = (u) => typeof u === "string" && /^https:\/\/[^\s"'<>()]+$/.test(u) && u.length < 600;
const clean = (t) => String(t || "").replace(/^File:/, "").replace(/\.(jpe?g|png|webp|gif)$/i, "").replace(/[_[\]()*`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);

async function timed(fetchImpl, url, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetchImpl(url, { signal: ac.signal, headers: { "user-agent": "OrbsAI/1.0 (https://orbsai.app)", accept: "application/json" } }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
}
// The whole web: Google Images through Serper (SERPER_API_KEY) or Brave Image Search (BRAVE_SEARCH_KEY), when set in Vercel.
async function webImages(q, { fetchImpl, env, ms }) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    if (env.SERPER_API_KEY) {
      const r = await fetchImpl("https://google.serper.dev/images", { method: "POST", signal: ac.signal,
        headers: { "X-API-KEY": env.SERPER_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ q, num: 10, safe: "active" }) });
      const j = r.ok ? await r.json() : null;
      return (j?.images || []).filter((x) => okUrl(x.imageUrl) && (!x.imageWidth || x.imageWidth >= 300))
        .map((x) => ({ url: x.imageUrl, title: clean(x.title) || q, page: okUrl(x.link) ? x.link : x.imageUrl }));
    }
    if (env.BRAVE_SEARCH_KEY) {
      const r = await fetchImpl(`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(q)}&count=10&safesearch=strict`, { signal: ac.signal,
        headers: { "X-Subscription-Token": env.BRAVE_SEARCH_KEY, accept: "application/json" } });
      const j = r.ok ? await r.json() : null;
      // Brave's own copy of each picture loads reliably (some sites block pictures shown on other sites)
      return (j?.results || []).map((x) => ({ url: okUrl(x.thumbnail?.src) ? x.thumbnail.src : x.properties?.url, title: clean(x.title) || q, page: x.url }))
        .filter((x) => okUrl(x.url)).map((x) => ({ ...x, page: okUrl(x.page) ? x.page : x.url }));
    }
  } catch {} finally { clearTimeout(t); }
  return [];
}
const unq = (t) => { try { return JSON.parse(`"${t}"`); } catch { return t; } };
export function parseBrave(html) {
  const out = [];
  const re = /\{title:"((?:[^"\\]|\\.)*)",url:"((?:[^"\\]|\\.)*)"[\s\S]{0,900}?thumbnail:\{src:"((?:[^"\\]|\\.)*)"[^}]{0,400}?original:"((?:[^"\\]|\\.)*)"/g;
  for (const m of String(html).matchAll(re)) {
    const page = unq(m[2]), thumb = unq(m[3]), orig = unq(m[4]);
    const url = okUrl(thumb) ? thumb : orig;
    if (okUrl(url)) out.push({ url, title: clean(unq(m[1])) || "", page: okUrl(page) ? page : url, orig: okUrl(orig) ? orig : null });
    if (out.length >= 12) break;
  }
  return out;
}
async function braveFree(q, { fetchImpl, signal }) {
  try {
    const r = await fetchImpl(`https://search.brave.com/images?q=${encodeURIComponent(q)}&safesearch=strict`, { signal,
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", "accept-language": "en-US" } });
    const html = r.ok ? await r.text() : "";
    return parseBrave(html).map((x) => ({ url: x.url, title: x.title || q, page: x.page })).filter((x) => goodSource(x.page));
  } catch { return []; }
}
export async function findImages(q, { fetchImpl = fetch, env = {}, max = 6, ms = 3500 } = {}) {
  const enc = encodeURIComponent(q);
  const web = (await webImages(q, { fetchImpl, env, ms })).filter((x) => goodSource(x.page) && goodSource(x.url));
  if (web.length >= 3) return web.slice(0, max);
  const [ov, wm, wp] = await Promise.all([
    timed(fetchImpl, `https://api.openverse.org/v1/images/?q=${enc}&page_size=8&mature=false`, ms),
    timed(fetchImpl, `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=${enc}%20filetype:bitmap&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=960`, ms),
    // Wikipedia: the main picture of the articles that best match
    timed(fetchImpl, `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${enc}&gsrlimit=6&prop=pageimages|info&inprop=url&piprop=thumbnail&pithumbsize=960`, ms),
  ]);
  const w = Object.values(wp?.query?.pages || {}).sort((x, y) => (x.index || 0) - (y.index || 0))
    .filter((p) => okUrl(p.thumbnail?.source) && !/\.svg/i.test(p.thumbnail.source) && (p.thumbnail.width || 0) >= 300)
    .map((p) => ({ url: p.thumbnail.source, title: clean(p.title) || q, page: okUrl(p.fullurl) ? p.fullurl : p.thumbnail.source }));
  const a = (ov?.results || []).filter((r) => okUrl(r.url) && (!r.width || r.width >= 400))
    .map((r) => ({ url: r.url, title: clean(r.title) || q, page: okUrl(r.foreign_landing_url) ? r.foreign_landing_url : r.url }));
  const b = Object.values(wm?.query?.pages || {}).sort((x, y) => (x.index || 0) - (y.index || 0))
    .map((p) => ({ info: (p.imageinfo || [])[0] || {}, title: p.title }))
    .filter((p) => /^image\/(jpeg|png|webp)$/.test(p.info.mime || "") && okUrl(p.info.thumburl))
    .map((p) => ({ url: p.info.thumburl, title: clean(p.title) || q, page: okUrl(p.info.descriptionurl) ? p.info.descriptionurl : p.info.thumburl }));
  // Take turns from each source so one bad source doesn't fill the list
  const out = web.slice(0, max), seen = new Set(out.map((r) => r.url));
  for (let i = 0; out.length < max && (i < a.length || i < b.length || i < w.length); i++) {
    for (const r of [w[i], a[i], b[i]]) if (r && !seen.has(r.url) && out.length < max) { seen.add(r.url); out.push(r); }
  }
  return out;
}
export function imageRules(ask, found, capped = false) {
  if (capped) return "The person asked to see pictures, but they've reached today's picture limit. Say so kindly in one short line (it resets tomorrow) and answer the rest. Never make up a picture address.";
  if (!found.length) return `The person asked to see pictures of "${ask.q}", but the picture search found nothing this time. Say so in one short line and answer the rest. Never make up a picture address.`;
  return `The person asked to see pictures of "${ask.q}". A picture search found these real ones online:\n` +
    found.map((r, i) => `${i + 1}. ![${r.title}](${r.url})`).join("\n") +
    `\nShow ${ask.n} of them (the ones that best match what they asked for) by copying those Markdown lines exactly, each on its own line, then a short friendly sentence. ` +
    "Use only these addresses; never change or make up a picture address. If none match, say you couldn't find good pictures this time.";
}
