/* =============================================================================
   /api/pl — Rent Manager accounting, for Evolution24's P&L Google Sheet.

   Only for the sheet's script, which sends PL_SHEET_TOKEN as
   "Authorization: Bearer <token>". Without that secret set, it is closed.

   GET ?check   sign in with the accounting login and record what Rent Manager
                offers: properties, the chart of accounts, and which accounting
                resources answer (see functions/_lib/rm-accounting.js). The
                last answer is reused if it is under a minute old, since Rent
                Manager limits calls per hour for the whole company.
   GET          the last check, without calling Rent Manager.
   ============================================================================= */
import { json } from '../_lib/auth.js';
import { acctConfigured, accountingCheck, lastCheck } from '../_lib/rm-accounting.js';

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** True when the request carries the sheet's token. Compared as hashes, in constant time. */
export async function sheetAllowed(request, env) {
  const want = String(env.PL_SHEET_TOKEN || '');
  if (want.length < 24) return false;
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m) return false;
  const [a, b] = await Promise.all([digest(m[1].trim()), digest(want)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  if (!env.PL_SHEET_TOKEN) return json({ error: 'Not set up: add PL_SHEET_TOKEN as a secret on the Worker in Cloudflare.' }, 503);
  if (!(await sheetAllowed(request, env))) return json({ error: 'Not allowed.' }, 401);
  if (!env.DB) return json({ error: 'No database bound.' }, 503);
  const url = new URL(request.url);

  if (!url.searchParams.has('check')) {
    const last = await lastCheck(env);
    return last ? json(last) : json({ error: 'No connection check yet.' }, 404);
  }
  if (!acctConfigured(env)) {
    return json({ error: 'Add RM_ACCT_USERNAME and RM_ACCT_PASSWORD as secrets on the Worker in Cloudflare first.' }, 503);
  }
  const last = await lastCheck(env);
  if (last && Date.now() / 1000 - last.ts < 60) return json({ ...last, note: 'Checked less than a minute ago, so Rent Manager was not asked again.' });
  try {
    return json(await accountingCheck(env));
  } catch (err) {
    return json({ error: err.message, code: err.status || 0 }, 502);
  }
}
