/* =============================================================================
   /api/reports — make, list and switch off shared reports.

   GET                      the most recent reports, newest first
   POST   {period, day}     make one for the day, week or month containing `day`
   DELETE ?token=…          stop sharing one; its link answers 404 from then on

   All session-gated, with the same SameSite=Strict reasoning as the rest of the
   admin API for why there is no separate CSRF token. What they make is public
   to anyone holding the link, which is why a report is built from totals only:
   see _lib/report.js.
   ============================================================================= */
import { requireSession, json } from '../_lib/auth.js';
import { isoDay, addDays } from '../_lib/stats.js';
import { PERIODS, periodRange, buildReport } from '../_lib/report.js';

const OLDEST_DAYS = 400;

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// 128 random bits: nobody finds a report by guessing its address.
const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

const linkFor = (request, token) => `${new URL(request.url).origin}/r/${token}`;

export async function onRequestGet({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);
  try {
    const { results } = await env.DB.prepare(
      `SELECT token, period, from_day, to_day, partial, label, ts
         FROM reports ORDER BY ts DESC LIMIT 20`,
    ).all();
    return json({
      reports: results.map((r) => ({ ...r, url: linkFor(request, r.token) })),
    });
  } catch {
    return json({ reports: [] });   // no reports table yet
  }
}

export async function onRequestPost({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON.' }, 400); }

  const period = PERIODS.includes(body.period) ? body.period : null;
  const today = isoDay(new Date());
  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
  if (!period || !day || Number.isNaN(Date.parse(day))) return json({ error: 'Which period?' }, 400);
  if (day > today || day < addDays(today, -OLDEST_DAYS)) return json({ error: 'That period is out of range.' }, 400);

  // A finished period does not change, so asking for it twice returns the
  // link already made, before any work, rather than a second copy.
  const range = periodRange(period, day, today);
  if (!range.partial) {
    try {
      const had = await env.DB.prepare(
        `SELECT token, label FROM reports
          WHERE period = ? AND from_day = ? AND to_day = ? AND partial = 0
          ORDER BY ts DESC LIMIT 1`,
      ).bind(period, range.from, range.to).first();
      if (had) return json({ token: had.token, url: linkFor(request, had.token), label: had.label, existing: true });
    } catch { /* fall through and make one */ }
  }

  const report = await buildReport(env, period, day);

  const token = newToken();
  try {
    await env.DB.prepare(
      `INSERT INTO reports (token, period, from_day, to_day, partial, label, ts, body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(token, period, report.from, report.to, report.partial ? 1 : 0,
      `${report.kind} · ${report.label}`, report.created, JSON.stringify(report)).run();
  } catch {
    return json({ error: 'Could not save the report. Run schema.sql to add the reports table.' }, 500);
  }
  return json({
    token,
    url: linkFor(request, token),
    label: `${report.kind} · ${report.label}`,
    // Why the plain-English section is missing, when it is.
    summaryNote: report.summaryNote,
  });
}

export async function onRequestDelete({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return json({ error: 'Which report?' }, 400);
  try {
    await env.DB.prepare('DELETE FROM reports WHERE token = ?').bind(token).run();
  } catch {
    return json({ error: 'Could not remove it.' }, 500);
  }
  return json({ ok: true });
}
