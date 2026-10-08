// Rough cost of one reply, in US cents, so the admin panel can show about how much Orbs is spending.
// Prices are per million tokens (from Anthropic's pricing page). The Claude Console has the real bill.
export const PRICES = {
  haiku:  { in: 1,  out: 5,  cacheRead: 0.1 },      // Haiku 4.5 and older
  haiku55:     { in: 0.1, out: 0.5, cacheRead: 0.1 }, // Haiku 5.5 and newer, prompts up to 100,000 tokens
  haiku55long: { in: 0.5, out: 2.5, cacheRead: 0.1 }, // Haiku 5.5, prompts over 100,000 tokens
  sonnet: { in: 2,  out: 10, cacheRead: 0.1 },
  opus:   { in: 4,  out: 20, cacheRead: 0.05 },
  fable:  { in: 10, out: 50, cacheRead: 0.025 },
};
export const SEARCH_CENTS = 1; // $10 per 1,000 searches

export function familyOf(id) {
  const m = /^claude-(haiku|sonnet|opus|fable)/.exec(String(id || ""));
  return m ? m[1] : "sonnet";
}

// u: { input, cacheWrite, cacheRead, output, searches }
export function costCents(modelId, u) {
  let p = PRICES[familyOf(modelId)];
  // Haiku 5.5+ is priced differently from older Haiku, and by prompt length
  const hv = /^claude-haiku-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(String(modelId || ""));
  if (hv && (Number(hv[1]) > 5 || (Number(hv[1]) === 5 && Number(hv[2] || 0) >= 5))) {
    const prompt = (Number(u.input) || 0) + (Number(u.cacheWrite) || 0) + (Number(u.cacheRead) || 0);
    p = prompt > 100000 ? PRICES.haiku55long : PRICES.haiku55;
  }
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const dollars =
    (n(u.input) * p.in + n(u.cacheWrite) * p.in * 1.25 + n(u.cacheRead) * p.in * p.cacheRead + n(u.output) * p.out) / 1e6;
  return dollars * 100 + n(u.searches) * SEARCH_CENTS;
}
