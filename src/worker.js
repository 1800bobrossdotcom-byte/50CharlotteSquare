/* =============================================================================
   Charlotte Square — the Cloudflare Worker.

   The website is plain files in public/, served by Cloudflare's asset layer
   with _headers and _redirects applied, and never touching this code. Only
   the paths listed under run_worker_first in wrangler.toml come here: the
   API, the /admin/ gate, the /tour/ test and shared reports.

   The route handlers in functions/ were written as Cloudflare Pages Functions
   and keep that shape: each exports onRequestGet, onRequestPost and so on,
   and receives { request, env, params, waitUntil, next }. This file is the
   small router that calls them the same way, so they run unchanged.

   Also here: /unsubscribe/<token>, the link at the foot of every email.
   ============================================================================= */
import * as admin from '../functions/admin/_middleware.js';
import * as collect from '../functions/api/collect.js';
import * as emailEvents from '../functions/api/email-events.js';
import * as inquiries from '../functions/api/inquiries.js';
import * as inquiry from '../functions/api/inquiry.js';
import * as insights from '../functions/api/insights.js';
import * as login from '../functions/api/login.js';
import * as logout from '../functions/api/logout.js';
import * as reports from '../functions/api/reports.js';
import * as stats from '../functions/api/stats.js';
import * as triage from '../functions/api/triage.js';
import * as tour from '../functions/tour/index.js';
import * as report from '../functions/r/[token].js';
import * as unsubscribe from '../functions/unsubscribe/[token].js';
import SCHEMA from '../schema.sql';

// The tables, from schema.sql, one statement each. Every statement there is
// CREATE … IF NOT EXISTS, so running them again changes nothing.
const SCHEMA_STATEMENTS = SCHEMA.split('\n')
  .map((line) => line.split('--')[0])
  .join('\n')
  .split(';')
  .map((sql) => sql.trim())
  .filter(Boolean);

// A new database starts empty. Rather than depend on someone pasting
// schema.sql into the D1 console, the Worker makes any missing tables the
// first time it runs: one cheap lookup per Worker instance, and the full set
// of CREATE statements only when a table is actually missing.
let schemaReady = null;
function ensureSchema(env) {
  if (!env.DB) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      const { results } = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).all();
      const have = new Set(results.map((r) => r.name));
      const want = SCHEMA_STATEMENTS
        .map((sql) => /CREATE TABLE IF NOT EXISTS (\w+)/i.exec(sql))
        .filter(Boolean).map((m) => m[1]);
      if (want.every((t) => have.has(t))) return;
      await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
    })().catch((err) => {
      schemaReady = null;   // try again on the next request
      console.error('schema setup failed:', err && err.message);
    });
  }
  return schemaReady;
}

const API = {
  '/api/collect': collect,
  '/api/email-events': emailEvents,
  '/api/inquiries': inquiries,
  '/api/inquiry': inquiry,
  '/api/insights': insights,
  '/api/login': login,
  '/api/logout': logout,
  '/api/reports': reports,
  '/api/stats': stats,
  '/api/triage': triage,
};

// _headers covers every file served straight from public/, but by design not
// a response made here. These are its site-wide rules, for the pages this
// Worker returns: the sign-in page, the dashboard and /tour/. A handler that
// sets its own value, such as the shared report's stricter policy, keeps it.
const SECURITY = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'accelerometer=(), autoplay=(), browsing-topics=(), camera=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()',
};

// The dashboard and its sign-in page load nothing from anywhere else. The
// public pages carry their own policy in a <meta> tag, with the hashes of
// their inline scripts, so /tour/ is left to that.
const ADMIN_CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'";

function route(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (API[path]) return { mod: API[path], params: {} };
  if (path === '/tour') return { mod: tour, params: {} };
  const m = /^\/r\/([^/]+)$/.exec(path);
  if (m) return { mod: report, params: { token: decodeURIComponent(m[1]) } };
  // Tokens are plain letters, digits, - and _, so nothing needs decoding.
  const u = /^\/unsubscribe\/([A-Za-z0-9_-]+)$/.exec(path);
  if (u) return { mod: unsubscribe, params: { token: u[1] } };
  if (path === '/admin' || pathname.startsWith('/admin/')) return { mod: admin, params: {}, admin: true };
  return null;
}

function handlerFor(mod, method) {
  const name = 'onRequest' + method.charAt(0) + method.slice(1).toLowerCase();
  if (typeof mod[name] === 'function') return mod[name];
  if (typeof mod.onRequest === 'function') return mod.onRequest;
  if (method === 'HEAD' && typeof mod.onRequestGet === 'function') return mod.onRequestGet;
  return null;
}

function allowed(mod) {
  return ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    .filter((m) => handlerFor(mod, m)).join(', ');
}

function secure(res, isAdmin) {
  // Asset and redirect responses can have immutable headers; copy first.
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  if (isAdmin && !out.headers.has('Content-Security-Policy')) out.headers.set('Content-Security-Policy', ADMIN_CSP);
  return out;
}

/* Google Search Console proves ownership by fetching /google<code>.html and
   reading it at that exact address. The asset layer would answer with a
   redirect to the same address without .html, which the check does not
   accept, so the file is read from there and returned here, as it is. */
async function searchConsoleFile(request, env, url) {
  const m = /^\/(google[0-9a-f]+)\.html$/.exec(url.pathname);
  if (!m) return null;
  const res = await env.ASSETS.fetch(new Request(new URL(`/${m[1]}`, url), { method: 'GET' }));
  if (!res.ok) return null;
  return new Response(request.method === 'HEAD' ? null : await res.text(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const verify = await searchConsoleFile(request, env, url);
    if (verify) return secure(verify, false);
    const hit = route(url.pathname);
    // Anything else that reached here is a file: hand it to the asset layer.
    if (!hit) return env.ASSETS.fetch(request);

    await ensureSchema(env);
    const handler = handlerFor(hit.mod, request.method);
    if (!handler) {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: allowed(hit.mod), 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const res = await handler({
      request,
      env,
      params: hit.params,
      data: {},
      waitUntil: (p) => ctx.waitUntil(p),
      passThroughOnException: () => ctx.passThroughOnException(),
      next: (input, init) => env.ASSETS.fetch(input ? new Request(input, init) : request),
    });
    return secure(res, hit.admin);
  },
};
