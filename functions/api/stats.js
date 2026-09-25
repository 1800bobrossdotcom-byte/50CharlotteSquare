/* =============================================================================
   GET /api/stats?days=30 — the whole dashboard payload, in one round trip.

   Session-gated. `days` is the only input and it is coerced to a bounded
   integer before it goes anywhere near SQL. The queries themselves live in
   _lib/stats.js, because /api/insights reads exactly the same numbers.
   ============================================================================= */
import { requireSession, json } from '../_lib/auth.js';
import { loadStats } from '../_lib/stats.js';
import { aiEnabled } from '../_lib/ai.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);

  const asked = Number.parseInt(new URL(request.url).searchParams.get('days') || '30', 10);
  const days = Math.min(Math.max(Number.isFinite(asked) ? asked : 30, 1), 365);

  return json({ ...(await loadStats(env, days)), ai: aiEnabled(env) });
}
