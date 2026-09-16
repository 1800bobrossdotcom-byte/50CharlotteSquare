/* POST /api/logout — clear the session cookie. */
import { sessionCookie, json } from '../_lib/auth.js';

export const onRequestPost = () =>
  json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
