/* =============================================================================
   /api/inquiries — the leads themselves, for the dashboard.

   GET  ?limit=50&all=1   newest first. Without `all` only the unhandled ones.
   POST {id, handled}     tick one off, or put it back.

   Both are session-gated. The POST needs no CSRF token of its own: the session
   cookie is SameSite=Strict, so it is never attached to a request that started
   on another site, which is the thing a token would be defending against.

   Everything here is the visitor's own words. Nothing in this file builds HTML
   — the dashboard renders every field with textContent — and every query is
   parameterised.
   ============================================================================= */
import { requireSession, json } from '../_lib/auth.js';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function onRequestGet({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);

  const url = new URL(request.url);
  const asked = Number.parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Math.max(Number.isFinite(asked) ? asked : DEFAULT_LIMIT, 1), MAX_LIMIT);
  const all = url.searchParams.get('all') === '1';

  const where = all ? '' : 'WHERE handled = 0';
  try {
    const [rows, counts] = await env.DB.batch([
      env.DB.prepare(
        `SELECT id, ts, first_name, last_name, email, phone, interest, plan,
                move_in, source, message, country, notified, handled
           FROM inquiries ${where}
          ORDER BY ts DESC
          LIMIT ?`,
      ).bind(limit),
      env.DB.prepare(
        `SELECT COUNT(*)                         AS total,
                SUM(handled = 0)                 AS open,
                SUM(notified = 0)                AS unnotified,
                (SELECT notify_err FROM inquiries
                  WHERE notified = 0 AND notify_err IS NOT NULL
                  ORDER BY ts DESC LIMIT 1)      AS last_error
           FROM inquiries`,
      ),
    ]);
    const c = (counts.results && counts.results[0]) || {};
    return json({
      inquiries: rows.results || [],
      total: c.total || 0,
      open: c.open || 0,
      // How many leads arrived without the notification email going out. The
      // dashboard turns this into a banner: it is the only place anyone finds
      // out that email delivery is misconfigured, because the visitor's side
      // looks identical either way.
      unnotified: c.unnotified || 0,
      // The provider's own sentence, so the banner can name the fix instead of
      // just reporting that something went wrong.
      lastError: c.last_error || null,
    });
  } catch (err) {
    return json({ error: 'Could not read the enquiries.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON.' }, 400); }

  const id = Number.parseInt(body.id, 10);
  if (!Number.isInteger(id) || id < 1) return json({ error: 'Which enquiry?' }, 400);
  const handled = body.handled ? 1 : 0;

  try {
    const res = await env.DB.prepare('UPDATE inquiries SET handled = ? WHERE id = ?')
      .bind(handled, id).run();
    if (!res.meta || res.meta.changes === 0) return json({ error: 'No such enquiry.' }, 404);
  } catch {
    return json({ error: 'Could not update it.' }, 500);
  }
  return json({ ok: true, id, handled });
}
