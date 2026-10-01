// Keeps each Orbs model on the newest Claude model in its family, and works out its Orbs version.
// Version rule: every newer Claude release bumps the version by .01 (1.01, 1.02 ... 1.07), then the
// next one starts a new generation (2.01). Versions come from counting releases newer than the
// starting point below, so they stay the same on every server and never go backwards.

export const FAMILIES = [
  { family: "haiku",  name: "Koa",       start: [4, 5], startStep: 0, fallback: { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",  effort: false } },
  { family: "sonnet", name: "Lumina",    start: [5, 5], startStep: 1, fallback: { id: "claude-sonnet-5-5",         label: "Claude Sonnet 5.5", effort: true } },
  { family: "opus",   name: "Chrysalis", start: [5, 5], startStep: 1, fallback: { id: "claude-opus-5-5",           label: "Claude Opus 5.5",   effort: true } },
  { family: "fable",  name: "Mythos",    start: [5, 1], startStep: 1, fallback: { id: "claude-fable-5-1",          label: "Claude Fable 5.1",  effort: true } },
];
const STEPS_PER_GEN = 7;

export function orbVersion(step) {
  return `${Math.floor(step / STEPS_PER_GEN) + 1}.${String((step % STEPS_PER_GEN) + 1).padStart(2, "0")}`;
}

// "claude-sonnet-5-5" -> { family: "sonnet", ver: [5, 5] }; "claude-haiku-4-5-20251001" -> haiku [4, 5]; "claude-opus-5" -> opus [5]
export function parseId(id) {
  const m = /^claude-(haiku|sonnet|opus|fable)-(\d{1,2})(?:-(\d{1,2}))?(?:-(\d{8}))?$/.exec(String(id || ""));
  if (!m) return null;
  return { family: m[1], ver: m[3] !== undefined ? [Number(m[2]), Number(m[3])] : [Number(m[2])] };
}

function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

// list: Anthropic's model list. Returns one entry per family: { id, label, version, effort, maxTokens }
export function resolve(list) {
  return FAMILIES.map((f) => {
    const versions = new Map(); // "5.5" -> best model info for that version
    for (const m of Array.isArray(list) ? list : []) {
      const p = parseId(m && m.id);
      if (!p || p.family !== f.family || cmp(p.ver, f.start) < 0) continue;
      const key = p.ver.join(".");
      const prev = versions.get(key);
      // Same version listed twice (e.g. with and without a date): keep the newest one
      if (!prev || String(m.created_at || "") > String(prev.info.created_at || "")) versions.set(key, { ver: p.ver, info: m });
    }
    const sorted = [...versions.values()].sort((a, b) => cmp(a.ver, b.ver));
    const newest = sorted[sorted.length - 1];
    if (!newest) return { ...f.fallback, version: orbVersion(f.startStep), maxTokens: null };
    const newerThanStart = sorted.filter((v) => cmp(v.ver, f.start) > 0).length;
    const caps = newest.info.capabilities || {};
    const effort = caps.effort && typeof caps.effort.supported === "boolean" ? caps.effort.supported : f.fallback.effort;
    return {
      id: newest.info.id,
      label: newest.info.display_name || `Claude ${f.family[0].toUpperCase()}${f.family.slice(1)} ${newest.ver.join(".")}`,
      version: orbVersion(f.startStep + newerThanStart),
      effort,
      maxTokens: Number(newest.info.max_tokens) > 0 ? Number(newest.info.max_tokens) : null,
    };
  });
}

// Ask Anthropic which models exist, at most once an hour per server. Falls back to the starting models if that fails.
let cache = null;
export function _resetModelCache() { cache = null; }
export async function latestModels({ apiKey, fetchImpl = fetch, now = Date.now() }) {
  if (cache && now - cache.at < 60 * 60 * 1000) return cache.models;
  try {
    const all = [];
    let after = null;
    for (let page = 0; page < 5; page++) {
      const url = "https://api.anthropic.com/v1/models?limit=1000" + (after ? "&after_id=" + encodeURIComponent(after) : "");
      const res = await fetchImpl(url, { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } });
      if (!res.ok) throw new Error("models " + res.status);
      const j = await res.json();
      all.push(...(j.data || []));
      if (!j.has_more || !j.last_id) break;
      after = j.last_id;
    }
    const models = resolve(all);
    cache = { at: now, models };
    return models;
  } catch {
    // Don't cache failures for long: try again in 5 minutes
    const models = resolve([]);
    cache = { at: now - 55 * 60 * 1000, models };
    return models;
  }
}
