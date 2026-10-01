// GET /api/models — tells the page which Claude model each Orbs model uses right now, and its Orbs version.
import { latestModels, FAMILIES } from "./_models.js";

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY;
  const live = key ? await latestModels({ apiKey: key }) : null;
  const models = FAMILIES.map((f, i) => {
    const m = live ? live[i] : { ...f.fallback, version: null };
    return { name: f.name, version: m.version, base: m.label, effort: m.effort };
  });
  return new Response(JSON.stringify({ models }), {
    headers: {
      "content-type": "application/json",
      // Vercel's CDN can reuse this for an hour so it's fast and cheap
      "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
