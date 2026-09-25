/* =============================================================================
   /r/<token> — a shared report, readable by anyone with the link.

   No session: the unguessable token is the permission, and the page holds
   totals only, never a person. Stop sharing it from the dashboard and the row
   is deleted, so this answers 404 from the next request on.
   ============================================================================= */
import { renderReport, REPORT_HEADERS } from '../_lib/report.js';

const GONE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Report not found · Charlotte Square</title>
<meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<link rel="stylesheet" href="/assets/css/report.css">
</head>
<body>
<main class="report report--gone">
  <h1>This report is not available.</h1>
  <p>The link may have been turned off, or copied incompletely. Ask whoever sent it for a new one.</p>
</main>
</body>
</html>`;

const gone = () => new Response(GONE, { status: 404, headers: REPORT_HEADERS });

export async function onRequestGet({ params, env }) {
  const token = String(params.token || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token) || !env.DB) return gone();

  let row = null;
  try {
    row = await env.DB.prepare('SELECT body FROM reports WHERE token = ?').bind(token).first();
  } catch { /* no reports table yet */ }
  if (!row) return gone();

  let report;
  try { report = JSON.parse(row.body); } catch { return gone(); }
  return new Response(renderReport(report), { headers: REPORT_HEADERS });
}
