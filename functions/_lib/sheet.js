/* =============================================================================
   The leasing team's lead sheet, in Google Sheets.

   Each new enquiry is also posted, after the visitor has their answer, to a
   small Apps Script web app bound to the team's sheet (tools/lead-sheet/
   Code.gs), which adds it as a row with Status and Owner dropdowns, a Next
   step date and a Replied checkbox. No Google Cloud project, no service
   account: the script runs as the sheet's owner, and a shared token decides
   whether a post is ours.

     LEADS_SHEET_URL    the script's Web app URL (…/exec)
     LEADS_SHEET_TOKEN  the token its setup printed

   Both unset: nothing is sent and nothing else changes. The dashboard shows,
   per enquiry, whether it reached the sheet, and can send it again.
   ============================================================================= */
import { label, cameVia } from './labels.js';
import { moveInLabel } from './movein.js';

export const sheetEnabled = (env) => Boolean(env.LEADS_SHEET_URL && env.LEADS_SHEET_TOKEN);

/** The row as the sheet wants it: words, not codes. */
export function sheetLead(row) {
  return {
    id: row.id,
    received: new Date((row.ts || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    email: row.email || '',
    phone: row.phone || '',
    interest: row.interest ? label(row.interest) : '',
    home: row.plan ? label(row.plan) : 'No preference',
    move_in: moveInLabel(row.move_in) || '',
    source: row.source ? label(row.source) : '',
    came_via: cameVia(row) || '',
    message: row.message || '',
    form: row.form === 'tour' ? 'Tour' : 'Contact',
  };
}

/** Post one enquiry. Returns {ok} or {ok:false, note}, the note in words the
 *  dashboard can show as they are. */
export async function sendToSheet(env, row) {
  if (!sheetEnabled(env)) return { ok: false, note: 'The lead sheet is not connected.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    // Apps Script answers a POST with a redirect to the result; fetch follows it.
    const res = await fetch(env.LEADS_SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: env.LEADS_SHEET_TOKEN, lead: sheetLead(row) }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await res.text();
    let answer = null;
    try { answer = JSON.parse(text); } catch { /* an HTML page: see below */ }
    if (answer && answer.ok) return { ok: true };
    if (answer && answer.error) return { ok: false, note: `The sheet said: ${String(answer.error).slice(0, 200)}` };
    // A Google sign-in page instead of an answer: the web app is not open to
    // the website. The usual cause, and the one fix.
    if (/accounts\.google\.com|ServiceLogin|<html/i.test(`${res.url} ${text.slice(0, 500)}`)) {
      return { ok: false, note: 'Google asked for a sign-in. Deploy the script as a web app with “Who has access: Anyone”.' };
    }
    return { ok: false, note: `The sheet answered ${res.status}.` };
  } catch (err) {
    return {
      ok: false,
      note: err && err.name === 'AbortError' ? 'The sheet took too long to answer.' : `Could not reach the sheet: ${String(err).slice(0, 150)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Post it, and keep how it went against the enquiry for the dashboard. */
export async function sheetAndRecord(env, row) {
  const result = await sendToSheet(env, row);
  if (env.DB) {
    try {
      await env.DB.prepare('INSERT OR REPLACE INTO lead_sync (inquiry_id, ok, note, ts) VALUES (?, ?, ?, ?)')
        .bind(row.id, result.ok ? 1 : 0, result.ok ? null : (result.note || null), Math.floor(Date.now() / 1000)).run();
    } catch { /* bookkeeping only */ }
  }
  if (!result.ok) console.log('lead sheet:', result.note);
  return result;
}
