/* GET /api/form-token — the token the contact and tour forms send with their post: when
   the page loaded, signed (functions/_lib/spam.js). Never cached: each page gets its own. */
import { issueToken } from '../_lib/spam.js';

export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({ token: await issueToken(env.SESSION_SECRET || '') }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
