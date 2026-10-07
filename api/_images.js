// Pictures from the web: when someone asks to see pictures of something, real ones are looked up first
// (Google Images or Brave when a key is set in Vercel, otherwise Openverse and Wikimedia Commons, which are free) and handed to the orb, which shows the best ones.
const WORDS = "(?:pictures?|pics?|images?|photos?|photographs?)";
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, couple: 2, few: 3 };
// What they want pictures of, and how many, or null when they're not asking for pictures
export function imageAsk(text) {
  const s = String(text || "").slice(0, 600);
  let m = new RegExp(`\\b(?:(\\d+|a|an|one|two|three|four|couple|few|some)\\s+(?:of\\s+)?)?(?:\\w+\\s+)?${WORDS}\\s+(?:of|for|showing|with)\\s+([^?!\\n]{2,90})`, "i").exec(s);
  let subject = m && m[2], n = m && m[1] ? (NUM[m[1].toLowerCase()] || parseInt(m[1], 10) || 2) : 2;
  if (!subject) { const w = /\bwhat (?:does|do|did|would)\s+(.{2,60}?)\s+look like\b/i.exec(s); if (w) subject = w[1]; }
  if (!subject) { const x = new RegExp(`\\b(?:show|send|give|find|get)\\s+(?:me\\s+)?(?:some\\s+|a\\s+few\\s+|\\d+\\s+)?([^?!\\n]{2,60}?)\\s+${WORDS}\\b`, "i").exec(s); if (x) subject = x[1]; }
  if (!subject) return null;
  subject = subject.replace(/\b(from|on|off)\s+(the\s+)?(web|internet|online|google)\b.*$/i, "").replace(/\b(please|pls|for me|online)\b/gi, "").replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
  if (subject.length < 2 || /^(it|this|that|them|me|you)$/i.test(subject)) return null;
  return { q: subject.slice(0, 80), n: Math.max(1, Math.min(4, n)) };
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
export async function findImages(q, { fetchImpl = fetch, env = {}, max = 6, ms = 3500 } = {}) {
  const enc = encodeURIComponent(q);
  const web = await webImages(q, { fetchImpl, env, ms });
  if (web.length >= 3) return web.slice(0, max);
  const [ov, wm] = await Promise.all([
    timed(fetchImpl, `https://api.openverse.org/v1/images/?q=${enc}&page_size=8&mature=false`, ms),
    timed(fetchImpl, `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=${enc}%20filetype:bitmap&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=960`, ms),
  ]);
  const a = (ov?.results || []).filter((r) => okUrl(r.url) && (!r.width || r.width >= 400))
    .map((r) => ({ url: r.url, title: clean(r.title) || q, page: okUrl(r.foreign_landing_url) ? r.foreign_landing_url : r.url }));
  const b = Object.values(wm?.query?.pages || {}).sort((x, y) => (x.index || 0) - (y.index || 0))
    .map((p) => ({ info: (p.imageinfo || [])[0] || {}, title: p.title }))
    .filter((p) => /^image\/(jpeg|png|webp)$/.test(p.info.mime || "") && okUrl(p.info.thumburl))
    .map((p) => ({ url: p.info.thumburl, title: clean(p.title) || q, page: okUrl(p.info.descriptionurl) ? p.info.descriptionurl : p.info.thumburl }));
  // Take turns from each source so one bad source doesn't fill the list
  const out = web.slice(0, max), seen = new Set(out.map((r) => r.url));
  for (let i = 0; out.length < max && (i < a.length || i < b.length); i++) {
    for (const r of [a[i], b[i]]) if (r && !seen.has(r.url) && out.length < max) { seen.add(r.url); out.push(r); }
  }
  return out;
}
export function imageRules(ask, found) {
  if (!found.length) return `The person asked to see pictures of "${ask.q}", but the picture search found nothing this time. Say so in one short line and answer the rest. Never make up a picture address.`;
  return `The person asked to see pictures of "${ask.q}". A picture search found these real ones online:\n` +
    found.map((r, i) => `${i + 1}. ![${r.title}](${r.url})`).join("\n") +
    `\nShow ${ask.n} of them (the ones that best match what they asked for) by copying those Markdown lines exactly, each on its own line, then a short friendly sentence. ` +
    "Use only these addresses; never change or make up a picture address. If none match, say you couldn't find good pictures this time.";
}
