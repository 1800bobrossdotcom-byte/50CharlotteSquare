/* =============================================================================
   /api/inquiries — the leads themselves, for the dashboard.

   GET  ?limit=50&all=1   newest first. Without `all` only the unhandled ones.
                          Also `held`: the last month's held as spam (_lib/spam.js).
   POST {id, handled}     tick one off, or put it back.
   POST {held, release}   one held as spam was a person: make it an enquiry and
                          send it on, as if it had never been held.
   POST {held, discard}   delete one held as spam now.

   Both are session-gated. The POST needs no CSRF token of its own: the session
   cookie is SameSite=Strict, so it is never attached to a request that started
   on another site, which is the thing a token would be defending against.

   Everything here is the visitor's own words. Nothing in this file builds HTML
   — the dashboard renders every field with textContent — and every query is
   parameterised.
   ============================================================================= */
import { requireSession, json } from '../_lib/auth.js';
import { aiEnabled } from '../_lib/ai.js';
import { notify, deliver } from './inquiry.js';
import { HOLD_DAYS } from '../_lib/spam.js';

/** The last month's enquiries held as spam (_lib/spam.js), newest first: who, what and why. */
async function heldList(env) {
  try {
    const since = Math.floor(Date.now() / 1000) - HOLD_DAYS * 86400;
    const { results } = await env.DB.prepare('SELECT id, ts, score, reasons, data FROM held WHERE ts >= ? ORDER BY ts DESC LIMIT 100')
      .bind(since).all();
    return (results || []).map((h) => {
      let d = {};
      try { d = JSON.parse(h.data) || {}; } catch { /* shown with what there is */ }
      return { id: h.id, ts: h.ts, score: h.score, reasons: h.reasons || '', first_name: d.first_name || '', last_name: d.last_name || '',
        email: d.email || '', phone: d.phone || '', message: d.message || '', form: d.form || 'contact' };
    });
  } catch {
    return [];
  }
}
import { logEmail } from '../_lib/email.js';
import { sheetEnabled, sheetAndRecord } from '../_lib/sheet.js';
import { confirmAndRecord } from '../_lib/confirm.js';

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
              ORDER BY m.id DESC LIMIT 1) AS confirm_status,
            (SELECT ok FROM lead_sync s WHERE s.inquiry_id = inquiries.id) AS sheet_ok,
            (SELECT note FROM lead_sync s WHERE s.inquiry_id = inquiries.id) AS sheet_note`;
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
    const held = await heldList(env);
    return json({
      // Held as spam: never emailed or counted; listed so a person caught by mistake is not lost.
      held,
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
      // Whether a Google Sheet is connected, so cards say if each lead is in it.
      sheet: sheetEnabled(env),
    });
  } catch (err) {
    return json({ error: 'Could not read the enquiries.' }, 500);
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON.' }, 400); }

  if (body && body.held) {
    const hid = Number.parseInt(body.held, 10);
    if (!Number.isInteger(hid) || hid < 1) return json({ error: 'Which one?' }, 400);
    let rec = null;
    try {
      rec = await env.DB.prepare('SELECT id, data FROM held WHERE id = ?').bind(hid).first();
    } catch { /* answered below */ }
    if (!rec) return json({ error: 'It is not held any more.' }, 404);
    if (body.discard) {
      await env.DB.prepare('DELETE FROM held WHERE id = ?').bind(hid).run();
      return json({ ok: true });
    }
    if (!body.release) return json({ error: 'Send it on, or delete it?' }, 400);
    let row;
    try { row = JSON.parse(rec.data); } catch { return json({ error: 'It could not be read.' }, 500); }
    const { ts, country, ...fields } = row;
    const out = await deliver(env, fields, { ts: ts || Math.floor(Date.now() / 1000), country, origin: new URL(request.url).origin, waitUntil });
    if (!out.ok) return json({ error: 'It could not be saved as an enquiry. Try again in a minute.' }, 502);
    try { await env.DB.prepare('DELETE FROM held WHERE id = ?').bind(hid).run(); } catch { /* sent on either way */ }
    return json({ ok: true, id: out.id, notified: out.notified });
  }

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

  // {id, confirm: true}: send the visitor their branded confirmation now,
  // e.g. for an enquiry from before it existed, or one they say never came.
  // Skips the 12-hour gap; never goes to an address that has unsubscribed.
  if (body.confirm) {
    let row;
    try {
      row = await env.DB.prepare('SELECT * FROM inquiries WHERE id = ?').bind(id).first();
    } catch {
      return json({ error: 'Could not read it.' }, 500);
    }
    if (!row) return json({ error: 'No such enquiry.' }, 404);
    const sent = await confirmAndRecord(env, row, new URL(request.url).origin, { force: true });
    return sent.ok ? json({ ok: true, id }) : json({ ok: false, id, error: sent.note || 'Not sent.' }, 502);
  }

  // {id, sheet: true}: add the enquiry to the leasing team's Google Sheet,
  // e.g. one from before the sheet was connected, or after a hiccup. The
  // sheet itself keeps one row per enquiry, so pressing twice is harmless.
  if (body.sheet) {
    if (!sheetEnabled(env)) return json({ error: 'The lead sheet is not connected.' }, 503);
    let row;
    try {
      row = await env.DB.prepare('SELECT * FROM inquiries WHERE id = ?').bind(id).first();
    } catch {
      return json({ error: 'Could not read it.' }, 500);
    }
    if (!row) return json({ error: 'No such enquiry.' }, 404);
    const sent = await sheetAndRecord(env, row);
    return sent.ok ? json({ ok: true, id }) : json({ ok: false, id, error: sent.note }, 502);
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
