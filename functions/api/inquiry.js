/* =============================================================================
   POST /api/inquiry — take one contact-form submission.

   The order here is the whole design: the row goes into D1 first, and the D1
   write is what decides whether the visitor is told it worked. Only then is a
   notification email attempted. An email provider that is not set up yet, is
   rate-limited, or is having a bad night costs a notification — never a lead.
   Everything is still in the table and still in /admin/.

   Secrets, all set with `wrangler pages secret put ... --project=charlotte-square`:
     LEAD_TO          where notifications go, e.g. a leasing inbox
     LEAD_FROM        the From: address, on a domain verified with the provider
     RESEND_API_KEY   optional. With no key the endpoint still stores the lead.

   LEAD_TO is a secret rather than a data-email="" attribute on purpose. In the
   attribute it sat in the page source of every contact page, which is the first
   place an address harvester looks.
   ============================================================================= */
import { json, today } from '../_lib/auth.js';

/* Submissions per IP per window. High enough that a couple sent in earnest, or
   a shared office NAT, never trips it; low enough to be useless to a script. */
const MAX_PER_WINDOW = 5;
const WINDOW_SECONDS = 10 * 60;

/* The selects on the form. Anything not on these lists is dropped rather than
   stored, so the column cannot be used to smuggle text in through a picker. */
const INTERESTS = new Set(['tour', 'availability', 'pricing', 'question']);
const PLANS = new Set(['1', '2', '3']);
const SOURCES = new Set(['search', 'listing', 'social', 'walkby', 'referral']);

const LIMITS = {
  first_name: 80, last_name: 80, email: 160, phone: 40,
  move_in: 7, message: 4000,
};

const clean = (v, n) => {
  if (typeof v !== 'string') return null;
  // Strip control characters: they do nothing in an email body but can be used
  // to fake headers or hide text in the dashboard.
  const s = v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n);
  return s || null;
};

/* Deliberately permissive. This is to catch a typo, not to adjudicate RFC 5322,
   and a real address that a clever regex rejects is a lost lead. */
const looksLikeEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const LABEL = {
  tour: 'Scheduling a tour', availability: 'Current availability',
  pricing: 'Pricing and lease terms', question: 'A general question',
  1: 'One bedroom', 2: 'Two bedroom', 3: 'Three bedroom',
  search: 'Search', listing: 'Apartment listing site', social: 'Social media',
  walkby: 'Walked by', referral: 'Friend or resident', website: 'Website',
};
const label = (v) => (v && LABEL[v]) || v || '—';

/** Sliding-window throttle. Missing table or DB fails open: a throttle that
 *  cannot be read must not become an outage on the one form that earns money. */
async function overLimit(env, ip, now) {
  if (!env.DB) return false;
  try {
    const row = await env.DB.prepare(
      'SELECT count, window FROM inquiry_attempts WHERE ip = ?',
    ).bind(ip).first();

    if (!row || now - row.window >= WINDOW_SECONDS) {
      await env.DB.prepare(
        `INSERT INTO inquiry_attempts (ip, count, window) VALUES (?, 1, ?)
         ON CONFLICT(ip) DO UPDATE SET count = 1, window = excluded.window`,
      ).bind(ip, now).run();
      return false;
    }
    if (row.count >= MAX_PER_WINDOW) return true;
    await env.DB.prepare('UPDATE inquiry_attempts SET count = count + 1 WHERE ip = ?')
      .bind(ip).run();
    return false;
  } catch {
    return false;
  }
}

/** Returns true only when the provider accepted the message. */
async function notify(env, row, origin) {
  const key = env.RESEND_API_KEY;
  const to = env.LEAD_TO;
  if (!key || !to) return false;

  const who = `${row.first_name} ${row.last_name}`.trim();
  const line = (k, v) => `<tr><td style="padding:4px 14px 4px 0;color:#6b6b6b">${k}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`;

  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">
<p style="margin:0 0 4px"><strong>New inquiry from the Charlotte Square website</strong></p>
<p style="margin:0 0 16px;color:#6b6b6b">Reply to this email to answer ${esc(who)} directly.</p>
<table style="border-collapse:collapse;font-size:15px">
${line('Name', who)}
${line('Email', row.email)}
${line('Phone', row.phone || '—')}
${line('Interested in', label(row.interest))}
${line('Preferred home', label(row.plan))}
${line('Target move-in', row.move_in || '—')}
${line('Heard about us', label(row.source))}
</table>
${row.message ? `<p style="margin:16px 0 4px;color:#6b6b6b">Message</p><p style="margin:0;white-space:pre-wrap">${esc(row.message)}</p>` : ''}
<p style="margin:20px 0 0;font-size:13px;color:#8a8a8a">Inquiry #${row.id} · also saved at ${esc(origin)}/admin/</p>
</div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.LEAD_FROM || 'Charlotte Square <onboarding@resend.dev>',
        to: [to],
        // So hitting reply in Gmail answers the prospect, not the robot.
        reply_to: row.email,
        subject: `Charlotte Square inquiry — ${who}`,
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'Not configured.' }, 503);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Send the form as form data.' }, 400);
  }

  // The honeypot. main.js deletes this field before posting, so anything that
  // arrives with it filled in did not come from the form.
  if (clean(form.get('website'), 200)) return json({ ok: true }, 202);

  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  if (await overLimit(env, ip, now)) {
    return json({ error: 'Too many messages from this connection. Please call us instead.' }, 429);
  }

  const row = {
    first_name: clean(form.get('first_name'), LIMITS.first_name),
    last_name: clean(form.get('last_name'), LIMITS.last_name),
    email: clean(form.get('email'), LIMITS.email),
    phone: clean(form.get('phone'), LIMITS.phone),
    interest: INTERESTS.has(form.get('interest')) ? form.get('interest') : null,
    plan: PLANS.has(form.get('plan')) ? form.get('plan') : null,
    move_in: clean(form.get('move_in'), LIMITS.move_in),
    source: SOURCES.has(form.get('source')) ? form.get('source') : null,
    message: clean(form.get('message'), LIMITS.message),
  };

  if (!row.first_name || !row.last_name || !looksLikeEmail(row.email)) {
    return json({ error: 'Please check your name and email address.' }, 400);
  }

  let id;
  try {
    const res = await env.DB.prepare(
      `INSERT INTO inquiries
         (ts, day, first_name, last_name, email, phone, interest, plan, move_in, source, message, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      now, today(new Date()),
      row.first_name, row.last_name, row.email, row.phone,
      row.interest, row.plan, row.move_in, row.source, row.message,
      (request.cf && request.cf.country) || null,
    ).run();
    id = res.meta && res.meta.last_row_id;
  } catch {
    // The one genuine failure: nothing was stored, so do not tell the visitor
    // it arrived. The form shows the phone number when this comes back.
    return json({ error: 'We could not save your message. Please call us.' }, 500);
  }

  const sent = await notify(env, { ...row, id }, new URL(request.url).origin);
  if (sent) {
    try {
      await env.DB.prepare('UPDATE inquiries SET notified = 1 WHERE id = ?').bind(id).run();
    } catch { /* stored and sent; the flag is bookkeeping */ }
  }

  // 202 either way: the lead is safe. `notified` tells /admin/ whether the
  // email also went, which is what the dashboard's warning banner reads.
  return json({ ok: true, notified: sent }, 202);
}

// No generic onRequest export: in Pages Functions it takes over every method
// and the method-specific handler above stops being called.
