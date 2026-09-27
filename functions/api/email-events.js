/* =============================================================================
   POST /api/email-events — Resend's delivery reports, by webhook.

   Resend posts one event per change: delivered, delayed, bounced, marked as
   spam, and opened or clicked if tracking is switched on for the domain. Each
   names the email by the id Resend gave it when it was sent, which the emails
   log kept, so the event just stamps that row. The dashboard and the reports
   count from there: totals, never a person.

   A spam complaint also unsubscribes the address, so the site never writes to
   someone who has said they don't want it.

   Resend signs every event (the Svix scheme): an HMAC-SHA256 of
   "<svix-id>.<svix-timestamp>.<body>", keyed with the endpoint's signing
   secret, which goes in RESEND_WEBHOOK_SECRET ("whsec_…"). Anything unsigned,
   wrongly signed or more than five minutes old is refused. Without the secret
   the endpoint takes nothing at all.
   ============================================================================= */
import { json } from '../_lib/auth.js';

const STAMP = {
  'email.delivered': 'delivered_at',
  'email.delivery_delayed': 'delayed_at',
  'email.bounced': 'bounced_at',
  'email.complained': 'complained_at',
  'email.opened': 'opened_at',
  'email.clicked': 'clicked_at',
};

const TOLERANCE = 5 * 60;   // seconds either side of now

/** Equal-length strings compared without an early exit. */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verify(secret, id, timestamp, body, header, now = Math.floor(Date.now() / 1000)) {
  if (!secret || !id || !timestamp || !header) return false;
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > TOLERANCE) return false;
  let raw;
  try {
    raw = Uint8Array.from(atob(String(secret).replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  const expected = btoa(String.fromCharCode(...mac));
  // "v1,<sig> v1,<sig>": more than one while a secret is being rotated.
  return String(header).split(' ').some((part) => {
    const [version, sig] = part.split(',');
    return version === 'v1' && same(sig, expected);
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_WEBHOOK_SECRET) return json({ error: 'Not configured.' }, 503);
  const body = await request.text();
  const ok = await verify(
    env.RESEND_WEBHOOK_SECRET,
    request.headers.get('svix-id'),
    request.headers.get('svix-timestamp'),
    body,
    request.headers.get('svix-signature'),
  );
  if (!ok) return json({ error: 'Bad signature.' }, 401);

  let event;
  try { event = JSON.parse(body); } catch { return json({ error: 'Bad JSON.' }, 400); }
  const column = STAMP[event && event.type];
  const emailId = event && event.data && event.data.email_id;
  // Anything else Resend reports (sent, and whatever it adds later) is fine to
  // receive and has nothing to stamp. 200, so it is not sent again.
  if (!column || !emailId || !env.DB) return json({ ok: true, ignored: true });

  const when = Math.floor((Date.parse(event.created_at) || Date.now()) / 1000);
  try {
    // First time only: a second open or a retried delivery report changes nothing.
    await env.DB.prepare(`UPDATE emails SET ${column} = COALESCE(${column}, ?) WHERE resend_id = ?`)
      .bind(when, String(emailId)).run();

    if (event.type === 'email.complained') {
      const to = Array.isArray(event.data.to) ? event.data.to : [event.data.to];
      for (const address of to.filter(Boolean)) {
        await env.DB.prepare(
          'UPDATE email_prefs SET unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE email = ?',
        ).bind(when, String(address).trim().toLowerCase()).run();
      }
    }
  } catch {
    // 500 makes Resend try again later, which is what we want for a hiccup.
    return json({ error: 'Could not record it.' }, 500);
  }
  return json({ ok: true });
}
