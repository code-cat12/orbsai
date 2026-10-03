// GET /api/season — is Halloween on right now? (the owner can force it on or off in the admin panel)
import { getConfig } from "./_admin.js";
import { siteConfig } from "./_core.js";
import { halloweenOn } from "./_orbs.js";

export async function GET() {
  let mode = "auto";
  try { mode = siteConfig(await getConfig()).halloween; } catch {}
  return new Response(JSON.stringify({ halloween: halloweenOn(mode) }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
  });
}
