/* =============================================================================
   POST /api/collect — record one pageview or named event.

   Open by design: it is how the site reports itself. What keeps it honest is
   that it stores nothing personal, writes only a fixed set of columns, and
   caps everything it is handed.
   ============================================================================= */
import { visitorHash, today, json } from '../_lib/auth.js';

const KINDS = new Set([
  'pageview', 'tour_request', 'phone_click', 'portal_click',
  'plan_view', 'gallery_open', 'map_click', 'outbound', 'form_start',
]);

const DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const STYLES = new Set(['brick', 'gallery', 'atelier', 'dusk']);
const VARIANTS = new Set(['a', 'b', 'c']);

/** A campaign tag, folded to one spelling so "Facebook", "facebook " and
 *  "FACEBOOK" land in one row, and stripped to characters a tag needs. Whoever
 *  wrote the link chose the text, so it is capped and never trusted as more. */
const tag = (v) => {
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '').slice(0, 60);
  return s || null;
};

/** Referrers are reduced to a host. The full URL can carry search terms and
 *  session tokens, and none of that is wanted here. The link-shim and mobile
 *  prefixes go too, so l.facebook.com and m.facebook.com count as one source. */
function refHost(ref, selfHost) {
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.replace(/^(www|m|l|lm|mobile)\./, '');
    return host === selfHost.replace(/^www\./, '') ? null : host.slice(0, 120);
  } catch { return null; }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'No database bound.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON.' }, 400); }

  const kind = KINDS.has(body.kind) ? body.kind : 'pageview';

  // Path comes from the browser, so treat it as a claim: keep the pathname and
  // drop query and hash, which is where campaign junk and PII turn up.
  let path = '/';
  try { path = new URL(body.path || '/', 'https://x.invalid').pathname.slice(0, 255); } catch { /* keep '/' */ }

  const now = new Date();
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const ua = request.headers.get('User-Agent') || '';
  const day = today(now);

  const visitor = await visitorHash(ip, ua, env.VISITOR_SALT || 'unset', day);

  // meta is free-form event detail (which floor plan, which gallery image).
  // Bounded hard so nobody can use the events table as free storage.
  let meta = null;
  if (body.meta && typeof body.meta === 'object') {
    const s = JSON.stringify(body.meta);
    if (s.length <= 300) meta = s;
  }

  // Campaign tags are only meaningful on the page they landed on.
  const utm = kind === 'pageview' && body.utm && typeof body.utm === 'object' ? body.utm : {};

  try {
    await env.DB.prepare(
      `INSERT INTO events (ts, day, kind, path, ref, country, device, style, meta, visitor,
                           utm_source, utm_medium, utm_campaign, variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      Math.floor(now.getTime() / 1000),
      day,
      kind,
      path,
      refHost(body.ref, new URL(request.url).hostname),
      (request.cf && request.cf.country) || null,
      DEVICES.has(body.device) ? body.device : null,
      STYLES.has(body.style) ? body.style : null,
      meta,
      visitor,
      tag(utm.source),
      tag(utm.medium),
      tag(utm.campaign),
      VARIANTS.has(body.variant) ? body.variant : null,
    ).run();
  } catch (err) {
    // A failed metric must never surface to a visitor as a broken page.
    return json({ ok: false }, 202);
  }

  return json({ ok: true }, 202);
}

// No onRequest export on purpose: in Pages Functions a generic onRequest takes
// over every method and the method-specific handlers stop being called, so
// exporting both would silently disable the handler above. Pages answers 405
// by itself for methods with no handler.
