/* =============================================================================
   Reports: one day, one week or one month of the dashboard, frozen into a
   snapshot that can be shared by link and saved as a PDF.

   A snapshot holds aggregate numbers only, the same ones the dashboard panels
   show, plus Claude's plain-English read of them when the key is set. Never a
   name, an email address, a phone number or a message: a report link is made
   to be passed around, so nothing on it may identify anyone.

   Days are UTC calendar days, like everything else in the analytics. Weeks
   run Monday to Sunday.
   ============================================================================= */
import { loadStats, loadTotals, addDays, daysBetween, isoDay } from './stats.js';
import { aiEnabled, aiError, explainStats } from './ai.js';

export const PERIODS = ['day', 'week', 'month'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const utc = (day) => new Date(`${day}T00:00:00Z`);

/** The period that contains `day`, cut off at today. `partial` means it is
 *  still running, so the report covers it "so far". */
export function periodRange(period, day, today = isoDay(new Date())) {
  const d = utc(day);
  let from;
  let end;
  if (period === 'day') {
    from = day;
    end = day;
  } else if (period === 'week') {
    from = addDays(day, -((d.getUTCDay() + 6) % 7));     // back to Monday
    end = addDays(from, 6);
  } else {
    from = `${day.slice(0, 7)}-01`;
    end = isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  }
  return { from, to: end > today ? today : end, partial: end >= today };
}

/** The stretch before it, for the "vs" figures. A period still running is
 *  compared with the same number of days of the one before, so a Wednesday
 *  report never sets three days against seven. */
export function previousRange(period, { from, to }) {
  if (period === 'day') return { from: addDays(from, -1), to: addDays(to, -1) };
  if (period === 'week') return { from: addDays(from, -7), to: addDays(to, -7) };
  const f = utc(from);
  const pFrom = isoDay(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, 1)));
  const pEnd = addDays(from, -1);
  const pTo = addDays(pFrom, daysBetween(from, to) - 1);
  return { from: pFrom, to: pTo < pEnd ? pTo : pEnd };
}

const md = (day) => `${MONTHS[utc(day).getUTCMonth()]} ${utc(day).getUTCDate()}`;

/** "September 15–21, 2026", "September 28 – October 4, 2026" */
export function spanLabel(from, to) {
  const f = utc(from);
  const t = utc(to);
  if (from === to) return `${md(from)}, ${t.getUTCFullYear()}`;
  if (f.getUTCFullYear() !== t.getUTCFullYear()) return `${md(from)}, ${f.getUTCFullYear()} – ${md(to)}, ${t.getUTCFullYear()}`;
  if (f.getUTCMonth() !== t.getUTCMonth()) return `${md(from)} – ${md(to)}, ${t.getUTCFullYear()}`;
  return `${md(from)}–${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

export function periodLabel(period, { from, to, partial }) {
  const so = partial ? ' (so far)' : '';
  if (period === 'day') return `${WEEKDAYS[utc(from).getUTCDay()]}, ${spanLabel(from, to)}${so}`;
  if (period === 'month') {
    const t = utc(to);
    return `${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}${partial ? `, through ${md(to)}` : ''}`;
  }
  return `${spanLabel(from, to)}${so}`;
}

const NOUN = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
const BEFORE = { day: 'the day before', week: 'the week before', month: 'the month before' };

/** Everything the report page shows, computed once and kept. */
export async function buildReport(env, period, day) {
  const range = periodRange(period, day);
  const prev = previousRange(period, range);
  const [stats, before] = await Promise.all([loadStats(env, range), loadTotals(env, prev)]);

  const report = {
    v: 1,
    period,
    kind: NOUN[period],
    from: range.from,
    to: range.to,
    partial: range.partial,
    label: periodLabel(period, range),
    previous: {
      ...prev,
      label: spanLabel(prev.from, prev.to),
      what: range.partial ? `the same days of ${BEFORE[period]}` : BEFORE[period],
      totals: before,
    },
    totals: {
      visits: stats.totals.visits,
      pageviews: stats.totals.pageviews,
      leads: stats.totals.leads,
      phone_clicks: stats.totals.phone_clicks,
      starts: stats.funnel.starts,
    },
    daily: stats.daily.map(({ day: d, visits, leads }) => ({ day: d, visits, leads })),
    sources: stats.sources,
    campaigns: stats.campaigns,
    test: stats.test,
    asked: stats.asked,
    plans: stats.plans,
    pages: stats.pages.slice(0, 8).map(({ path, views }) => ({ path, views })),
    devices: stats.devices,
    summary: null,
    summaryNote: null,
    created: Math.floor(Date.now() / 1000),
  };

  // Claude's read, kept per period like the dashboard's so a second copy of the
  // same finished week does not pay for the same answer twice.
  if (aiEnabled(env)) {
    const key = `report|${period}|${range.from}|${range.to}`;
    try {
      const hit = await env.DB.prepare('SELECT body FROM insights WHERE key = ?').bind(key).first();
      if (hit && !range.partial) report.summary = JSON.parse(hit.body);
    } catch { /* no insights table yet */ }
    if (!report.summary) {
      try {
        report.summary = await explainStats(env, { ...stats, previous: { ...prev, ...before } });
        try {
          await env.DB.prepare(
            `INSERT INTO insights (key, ts, body) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, body = excluded.body`,
          ).bind(key, report.created, JSON.stringify(report.summary)).run();
        } catch { /* shown either way */ }
      } catch (err) {
        report.summaryNote = aiError(err);
      }
    }
  }
  return report;
}

/* ---- The page ----------------------------------------------------------------
   Rendered on the server so a colleague needs nothing but the link: no login,
   no script for the content, and the browser's own print dialog makes the PDF.
   Every string from the data goes through esc(). */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (part, whole) => (!whole || part > whole ? '—' : `${Math.round((part / whole) * 1000) / 10}%`);
const shortDay = (day) => `${MONTHS[utc(day).getUTCMonth()].slice(0, 3)} ${utc(day).getUTCDate()}`;
const channelName = (c) => (c === 'direct' ? 'Typed in or bookmarked' : String(c).replace(/_/g, ' '));

/** "▲ 18%" against the period before. Up is good for every figure here. */
function delta(cur, prev) {
  if (!prev) return cur ? { text: 'new this period', dir: 'up' } : { text: 'no change', dir: 'flat' };
  const change = Math.round(((cur - prev) / prev) * 100);
  if (change === 0) return { text: 'no change', dir: 'flat' };
  return { text: `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}%`, dir: change > 0 ? 'up' : 'down' };
}

function pointsDelta(cur, prev) {
  const diff = Math.round((cur - prev) * 10) / 10;
  if (!diff) return { text: 'no change', dir: 'flat' };
  return { text: `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} pts`, dir: diff > 0 ? 'up' : 'down' };
}

const conversion = (t) => (t.visits ? (t.leads / t.visits) * 100 : 0);

function tile(label, value, d) {
  return `<div class="kpi">
  <p class="kpi__k">${esc(label)}</p>
  <p class="kpi__v">${esc(value)}</p>
  <p class="kpi__d kpi__d--${d.dir}">${esc(d.text)}</p>
</div>`;
}

/** A round number at or just above the tallest bar, whose half is a whole
 *  number too, so both gridline labels read cleanly: 4, 6, 8, 12, 70, 140. */
function niceMax(v) {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const c of [1, 1.2, 1.4, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) {
    const m = Math.round(c * mag);
    if (m >= v && m % 2 === 0) return m;
  }
  return 10 * mag;
}

/** Columns for one series. One axis, one colour, no legend: the title names it.
 *  Bars at most 24 wide with a rounded top and a square foot, 2px of air between
 *  neighbours, the tallest one labelled, every bar titled for hover. */
function columns(rows, key, cls, unit) {
  const W = 640;
  const H = 150;
  const P = { l: 34, r: 6, t: 16, b: 22 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const max = niceMax(Math.max(0, ...rows.map((r) => r[key])));
  const slot = iw / rows.length;
  const bw = Math.min(24, Math.max(2, slot - 2));
  const y = (v) => P.t + ih - (v / max) * ih;
  const out = [];

  for (const v of [0, max / 2, max]) {
    out.push(`<line class="gl" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/>`);
    out.push(`<text class="ax" x="${P.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${num(v)}</text>`);
  }
  let peak = 0;
  rows.forEach((r, i) => { if (r[key] > rows[peak][key]) peak = i; });

  rows.forEach((r, i) => {
    const v = r[key];
    const x = P.l + i * slot + (slot - bw) / 2;
    const h = (v / max) * ih;
    const tip = `<title>${esc(shortDay(r.day))}: ${num(v)} ${esc(v === 1 ? unit[0] : unit[1])}</title>`;
    if (v > 0) {
      const rad = Math.min(4, h, bw / 2);
      const top = P.t + ih - h;
      const base = P.t + ih;
      out.push(`<path class="${cls}" d="M${x} ${base}V${top + rad}Q${x} ${top} ${x + rad} ${top}H${x + bw - rad}Q${x + bw} ${top} ${x + bw} ${top + rad}V${base}Z">${tip}</path>`);
    } else {
      // Nothing to draw, but the day still answers a hover.
      out.push(`<rect class="hit" x="${x}" y="${P.t}" width="${bw}" height="${ih}">${tip}</rect>`);
    }
  });
  if (rows[peak] && rows[peak][key] > 0) {
    const cx = P.l + peak * slot + slot / 2;
    out.push(`<text class="val" x="${cx}" y="${y(rows[peak][key]) - 5}" text-anchor="middle">${num(rows[peak][key])}</text>`);
  }
  const ticks = rows.length <= 7 ? rows.map((_, i) => i) : [0, Math.floor((rows.length - 1) / 2), rows.length - 1];
  for (const i of ticks) {
    out.push(`<text class="ax" x="${P.l + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(shortDay(rows[i].day))}</text>`);
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit[1])} per day">${out.join('')}</svg>`;
}

function table(cols, rows, empty) {
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  // The wrapper lets a wide table scroll inside its card on a phone instead of
  // pushing the whole page sideways.
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const VERSION = { a: 'A · Book a tour', b: 'B · Price first', c: 'C · Neighborhood' };
const TOPIC = {
  tour: 'Tours', availability: 'Availability', pricing: 'Pricing', parking: 'Parking',
  pets: 'Pets', amenities: 'Amenities', 'lease-terms': 'Lease terms', application: 'Applying',
  accessibility: 'Accessibility', neighborhood: 'Neighborhood', other: 'Other',
};
const INTEREST = { tour: 'Tours', availability: 'Availability', pricing: 'Pricing', question: 'General questions' };

const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#A93B3F"/><path d="M9 9 H55 V27 H45 V19 H19 V45 H55 V55 H9 Z" fill="#fff"/></svg>`;

export function renderReport(r) {
  const t = r.totals;
  const p = r.previous.totals;
  const created = new Date(r.created * 1000).toISOString().slice(0, 10);

  const kpis = [
    tile('Visitors', num(t.visits), delta(t.visits, p.visits)),
    tile('Enquiries', num(t.leads), delta(t.leads, p.leads)),
    tile('Visitors who enquired', pct(t.leads, t.visits), pointsDelta(conversion(t), conversion(p))),
    tile('Phone taps', num(t.phone_clicks), delta(t.phone_clicks, p.phone_clicks)),
  ].join('');

  const summary = r.summary ? `<section class="card card--ai" aria-labelledby="s-sum">
  <h2 id="s-sum">In plain English</h2>
  <p class="headline">${esc(r.summary.headline)}</p>
  <ul class="points">${(r.summary.points || []).map((pt) => `<li><strong>${esc(pt.title)}</strong> ${esc(pt.detail)}</li>`).join('')}</ul>
  ${(r.summary.next || []).length ? `<p class="k">Worth trying next</p><ol class="next">${r.summary.next.map((n) => `<li>${esc(n)}</li>`).join('')}</ol>` : ''}
  <p class="note">Written by Claude from the numbers in this report.</p>
</section>` : '';

  const charts = r.daily.length > 1 ? `<section class="card" aria-labelledby="s-days">
  <h2 id="s-days">Day by day</h2>
  <div class="charts">
    <figure><figcaption><i class="sw sw--visits"></i>Visitors per day</figcaption>${columns(r.daily, 'visits', 'bar bar--visits', ['visitor', 'visitors'])}</figure>
    <figure><figcaption><i class="sw sw--leads"></i>Enquiries per day</figcaption>${columns(r.daily, 'leads', 'bar bar--leads', ['enquiry', 'enquiries'])}</figure>
  </div>
  <details class="days"><summary>Daily numbers</summary>${table(['Day', 'Visitors', 'Enquiries'], r.daily.map((d) => [shortDay(d.day), num(d.visits), num(d.leads)]), '')}</details>
</section>` : '';

  const test = r.test ? (() => {
    const lead = r.test.arms.find((a) => a.variant === r.test.leader);
    const verdict = r.test.verdict === 'winner'
      ? `Version ${r.test.leader.toUpperCase()} is winning, with a ${Math.round(lead.best * 100)}% chance of being the best.`
      : r.test.verdict === 'none'
        ? `No clear winner yet. Version ${r.test.leader.toUpperCase()} leads with a ${Math.round(lead.best * 100)}% chance of being the best; a winner is called at 95%.`
        : `Too early to call: it needs ${r.test.rule.minLeads} enquiries in all and ${r.test.rule.minVisitors} visitors per version.`;
    return `${table(['Version', 'Visitors', 'Enquiries', 'Rate', 'Chance best'],
      r.test.arms.map((a) => [VERSION[a.variant], num(a.visitors), num(a.leads), pct(a.leads, a.visitors), `${Math.round(a.best * 100)}%`]), '')}
<p class="verdict">${esc(verdict)}</p>`;
  })() : '<p class="empty">The tour page had no visitors in this period.</p>';

  const topics = (r.asked.topics || []).length
    ? r.asked.topics.map((x) => [TOPIC[x.topic] || x.topic, num(x.count)])
    : (r.asked.interests || []).map((x) => [INTEREST[x.interest] || x.interest, num(x.count)]);

  const sections = [
    ['Where enquiries came from', table(['Channel', 'Visitors', 'Enquiries', 'Rate'],
      r.sources.map((s) => [channelName(s.channel), num(s.visits), num(s.leads), pct(s.leads, s.visits)]), 'No visits in this period.')],
    ['Campaigns', table(['Campaign', 'Visitors', 'Enquiries', 'Rate'],
      r.campaigns.map((c) => [c.campaign, num(c.visits), num(c.leads), pct(c.leads, c.visits)]), 'No tagged campaigns in this period.')],
    ['Tour page test', test],
    ['From visit to enquiry', table(['Step', 'People', 'Of visitors'], [
      ['Visitors', num(t.visits), ''],
      ['Started the enquiry form', num(t.starts), pct(t.starts, t.visits)],
      ['Sent an enquiry', num(t.leads), pct(t.leads, t.visits)],
    ], '')],
    ['What people asked about', table(['Topic', 'Enquiries'], topics, 'No enquiries in this period.')],
    ['Floor plan interest', table(['Plan', 'Times'], r.plans.map((x) => [x.plan, num(x.count)]), 'None in this period.')],
    ['Most viewed pages', table(['Page', 'Views'], r.pages.map((x) => [x.path, num(x.views)]), 'None in this period.')],
  ].map(([h, body], i) => `<section class="card" aria-labelledby="s-${i}"><h2 id="s-${i}">${esc(h)}</h2>${body}</section>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.kind)} report · ${esc(r.label)} · Charlotte Square</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<link rel="stylesheet" href="/assets/css/report.css">
</head>
<body>
<main class="report">
  <header class="head">
    <p class="brand">${MARK}<span>Charlotte Square</span></p>
    <p class="kicker">${esc(r.kind)} report</p>
    <h1>${esc(r.label)}</h1>
    <p class="meta">Compared with ${esc(r.previous.what)} (${esc(r.previous.label)}) · created ${esc(spanLabel(created, created))}</p>
    <p class="actions"><button type="button" data-print>Save as PDF</button> <button type="button" data-copy>Copy link</button></p>
  </header>
  <section class="kpis" aria-label="Headline numbers">${kpis}</section>
  ${summary}
  ${charts}
  <div class="grid">${sections}</div>
  <footer class="foot">Totals only: this report holds no names, contact details or messages. From the Charlotte Square website dashboard; days are counted in UTC.</footer>
</main>
<script src="/assets/js/report.js" defer></script>
</body>
</html>`;
}

/* The report's own policy. Functions do not get the _headers file, and this
   page needs even less than the site: its own stylesheet, fonts and one
   script, and nothing that talks to anywhere. */
export const REPORT_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  // Turning a link off has to work at once, so nothing keeps a copy.
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  // The address is the key to the report; it is not handed to anyone.
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
