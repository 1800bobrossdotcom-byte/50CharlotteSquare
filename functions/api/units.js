/* =============================================================================
   /api/units — the open units at Charlotte Square, for the site's pages.

   GET   { updated, units: [{ id, unit, beds, baths, sqft, rent, available, apply }] }

   Public and read only. It reads the copy that the scheduled refresh keeps in
   D1, never Rent Manager itself, so a busy day costs no API calls. Empty until
   the list is switched on in the dashboard, or when the last good list is more
   than a day old; the pages then say "Ask about availability" as before.
   ============================================================================= */
import { json } from '../_lib/auth.js';
import { publicListing } from '../_lib/rentmanager.js';

export async function onRequestGet({ env }) {
  let body = { units: [] };
  if (env.DB) {
    try { body = await publicListing(env); } catch { /* the pages fall back */ }
  }
  // A few minutes at the edge: the list changes hourly at most.
  return json(body, 200, { 'Cache-Control': 'public, max-age=300' });
}
