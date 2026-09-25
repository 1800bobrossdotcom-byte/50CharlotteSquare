/* =============================================================================
   /api/insights — Claude's plain-English read of the dashboard.

   GET  ?days=30          the saved read for this range today, or null. Free.
   POST {days, fresh}     ask Claude now; returns the saved one unless fresh.

   One read per date range per day is kept in D1, so opening the dashboard
   again, or on another phone, does not pay for the same answer twice. Only the
   aggregate numbers from _lib/stats.js are sent: no enquiry and no person.
   ============================================================================= */
import { requireSession, json } from '../_lib/auth.js';
import { loadStats } from '../_lib/stats.js';
import { aiEnabled, aiError, explainStats } from '../_lib/ai.js';

const daysFrom = (v) => {
  const n = Number.parseInt(v || '30', 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 30, 1), 365);
};
const keyFor = (days) => `${days}|${new Date().toISOString().slice(0, 10)}`;

async function saved(env, key) {
  try {
    const row = await env.DB.prepare('SELECT ts, body FROM insights WHERE key = ?').bind(key).first();
    return row ? { ...JSON.parse(row.body), ts: row.ts } : null;
  } catch {
    return null;   // no insights table yet
  }
}

export async function onRequestGet({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);
  const days = daysFrom(new URL(request.url).searchParams.get('days'));
  return json({ ai: aiEnabled(env), insight: await saved(env, keyFor(days)) });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);
  if (!aiEnabled(env)) return json({ error: 'Add ANTHROPIC_API_KEY to the Pages project to turn this on.' }, 503);

  let body = {};
  try { body = await request.json(); } catch { /* defaults */ }
  const days = daysFrom(String(body.days || ''));
  const key = keyFor(days);

  if (!body.fresh) {
    const hit = await saved(env, key);
    if (hit) return json({ insight: hit });
  }

  let insight;
  try {
    insight = await explainStats(env, await loadStats(env, days));
  } catch (err) {
    return json({ error: aiError(err) }, 502);
  }

  const ts = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(
      `INSERT INTO insights (key, ts, body) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, body = excluded.body`,
    ).bind(key, ts, JSON.stringify(insight)).run();
  } catch { /* shown either way; just not kept */ }

  return json({ insight: { ...insight, ts } });
}
