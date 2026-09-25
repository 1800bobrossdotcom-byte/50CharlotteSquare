/* =============================================================================
   GET /api/stats?days=30 — the whole dashboard payload, in one round trip.

   Session-gated. Every query is parameterised; `days` is the only input and it
   is coerced to a bounded integer before it goes anywhere near SQL.
   ============================================================================= */
import { requireSession, json } from '../_lib/auth.js';

const LIMIT = 12;

export async function onRequestGet({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database bound.' }, 503);

  const asked = Number.parseInt(new URL(request.url).searchParams.get('days') || '30', 10);
  const days = Math.min(Math.max(Number.isFinite(asked) ? asked : 30, 1), 365);

  const from = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  const q = (sql, ...bind) => env.DB.prepare(sql).bind(...bind);

  const [totals, daily, pages, referrers, countries, devices, styles, events, plans] =
    await env.DB.batch([
      q(`SELECT
           SUM(kind = 'pageview')                                  AS pageviews,
           COUNT(DISTINCT day || visitor)                          AS visits,
           SUM(kind = 'phone_click')                               AS phone_clicks,
           SUM(kind = 'portal_click')                              AS portal_clicks
         FROM events WHERE day >= ?`, from),

      q(`SELECT day,
                SUM(kind = 'pageview')     AS pageviews,
                COUNT(DISTINCT visitor)    AS visits
         FROM events WHERE day >= ? GROUP BY day ORDER BY day`, from),

      q(`SELECT path,
                COUNT(*)                AS views,
                COUNT(DISTINCT visitor) AS visits
         FROM events WHERE day >= ? AND kind = 'pageview'
         GROUP BY path ORDER BY views DESC LIMIT ?`, from, LIMIT),

      // A null ref is someone who typed the address or came from a bookmark —
      // worth showing as its own row rather than dropping.
      q(`SELECT COALESCE(ref, 'direct') AS ref, COUNT(*) AS views
         FROM events WHERE day >= ? AND kind = 'pageview'
         GROUP BY ref ORDER BY views DESC LIMIT ?`, from, LIMIT),

      q(`SELECT COALESCE(country, '—') AS country, COUNT(*) AS views
         FROM events WHERE day >= ? AND kind = 'pageview'
         GROUP BY country ORDER BY views DESC LIMIT ?`, from, LIMIT),

      q(`SELECT COALESCE(device, '—') AS device, COUNT(*) AS views
         FROM events WHERE day >= ? AND kind = 'pageview'
         GROUP BY device ORDER BY views DESC`, from),

      q(`SELECT COALESCE(style, '—') AS style, COUNT(*) AS views
         FROM events WHERE day >= ? AND kind = 'pageview'
         GROUP BY style ORDER BY views DESC`, from),

      q(`SELECT kind, COUNT(*) AS count
         FROM events WHERE day >= ? AND kind <> 'pageview'
         GROUP BY kind ORDER BY count DESC`, from),

      // Which floor plan people ask about — the number a leasing office
      // actually wants, and the reason this is worth running in-house.
      q(`SELECT json_extract(meta, '$.plan') AS plan, COUNT(*) AS count
         FROM events
         WHERE day >= ? AND kind = 'plan_view' AND meta IS NOT NULL
           AND json_extract(meta, '$.plan') IS NOT NULL
           AND json_extract(meta, '$.plan') <> 'All homes'
         GROUP BY plan ORDER BY count DESC LIMIT ?`, from, LIMIT),
    ]);

  /* ---- Leads come from the inquiries table, not from events ----------------
     They used to be counted from a 'tour_request' browser event. Only the old
     open-your-email-app fallback ever fired it, so once the form posted to
     /api/inquiry every lead count on this dashboard read zero while the
     Enquiries list filled up. The table is the record itself: nothing a
     browser does can drop a row from it, and the tile can never disagree with
     the list underneath it.
     Kept out of the batch above on purpose. A database created before intake
     existed has no inquiries table; that should read as no leads, not take
     the whole dashboard down with it. */
  let leadTotal = 0;
  const leadByDay = new Map();
  const leadPlans = [];
  try {
    const [lt, ld, lp] = await env.DB.batch([
      q(`SELECT COUNT(*) AS n FROM inquiries WHERE day >= ?`, from),
      q(`SELECT day, COUNT(*) AS leads FROM inquiries WHERE day >= ? GROUP BY day`, from),
      // Stored as '1'..'3'; labelled the way the residences filter chips are,
      // so an enquiry and a filter click for the same plan share one row.
      q(`SELECT plan || ' bedroom' AS plan, COUNT(*) AS count
           FROM inquiries WHERE day >= ? AND plan IS NOT NULL GROUP BY plan`, from),
    ]);
    leadTotal = (lt.results[0] && lt.results[0].n) || 0;
    for (const r of ld.results) leadByDay.set(r.day, r.leads);
    leadPlans.push(...lp.results);
  } catch { /* no inquiries table yet */ }

  // Every day with traffic, plus any day with a lead but no recorded pageview
  // (analytics blocked, say) — a lead is never dropped from the chart.
  const dayRows = new Map(daily.results.map((r) => [r.day, { ...r, leads: 0 }]));
  for (const [day, n] of leadByDay) {
    if (!dayRows.has(day)) dayRows.set(day, { day, pageviews: 0, visits: 0, leads: 0 });
    dayRows.get(day).leads = n;
  }
  const dailyOut = [...dayRows.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

  const planCount = new Map();
  for (const r of [...plans.results, ...leadPlans]) {
    planCount.set(r.plan, (planCount.get(r.plan) || 0) + r.count);
  }
  const plansOut = [...planCount.entries()]
    .map(([plan, count]) => ({ plan, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, LIMIT);

  const t = totals.results[0] || {};
  const pv = t.pageviews || 0;
  const leads = leadTotal;

  return json({
    range: { from, to, days },
    totals: {
      pageviews: pv,
      visits: t.visits || 0,
      leads,
      phone_clicks: t.phone_clicks || 0,
      portal_clicks: t.portal_clicks || 0,
      // Leads per hundred pageviews. Stated as a rate so a quiet week and a
      // busy one can be compared at a glance.
      lead_rate: pv ? Math.round((leads / pv) * 1000) / 10 : 0,
    },
    daily: dailyOut,
    pages: pages.results,
    referrers: referrers.results,
    countries: countries.results,
    devices: devices.results,
    styles: styles.results,
    events: events.results,
    plans: plansOut,
  });
}
