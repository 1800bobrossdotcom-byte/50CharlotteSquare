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
import { aiEnabled } from '../_lib/ai.js';
import { notify } from './inquiry.js';
import { logEmail } from '../_lib/email.js';

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
  const list = (extra) => env.DB.prepare(
    `SELECT id, ts, first_name, last_name, email, phone, interest, plan,
            move_in, source, message, country, notified, handled${extra}
       FROM inquiries ${where}
      ORDER BY ts DESC
      LIMIT ?`,
  ).bind(limit);

  // A database from before campaign tracking and Claude has none of the newer
  // columns, and one from before confirmation emails none of their tables. Ask
  // for everything, and on failure step back to less rather than showing no
  // leads at all.
  const NEWER = `, form, variant, utm_source, utm_medium, utm_campaign,
            referrer, landing, ai, ai_err`;
  const MAIL = `,
            (SELECT unsubscribed_at FROM email_prefs p WHERE p.email = lower(inquiries.email)) AS unsubscribed_at,
            (SELECT sent FROM emails m WHERE m.inquiry_id = inquiries.id AND m.kind = 'confirmation'
              ORDER BY m.id DESC LIMIT 1) AS confirm_ok,
            (SELECT COALESCE(note, reason) FROM emails m WHERE m.inquiry_id = inquiries.id AND m.kind = 'confirmation'
              ORDER BY m.id DESC LIMIT 1) AS confirm_note,
            (SELECT CASE WHEN complained_at IS NOT NULL THEN 'marked as spam'
                         WHEN bounced_at IS NOT NULL THEN 'bounced'
                         WHEN delivered_at IS NOT NULL THEN 'delivered' END
               FROM emails m WHERE m.inquiry_id = inquiries.id AND m.kind = 'confirmation'
              ORDER BY m.id DESC LIMIT 1) AS confirm_status`;
  let rows;
  for (const extra of [NEWER + MAIL, NEWER, '']) {
    try { rows = await list(extra).all(); break; } catch { /* try with less */ }
  }
  if (!rows) return json({ error: 'Could not read the enquiries.' }, 500);

  try {
    const c = (await env.DB.prepare(
      `SELECT COUNT(*)                         AS total,
              SUM(handled = 0)                 AS open,
              SUM(notified = 0 AND handled = 0) AS unnotified,
              (SELECT notify_err FROM inquiries
                WHERE notified = 0 AND handled = 0 AND notify_err IS NOT NULL
                ORDER BY ts DESC LIMIT 1)      AS last_error
         FROM inquiries`,
    ).first()) || {};
    return json({
      // ai is stored as JSON text; hand it over parsed so the page never has to.
      inquiries: (rows.results || []).map((r) => {
        if (typeof r.ai !== 'string') return r;
        try { return { ...r, ai: JSON.parse(r.ai) }; } catch { return { ...r, ai: null }; }
      }),
      total: c.total || 0,
      open: c.open || 0,
      // How many open leads arrived without the notification email going out
      // (one someone has marked handled no longer needs it). The dashboard
      // turns this into a banner: it is the only place anyone finds
      // out that email delivery is misconfigured, because the visitor's side
      // looks identical either way.
      unnotified: c.unnotified || 0,
      // The provider's own sentence, so the banner can name the fix instead of
      // just reporting that something went wrong.
      lastError: c.last_error || null,
      // Whether the dashboard should offer Claude's summaries at all.
      ai: aiEnabled(env),
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

  // {id, notify: true}: send the notification email for an enquiry that went
  // without one, e.g. once RESEND_API_KEY is in place. Doubles as the test
  // that email works. Never sends twice for the same enquiry.
  if (body.notify) {
    let row;
    try {
      row = await env.DB.prepare('SELECT * FROM inquiries WHERE id = ?').bind(id).first();
    } catch {
      return json({ error: 'Could not read it.' }, 500);
    }
    if (!row) return json({ error: 'No such enquiry.' }, 404);
    if (row.notified) return json({ ok: true, id, already: true });
    const sent = await notify(env, row, new URL(request.url).origin);
    await logEmail(env, 'notification', id, sent);
    try {
      await env.DB.prepare('UPDATE inquiries SET notified = ?, notify_err = ? WHERE id = ?')
        .bind(sent.ok ? 1 : 0, sent.ok ? null : (sent.error || 'Unknown error'), id).run();
    } catch { /* the answer below still says what happened */ }
    return sent.ok ? json({ ok: true, id }) : json({ ok: false, id, error: sent.error || 'Unknown error' }, 502);
  }

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
