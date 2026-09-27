/* =============================================================================
   /unsubscribe/<token> — the link at the foot of every email the site sends.

   GET shows a page with one button; it never unsubscribes on its own, because
   mail scanners open every link in an email to check it, and a scanner must
   not be able to unsubscribe anyone. POST does it: from that button, or from
   the mail app's own Unsubscribe button (one-click, RFC 8058), which posts
   "List-Unsubscribe=One-Click" to this same address with no page in between.

   The token is random and belongs to one address in email_prefs; the address
   is never in the link. An unknown token gets a page that says so, and how to
   stop emails anyway.
   ============================================================================= */
const PHONE = '(585) 748-5588';
const PHONE_TEL = '+15857485588';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  // The link is the key to someone's preference; it is not passed on.
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "p•••@gmail.com": enough to recognise, not enough to harvest. */
const masked = (email) => {
  const [user, domain] = String(email).split('@');
  return domain ? `${user.slice(0, 1)}•••@${domain}` : 'your address';
};

function page(status, title, body) {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Charlotte Square</title>
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<link rel="stylesheet" href="/assets/css/unsubscribe.css">
</head>
<body>
<main class="unsub">
  <a class="unsub__brand" href="/"><img src="/assets/img/email/mark.png" width="40" height="40" alt=""><span>Charlotte <i>Square</i><small>At the East End</small></span></a>
  ${body}
</main>
</body>
</html>`, { status, headers: HEADERS });
}

const unknown = () => page(404, 'Link not recognised', `
  <h1>This link doesn’t work.</h1>
  <p>It may have been copied incompletely. To stop emails from us anyway, call <a href="tel:${PHONE_TEL}">${PHONE}</a> and we’ll take care of it.</p>`);

const done = (email) => page(200, 'Unsubscribed', `
  <h1>You’re unsubscribed.</h1>
  <p>We won’t send any more emails to ${esc(masked(email))} from this website.</p>
  <p>If you still want to hear about a home at Charlotte Square, call <a href="tel:${PHONE_TEL}">${PHONE}</a>.</p>
  <p class="unsub__back"><a href="/">Back to Charlotte Square</a></p>`);

async function lookup(env, token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token) || !env.DB) return null;
  try {
    return await env.DB.prepare('SELECT email, unsubscribed_at FROM email_prefs WHERE token = ?').bind(token).first();
  } catch {
    return null;   // no table yet
  }
}

export async function onRequestGet({ params, env }) {
  const token = String(params.token || '');
  const row = await lookup(env, token);
  if (!row) return unknown();
  if (row.unsubscribed_at) return done(row.email);
  return page(200, 'Unsubscribe', `
  <h1>Stop emails from Charlotte Square?</h1>
  <p>We’ll stop sending emails to ${esc(masked(row.email))} from this website.</p>
  <form method="post" action="/unsubscribe/${esc(token)}"><button type="submit">Unsubscribe</button></form>
  <p class="unsub__small">Changed your mind? Just close this page.</p>`);
}

export async function onRequestPost({ params, env }) {
  const token = String(params.token || '');
  const row = await lookup(env, token);
  if (!row) return unknown();
  if (!row.unsubscribed_at) {
    try {
      await env.DB.prepare('UPDATE email_prefs SET unsubscribed_at = ? WHERE token = ? AND unsubscribed_at IS NULL')
        .bind(Math.floor(Date.now() / 1000), token).run();
    } catch {
      return page(503, 'Try again', `
  <h1>That didn’t go through.</h1>
  <p>Please try again in a minute, or call <a href="tel:${PHONE_TEL}">${PHONE}</a> and we’ll take care of it.</p>`);
    }
  }
  return done(row.email);
}
