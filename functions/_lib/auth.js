/* =============================================================================
   Shared auth helpers for the admin API.

   Everything here runs on the Workers runtime, so the only crypto available is
   WebCrypto — which is enough: PBKDF2 for the password, HMAC-SHA256 for the
   session cookie. No dependencies.

   Two secrets, both set with `wrangler pages secret put` and never in the repo:
     ADMIN_PASSWORD_HASH   pbkdf2$<iterations>$<salt b64>$<hash b64>
     SESSION_SECRET        long random string, signs the session cookie
   ============================================================================= */

const enc = new TextEncoder();

export const COOKIE = 'cs_admin';
const SESSION_HOURS = 12;

/* ---- base64url, because cookies and headers dislike + / = ----------------- */
const b64urlFromBytes = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const bytesFromB64 = (s) => {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/* ---- Constant time, so a wrong password cannot be found one byte at a time */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ---- Password -------------------------------------------------------------
   Stored as pbkdf2$<iterations>$<salt>$<hash>. The iteration count travels
   with the hash so it can be raised later without invalidating what exists. */
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return false;

  const iterations = Number.parseInt(iterStr, 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;

  const expected = bytesFromB64(hashB64);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytesFromB64(saltB64), iterations, hash: 'SHA-256' },
    key,
    expected.length * 8,
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

/* ---- Session cookie -------------------------------------------------------
   Value is "<expiry>.<hmac>". Nothing is stored server-side: the signature is
   what makes it unforgeable, and the expiry is inside the signed payload so it
   cannot be extended by editing the cookie. */
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

export async function issueSession(secret) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  const payload = String(exp);
  return `${payload}.${b64urlFromBytes(await hmac(payload, secret))}`;
}

export async function verifySession(token, secret) {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;

  const payload = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const exp = Number.parseInt(payload, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  let givenBytes;
  try { givenBytes = bytesFromB64(given); } catch { return false; }
  return timingSafeEqual(givenBytes, await hmac(payload, secret));
}

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(value, maxAge) {
  // HttpOnly so no script can read it; Strict so it never rides a cross-site
  // request; Secure because the site is HTTPS-only anyway.
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function requireSession(request, env) {
  const ok = await verifySession(readCookie(request, COOKIE), env.SESSION_SECRET || '');
  return ok ? null : json({ error: 'Not signed in.' }, 401);
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

/* ---- Visitor hash ---------------------------------------------------------
   Groups one person's hits within a single day, then becomes a different value
   at midnight. Not reversible to an IP, and not stable across days, so it is a
   counting aid rather than an identifier. */
export async function visitorHash(ip, ua, salt, day) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${day}|${salt}|${ip}|${ua}`));
  return b64urlFromBytes(new Uint8Array(digest)).slice(0, 22);
}

export const today = (d = new Date()) => d.toISOString().slice(0, 10);
