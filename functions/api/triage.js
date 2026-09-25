/* =============================================================================
   POST /api/triage {id} — have Claude summarise one enquiry now.

   New enquiries are summarised automatically when they arrive. This is the
   dashboard's "Summarise" button: for leads that came in before the key was
   set, and for a run that failed. Session-gated like the rest of the admin API,
   and with the same SameSite=Strict reasoning as /api/inquiries for why it
   carries no CSRF token of its own.
   ============================================================================= */
import { requireSession, json } from '../_lib/auth.js';
import { aiEnabled, triageInquiry } from '../_lib/ai.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);
  if (!aiEnabled(env)) return json({ error: 'Add ANTHROPIC_API_KEY to the Pages project to turn this on.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON.' }, 400); }
  const id = Number.parseInt(body.id, 10);
  if (!Number.isInteger(id) || id < 1) return json({ error: 'Which enquiry?' }, 400);

  // Someone is watching this one, so it can take longer than the automatic run
  // and try once more if Claude is briefly busy.
  const res = await triageInquiry(env, id, { timeout: 60000, maxRetries: 1 });
  return res.ok ? json({ ok: true, ai: res.ai }) : json({ error: res.error }, 502);
}
