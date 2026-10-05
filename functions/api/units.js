/* =============================================================================
   /api/units — the open units at Charlotte Square, for the site's pages.

   GET          { updated, units: [{ id, unit, beds, baths, sqft, rent, available, apply }],
                  live: { configured, published, at, ok, open, code } }
   GET ?fields  what a unit looks like, for two hours after a connection check

   Public and read only. It reads the copy that the scheduled refresh keeps in
   D1, never Rent Manager itself, so a busy day costs no API calls. Empty until
   the list is switched on in the dashboard, or when the last good list is more
   than a day old; the pages then say "Ask about availability" as before.
   ============================================================================= */
import { json } from '../_lib/auth.js';
import { publicListing, publicStatus, recentDiscovery, rediscoverIfStale } from '../_lib/rentmanager.js';

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.DB) return json({ units: [] });
  // A new way of reading Rent Manager runs its check once, in the background.
  if (waitUntil) waitUntil(rediscoverIfStale(env).catch(() => {}));
  const url = new URL(request.url);
  // ?fields: the field summary from a connection check in the last two hours.
  if (url.searchParams.has('fields')) {
    const d = await recentDiscovery(env).catch(() => null);
    return d ? json(d) : json({ error: 'No connection check in the last two hours.' }, 404);
  }
  let body = { units: [] };
  try { body = await publicListing(env); } catch { /* the pages fall back */ }
  try { body.live = await publicStatus(env); } catch { /* optional */ }
  // A few minutes at the edge: the list changes hourly at most.
  return json(body, 200, { 'Cache-Control': 'public, max-age=300' });
}
