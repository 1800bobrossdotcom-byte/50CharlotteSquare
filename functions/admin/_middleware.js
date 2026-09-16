/* =============================================================================
   Gate for /admin/*.

   Scoped to this path on purpose. A root functions/_middleware.js would run on
   every request to the site, which turns every cached static page into a
   Function invocation — a real cost on a site tuned for a fast first paint.

   Without a valid session the dashboard HTML is never served at all. The page
   is not merely hidden; the bytes do not leave Cloudflare. That is the part a
   client-side gate can never do.
   ============================================================================= */
import { verifySession, readCookie, COOKIE } from '../_lib/auth.js';

// Served in place of the dashboard. Self-contained, because the visitor has no
// session and there is nothing to lay out yet.
const LOGIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Charlotte Square</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/admin.css">
</head>
<body class="signin">
  <main class="signin__card">
    <svg class="signin__mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" fill="#A93B3F"/>
      <path d="M9 9 H55 V27 H45 V19 H19 V45 H55 V55 H9 Z" fill="#fff"/>
    </svg>
    <h1>Charlotte Square</h1>
    <p class="signin__sub">Analytics</p>
    <form id="signin-form" autocomplete="on">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Sign in</button>
      <p class="signin__msg" id="signin-msg" role="status" aria-live="polite"></p>
    </form>
  </main>
  <script src="/assets/js/signin.js" defer></script>
</body>
</html>
`;

export async function onRequest({ request, next, env }) {
  const ok = await verifySession(readCookie(request, COOKIE), env.SESSION_SECRET || '');
  if (ok) return next();

  return new Response(LOGIN_PAGE, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
