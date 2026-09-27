/* =============================================================================
   Every email the site sends goes out through Resend, from here.

     RESEND_API_KEY   the key. Without it nothing is sent and nothing breaks.
     LEAD_FROM        the From: line, on a domain verified in that Resend
                      account, e.g. Charlotte Square <leasing@your-domain>.
     LEAD_TO          the leasing inbox, or several separated by commas.
     REPLY_TO         optional: where a prospect's reply to their confirmation
                      goes. Without it, the first address in LEAD_TO.
     RESEND_API_URL   only ever set for local tests, which point it at a stub.

   Returns {ok, id} or {ok:false, error}, the error in the provider's own words
   so the dashboard can say why rather than just that it failed. id is
   Resend's, which its delivery reports (api/email-events.js) quote back.
   ============================================================================= */

/** The leasing inbox or inboxes, from LEAD_TO. */
export const leadTo = (env) => String(env.LEAD_TO || '').split(',').map((s) => s.trim()).filter(Boolean);

/** Where replies to a prospect-facing email should land. */
export const replyTo = (env) => String(env.REPLY_TO || '').trim() || leadTo(env)[0] || null;

/** One row in the emails log, for the dashboard and the reports. kind is
 *  confirmation or notification; result is what sendEmail returned, or a
 *  {ok:false, reason, note} for one deliberately not sent. Never throws. */
export async function logEmail(env, kind, inquiryId, result) {
  if (!env.DB) return;
  const now = new Date();
  try {
    await env.DB.prepare(
      `INSERT INTO emails (ts, day, kind, inquiry_id, sent, reason, note, resend_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      Math.floor(now.getTime() / 1000), now.toISOString().slice(0, 10), kind, inquiryId || null,
      result.ok ? 1 : 0,
      result.ok ? null : (result.reason || 'error'),
      result.ok ? null : String(result.note || result.error || '').slice(0, 300) || null,
      result.ok ? (result.id || null) : null,
    ).run();
  } catch { /* bookkeeping only: a missing table must not cost an email */ }
}

export async function sendEmail(env, { to, subject, html, text, replyTo: reply, headers }) {
  const key = env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set on this deployment.' };
  try {
    const res = await fetch(env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.LEAD_FROM || 'Charlotte Square <onboarding@resend.dev>',
        to,
        subject,
        html,
        ...(text ? { text } : {}),
        ...(reply ? { reply_to: reply } : {}),
        ...(headers ? { headers } : {}),
      }),
    });
    if (res.ok) {
      let id = null;
      try { id = (await res.json()).id || null; } catch { /* sent; no id to match reports to */ }
      return { ok: true, id };
    }

    // Resend answers with JSON carrying a human-readable message. Read it if we
    // can, fall back to the status, and cap it — this ends up in a page.
    let detail = '';
    try {
      const body = await res.json();
      detail = (body && (body.message || body.error || body.name)) || '';
    } catch { /* not JSON; the status line will have to do */ }
    return { ok: false, error: `${res.status}: ${String(detail || res.statusText).slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: `Could not reach the email provider: ${String(err).slice(0, 200)}` };
  }
}
