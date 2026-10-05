/* =============================================================================
   /api/rentmanager — the dashboard's Rent Manager panel. Signed in only.

   GET                     where things stand: connected or not, the last
                           refresh, the preview list, whether it is on the site,
                           and what the connection check found.
   POST {action}           check     sign in and record what a unit looks like,
                                     then refresh
                           refresh   fetch the open units now
                           publish   show the list on the site
                           unpublish take it off the site

   check and refresh call Rent Manager, which counts calls per hour for the
   whole company, so they answer from the last run if it was under a minute ago.
   ============================================================================= */
import { requireSession, json } from '../_lib/auth.js';
import {
  rmConfigured, company, propertyId, discover, refresh, getListing, getStatus, getDiscovery,
  isPublished, setPublished,
} from '../_lib/rentmanager.js';

async function state(env, note) {
  const [status, listing, discovery, published] = await Promise.all([
    getStatus(env), getListing(env), getDiscovery(env), isPublished(env),
  ]);
  return {
    configured: rmConfigured(env), company: company(env), property: propertyId(env),
    published, status, listing, discovery, note: note || null,
  };
}

export async function onRequestGet({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);
  return json(await state(env));
}

export async function onRequestPost({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);
  let body = {};
  try { body = await request.json(); } catch { /* no action */ }
  const action = String(body.action || '');

  if (action === 'publish' || action === 'unpublish') {
    await setPublished(env, action === 'publish');
    return json(await state(env));
  }
  if (action !== 'check' && action !== 'refresh') return json({ error: 'Unknown action.' }, 400);
  if (!rmConfigured(env)) {
    return json({ error: 'Add RM_USERNAME and RM_PASSWORD as secrets in the Worker’s settings in Cloudflare first.' }, 503);
  }

  const last = await getStatus(env);
  if (last && Date.now() / 1000 - last.ts < 60 && !(action === 'check' && !(await getDiscovery(env)))) {
    return json(await state(env, 'Updated less than a minute ago, so Rent Manager was not asked again.'));
  }
  try {
    if (action === 'check') await discover(env);
    await refresh(env);
  } catch (err) {
    // Recorded, so the panel and the next visit show what went wrong.
    try {
      await env.DB.prepare(
        `INSERT INTO rm_cache (key, ts, body) VALUES ('status', ?, ?)
         ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, body = excluded.body`,
      ).bind(Math.floor(Date.now() / 1000), JSON.stringify({ ok: false, error: err.message, code: err.status || 0 })).run();
    } catch { /* shown below either way */ }
    return json({ ...(await state(env)), error: err.message }, 502);
  }
  return json(await state(env));
}
