/* =============================================================================
   /tour/ — the A/B/C test of the booking page.

   Each visitor is shown one of three versions, picked by a hash of the day, the
   server salt, their IP and their user agent: the inputs of the analytics
   visitor hash, under a different prefix so the two values are unrelated. So
   there is no cookie, a visitor sees the same version on every reload that
   day, and the split settles near a third each once traffic arrives.

   The pick is stamped on <html data-variant>, which analytics.js sends with
   every event, and on the form's hidden variant field, which the enquiry keeps.
   /tour-a/, /tour-b/ and /tour-c/ carry no stamp, so opening one directly, or
   previewing here with ?v=b, is never counted in the test.
   ============================================================================= */
import { today } from '../_lib/auth.js';

const VARIANTS = ['a', 'b', 'c'];

async function pick(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const ua = request.headers.get('User-Agent') || '';
  const digest = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(`variant|${env.VISITOR_SALT || 'unset'}|${today()}|${ip}|${ua}`));
  return VARIANTS[new DataView(digest).getUint32(0) % VARIANTS.length];
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  // One address for the page, so /tour and /tour/ are one row in Pages.
  if (!url.pathname.endsWith('/')) return Response.redirect(`${url.origin}/tour/${url.search}`, 301);

  const preview = url.searchParams.get('v');
  const variant = VARIANTS.includes(preview) ? preview : await pick(request, env);

  const page = await env.ASSETS.fetch(new URL(`/tour-${variant}/`, url));
  if (!page.ok) return page;

  const stamped = preview ? page : new HTMLRewriter()
    .on('html', { element(el) { el.setAttribute('data-variant', variant); } })
    .on('input[name="variant"]', { element(el) { el.setAttribute('value', variant); } })
    .transform(page);

  // One visitor's version, so no shared cache may keep it for the next one.
  const res = new Response(stamped.body, stamped);
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

export const onRequestHead = onRequestGet;
