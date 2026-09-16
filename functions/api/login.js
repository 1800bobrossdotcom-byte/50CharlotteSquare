/* =============================================================================
   POST /api/login  — exchange the admin password for a signed session cookie.

   Throttled in D1 by IP. The password is never compared to a literal; it is run
   through PBKDF2 and checked against a hash held in a Cloudflare secret, so the
   repository never contains anything that grants access.
   ============================================================================= */
import { verifyPassword, issueSession, sessionCookie, json } from '../_lib/auth.js';

const MAX_FAILS = 6;
const LOCK_SECONDS = 15 * 60;

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) {
    return json({ error: 'Admin access is not configured on this deployment.' }, 503);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const now = Math.floor(Date.now() / 1000);

  // Throttle first, so a locked-out client never reaches the hashing work.
  let row = null;
  if (env.DB) {
    row = await env.DB.prepare('SELECT fails, until FROM login_attempts WHERE ip = ?')
      .bind(ip).first();
    if (row && row.until > now) {
      return json(
        { error: 'Too many attempts. Try again in a few minutes.' },
        429, { 'Retry-After': String(row.until - now) },
      );
    }
  }

  let password = '';
  try { password = String((await request.json()).password || ''); } catch { /* empty */ }

  const ok = password ? await verifyPassword(password, env.ADMIN_PASSWORD_HASH) : false;

  if (!ok) {
    if (env.DB) {
      const fails = (row ? row.fails : 0) + 1;
      const until = fails >= MAX_FAILS ? now + LOCK_SECONDS : 0;
      await env.DB.prepare(
        `INSERT INTO login_attempts (ip, fails, until) VALUES (?, ?, ?)
         ON CONFLICT(ip) DO UPDATE SET fails = excluded.fails, until = excluded.until`,
      ).bind(ip, fails, until).run();
    }
    // One message for every failure mode, so nothing is learned from the wording.
    return json({ error: 'That password is not right.' }, 401);
  }

  if (env.DB) await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();

  return json({ ok: true }, 200, {
    'Set-Cookie': sessionCookie(await issueSession(env.SESSION_SECRET), 12 * 3600),
  });
}
