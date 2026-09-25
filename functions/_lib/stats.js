/* =============================================================================
   The dashboard's numbers, in one place.

   /api/stats shows them; /api/insights hands the very same object to Claude.
   Keeping one function means the summary can never describe numbers the
   dashboard does not show.

   Every query is parameterised. `days` is the only input, and callers coerce it
   to a bounded integer before it arrives here.
   ============================================================================= */

const LIMIT = 12;

/* How long the /tour/ test should run before anyone reads a winner into it. */
const TEST_MIN_LEADS = 10;
const TEST_MIN_VISITORS = 100;   // per version
const TEST_CALL_AT = 0.95;

/** The chance each version of a page is truly the best at turning visitors
 *  into enquiries. Each version's rate gets a Beta(1 + enquiries,
 *  1 + visitors − enquiries) posterior — flat prior, so a version with no data
 *  starts even — and P(best) = ∫ fᵢ(x) · Πⱼ≠ᵢ Fⱼ(x) dx, summed on a grid over
 *  the range where the posteriors actually sit. Exact to the grid and cheap:
 *  drawing the same thing by Monte Carlo would eat most of the free plan's
 *  10 ms CPU allowance. */
export function chanceBest(arms, n = 2000) {
  const params = arms.map(({ visitors, leads }) => {
    const a = 1 + leads;
    const b = 1 + Math.max(visitors - leads, 0);
    const mean = a / (a + b);
    const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
    return { a, b, mean, sd };
  });
  const lo = Math.max(0, Math.min(...params.map((p) => p.mean - 8 * p.sd)));
  const hi = Math.min(1, Math.max(...params.map((p) => p.mean + 8 * p.sd)));
  const step = (hi - lo) / n;

  const pdf = params.map(({ a, b }) => {
    const f = new Float64Array(n);
    let max = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = lo + (k + 0.5) * step;
      f[k] = (a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x);
      if (f[k] > max) max = f[k];
    }
    let sum = 0;
    for (let k = 0; k < n; k++) { f[k] = Math.exp(f[k] - max); sum += f[k]; }
    for (let k = 0; k < n; k++) f[k] /= sum;
    return f;
  });
  const cdf = pdf.map((f) => {
    const c = new Float64Array(n);
    let run = 0;
    for (let k = 0; k < n; k++) { c[k] = run + f[k] / 2; run += f[k]; }
    return c;
  });

  return arms.map((_, i) => {
    let p = 0;
    for (let k = 0; k < n; k++) {
      let term = pdf[i][k];
      for (let j = 0; j < arms.length; j++) if (j !== i) term *= cdf[j][k];
      p += term;
    }
    return Math.round(p * 1000) / 1000;
  });
}

const rate = (leads, visits) => (visits ? Math.round((leads / visits) * 1000) / 10 : 0);

export async function loadStats(env, days) {
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
  const asked = { interests: [], topics: [] };
  try {
    const [lt, ld, lp, li] = await env.DB.batch([
      q(`SELECT COUNT(*) AS n FROM inquiries WHERE day >= ?`, from),
      q(`SELECT day, COUNT(*) AS leads FROM inquiries WHERE day >= ? GROUP BY day`, from),
      // Stored as '1'..'3'; labelled the way the residences filter chips are,
      // so an enquiry and a filter click for the same plan share one row.
      q(`SELECT plan || ' bedroom' AS plan, COUNT(*) AS count
           FROM inquiries WHERE day >= ? AND plan IS NOT NULL GROUP BY plan`, from),
      q(`SELECT interest, COUNT(*) AS count
           FROM inquiries WHERE day >= ? AND interest IS NOT NULL
          GROUP BY interest ORDER BY count DESC`, from),
    ]);
    leadTotal = (lt.results[0] && lt.results[0].n) || 0;
    for (const r of ld.results) leadByDay.set(r.day, r.leads);
    leadPlans.push(...lp.results);
    asked.interests = li.results;
  } catch { /* no inquiries table yet */ }

  // What enquirers actually wrote about, as Claude tagged it. Counts only.
  try {
    const { results } = await q(
      `SELECT t.value AS topic, COUNT(*) AS count
         FROM inquiries, json_each(json_extract(inquiries.ai, '$.topics')) AS t
        WHERE inquiries.day >= ? AND inquiries.ai IS NOT NULL
        GROUP BY t.value ORDER BY count DESC`, from).all();
    asked.topics = results;
  } catch { /* no ai column yet */ }

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

  /* ---- Where enquiries come from, and the /tour/ test ----------------------
     Its own batch, for the same reason as the leads above: a database from
     before campaign tracking has none of these columns, and that should cost
     these panels, not the dashboard.

     A visitor's channel is their first pageview of the day that carries a
     campaign tag or an outside referrer, else their first pageview — the same
     rule /api/inquiry uses to label an enquiry, so the visitors and the
     enquiries in one row are counted the same way. It is called channel, not
     source, because inquiries already has a source column (the form's "how
     did you hear about us"), and SQLite would group by that instead. */
  let sources = [];
  let campaigns = [];
  let test = null;
  let starts = 0;
  try {
    const src = (ref) => `COALESCE(utm_source || ' / ' || utm_medium, utm_source, ${ref}, 'direct')`;
    const [sv, sl, cv, cl, tv, tsr, tl, fs] = await env.DB.batch([
      q(`SELECT channel, COUNT(*) AS visits FROM (
           SELECT ${src('ref')} AS channel,
                  ROW_NUMBER() OVER (PARTITION BY day, visitor
                                     ORDER BY (utm_source IS NULL AND ref IS NULL), ts) AS n
             FROM events WHERE day >= ? AND kind = 'pageview')
          WHERE n = 1 GROUP BY channel`, from),
      q(`SELECT ${src('referrer')} AS channel, COUNT(*) AS leads
           FROM inquiries WHERE day >= ? GROUP BY channel`, from),
      q(`SELECT utm_campaign AS campaign, COUNT(DISTINCT day || visitor) AS visits
           FROM events WHERE day >= ? AND kind = 'pageview' AND utm_campaign IS NOT NULL
          GROUP BY utm_campaign`, from),
      q(`SELECT utm_campaign AS campaign, COUNT(*) AS leads
           FROM inquiries WHERE day >= ? AND utm_campaign IS NOT NULL
          GROUP BY utm_campaign`, from),
      q(`SELECT variant, COUNT(DISTINCT day || visitor) AS n
           FROM events WHERE day >= ? AND kind = 'pageview' AND variant IS NOT NULL
          GROUP BY variant`, from),
      q(`SELECT variant, COUNT(DISTINCT day || visitor) AS n
           FROM events WHERE day >= ? AND kind = 'form_start' AND variant IS NOT NULL
          GROUP BY variant`, from),
      q(`SELECT variant, COUNT(*) AS n
           FROM inquiries WHERE day >= ? AND variant IS NOT NULL
          GROUP BY variant`, from),
      q(`SELECT COUNT(DISTINCT day || visitor) AS n
           FROM events WHERE day >= ? AND kind = 'form_start'`, from),
    ]);

    const join = (visitRows, leadRows, key) => {
      const m = new Map();
      for (const r of visitRows) m.set(r[key], { [key]: r[key], visits: r.visits, leads: 0 });
      for (const r of leadRows) {
        if (!m.has(r[key])) m.set(r[key], { [key]: r[key], visits: 0, leads: 0 });
        m.get(r[key]).leads = r.leads;
      }
      return [...m.values()]
        .map((r) => ({ ...r, rate: rate(r.leads, r.visits) }))
        .sort((a, b) => b.leads - a.leads || b.visits - a.visits)
        .slice(0, LIMIT);
    };
    sources = join(sv.results, sl.results, 'channel');
    campaigns = join(cv.results, cl.results, 'campaign');
    starts = (fs.results[0] && fs.results[0].n) || 0;

    const by = (rows) => new Map(rows.map((r) => [r.variant, r.n]));
    const [vis, st, ld] = [by(tv.results), by(tsr.results), by(tl.results)];
    const arms = ['a', 'b', 'c'].map((v) => ({
      variant: v, visitors: vis.get(v) || 0, starts: st.get(v) || 0, leads: ld.get(v) || 0,
    }));
    if (arms.some((a) => a.visitors || a.leads)) {
      const best = chanceBest(arms);
      arms.forEach((a, i) => { a.rate = rate(a.leads, a.visitors); a.best = best[i]; });
      const top = arms.reduce((x, y) => (y.best > x.best ? y : x));
      const enough = arms.reduce((n, a) => n + a.leads, 0) >= TEST_MIN_LEADS &&
                     arms.every((a) => a.visitors >= TEST_MIN_VISITORS);
      test = {
        arms,
        // 'early' until there is enough to read anything into; after that a
        // winner only once one version is 95% likely to be the best.
        verdict: !enough ? 'early' : top.best >= TEST_CALL_AT ? 'winner' : 'none',
        leader: top.variant,
        rule: { minLeads: TEST_MIN_LEADS, minVisitors: TEST_MIN_VISITORS, callAt: TEST_CALL_AT },
      };
    }
  } catch { /* database from before campaign tracking */ }

  return {
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
    // Visitor → touched the form → sent it. Enquiries can outnumber form
    // starts when someone blocks analytics but still sends the form.
    funnel: { visitors: t.visits || 0, starts, leads },
    daily: dailyOut,
    pages: pages.results,
    referrers: referrers.results,
    sources,
    campaigns,
    test,
    asked,
    countries: countries.results,
    devices: devices.results,
    styles: styles.results,
    events: events.results,
    plans: plansOut,
  };
}
