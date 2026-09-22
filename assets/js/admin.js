/* =============================================================================
   Charlotte Square — analytics dashboard.

   No charting library: two chart shapes drawn as SVG, which keeps the page
   inside script-src 'self' with nothing to pin or update.

   Traffic and enquiries are two separate charts rather than one chart with two
   y-axes. Pageviews run in the hundreds and enquiries in single digits, and any
   shared scale would either flatten the enquiries to nothing or exaggerate them
   into a lie. They share an x-range instead.
   ============================================================================= */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const el = (tag, attrs = {}) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const num = (n) => Number(n || 0).toLocaleString();
  const shortDay = (d) => {
    const [, m, day] = d.split('-');
    return `${Number(day)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1]}`;
  };

  const statusEl = $('#status');
  const tilesEl = $('#tiles');
  const panelsEl = $('#panels');
  let current = null;
  let days = 30;

  /* ---- Load ---------------------------------------------------------------- */
  async function load() {
    statusEl.hidden = false;
    statusEl.textContent = 'Loading…';
    try {
      const res = await fetch(`/api/stats?days=${days}`, { headers: { Accept: 'application/json' } });
      if (res.status === 401) { location.reload(); return; }   // session expired -> sign-in gate
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      current = await res.json();
      statusEl.hidden = true;
      tilesEl.hidden = false;
      panelsEl.hidden = false;
      render();
    } catch (err) {
      statusEl.hidden = false;
      statusEl.textContent = `Could not load the numbers — ${err.message}. Reload to try again.`;
    }
  }

  /* ---- Tiles --------------------------------------------------------------- */
  function renderTiles(t) {
    const tiles = [
      { k: 'Pageviews', v: num(t.pageviews) },
      { k: 'Visitors', v: num(t.visits), n: 'counted once per day' },
      { k: 'Enquiries', v: num(t.leads), cls: 'tile--lead' },
      { k: 'Enquiry rate', v: `${t.lead_rate}%`, n: 'per 100 pageviews' },
      { k: 'Phone taps', v: num(t.phone_clicks) },
      { k: 'Portal visits', v: num(t.portal_clicks) },
    ];
    tilesEl.replaceChildren(...tiles.map((d) => {
      const div = document.createElement('div');
      div.className = 'tile' + (d.cls ? ' ' + d.cls : '');
      const k = document.createElement('div'); k.className = 'tile__k'; k.textContent = d.k;
      const v = document.createElement('div'); v.className = 'tile__v'; v.textContent = d.v;
      div.append(k, v);
      if (d.n) { const n = document.createElement('div'); n.className = 'tile__n'; n.textContent = d.n; div.append(n); }
      return div;
    }));
  }

  /* ---- Shared chart frame -------------------------------------------------- */
  const PAD = { l: 42, r: 46, t: 14, b: 22 };

  function frame(host, height) {
    const width = Math.max(host.clientWidth || 640, 280);
    const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
    return { svg, width, height, iw: width - PAD.l - PAD.r, ih: height - PAD.t - PAD.b };
  }

  // Grid lines and y labels. Recessive on purpose — the marks are the subject.
  function yAxis(f, max, ticks = 4) {
    for (let i = 0; i <= ticks; i++) {
      const v = Math.round((max / ticks) * i);
      const y = PAD.t + f.ih - (max ? (v / max) * f.ih : 0);
      f.svg.append(el('line', { class: 'grid-line', x1: PAD.l, x2: PAD.l + f.iw, y1: y, y2: y }));
      const label = el('text', { class: 'axis-text', x: PAD.l - 8, y: y + 3, 'text-anchor': 'end' });
      label.textContent = v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v;
      f.svg.append(label);
    }
  }

  function xLabels(f, rows) {
    if (!rows.length) return;
    const step = Math.max(1, Math.ceil(rows.length / 6));
    rows.forEach((r, i) => {
      if (i % step && i !== rows.length - 1) return;
      const x = PAD.l + (rows.length === 1 ? f.iw / 2 : (i / (rows.length - 1)) * f.iw);
      const t = el('text', { class: 'axis-text', x, y: f.height - 6, 'text-anchor': 'middle' });
      t.textContent = shortDay(r.day);
      f.svg.append(t);
    });
  }

  /* ---- Tooltip ------------------------------------------------------------- */
  function tooltip(host) {
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    host.append(tip);
    return {
      show(x, y, day, rows) {
        tip.replaceChildren();
        const d = document.createElement('div'); d.className = 'day'; d.textContent = shortDay(day);
        tip.append(d);
        for (const r of rows) {
          const line = document.createElement('div'); line.className = 'row';
          if (r.sw) { const i = document.createElement('i'); i.className = r.sw; line.append(i); }
          const b = document.createElement('b'); b.textContent = num(r.value);
          line.append(b, document.createTextNode(' ' + r.label));
          tip.append(line);
        }
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
        tip.hidden = false;
      },
      hide() { tip.hidden = true; },
    };
  }

  /* ---- Traffic: two lines on one scale ------------------------------------- */
  function renderTraffic(rows) {
    const host = $('#chart-traffic');
    host.replaceChildren();
    if (!rows.length) { host.innerHTML = '<p class="empty">Nothing recorded yet.</p>'; return; }

    const f = frame(host, 210);
    const max = Math.max(4, ...rows.map((r) => Math.max(r.pageviews || 0, r.visits || 0)));
    yAxis(f, max);
    xLabels(f, rows);

    const xAt = (i) => PAD.l + (rows.length === 1 ? f.iw / 2 : (i / (rows.length - 1)) * f.iw);
    const yAt = (v) => PAD.t + f.ih - (v / max) * f.ih;

    const series = [
      { key: 'pageviews', colour: 'var(--s1)', sw: 'sw1', label: 'pageviews' },
      { key: 'visits', colour: 'var(--s2)', sw: 'sw2', label: 'visitors' },
    ];

    for (const s of series) {
      const d = rows.map((r, i) => `${i ? 'L' : 'M'}${xAt(i)} ${yAt(r[s.key] || 0)}`).join(' ');
      f.svg.append(el('path', { class: 'series-line', d, stroke: s.colour }));

      // Direct label on the final point, so identity never rests on colour alone.
      const last = rows.length - 1;
      f.svg.append(el('circle', { class: 'series-dot', cx: xAt(last), cy: yAt(rows[last][s.key] || 0), fill: s.colour }));
      const t = el('text', { class: 'end-label', x: xAt(last) + 9, y: yAt(rows[last][s.key] || 0) + 4 });
      t.setAttribute('fill', 'currentColor');   // text tokens, not the series colour
      t.textContent = num(rows[last][s.key]);
      f.svg.append(t);
    }

    const cross = el('line', { class: 'crosshair', y1: PAD.t, y2: PAD.t + f.ih, x1: 0, x2: 0, opacity: 0 });
    f.svg.append(cross);
    host.append(f.svg);
    const tip = tooltip(host);

    const hit = el('rect', { class: 'hit', x: PAD.l, y: PAD.t, width: f.iw, height: f.ih });
    f.svg.append(hit);

    const at = (evt) => {
      const box = f.svg.getBoundingClientRect();
      const rel = ((evt.clientX - box.left) / box.width) * f.width;
      const i = Math.max(0, Math.min(rows.length - 1,
        Math.round(((rel - PAD.l) / f.iw) * (rows.length - 1))));
      cross.setAttribute('x1', xAt(i)); cross.setAttribute('x2', xAt(i)); cross.setAttribute('opacity', 1);
      tip.show(xAt(i) * (box.width / f.width), yAt(max) * (box.height / f.height) + 4, rows[i].day,
        series.map((s) => ({ sw: s.sw, label: s.label, value: rows[i][s.key] || 0 })));
    };
    hit.addEventListener('pointermove', at);
    hit.addEventListener('pointerdown', at);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.hide(); });
  }

  /* ---- Enquiries: bars on their own scale ---------------------------------- */
  function renderLeads(rows) {
    const host = $('#chart-leads');
    host.replaceChildren();
    const total = rows.reduce((a, r) => a + (r.leads || 0), 0);
    $('#lead-note').textContent = total
      ? `${num(total)} in this period`
      : 'none in this period';
    if (!rows.length) { host.innerHTML = '<p class="empty">Nothing recorded yet.</p>'; return; }

    const f = frame(host, 150);
    const max = Math.max(2, ...rows.map((r) => r.leads || 0));
    yAxis(f, max, 2);
    xLabels(f, rows);

    // 2px of surface between neighbours, and a floor so a zero day still has a
    // target to hover.
    const slot = f.iw / rows.length;
    const w = Math.max(3, slot - 2);
    const tip = tooltip(host);
    host.append(f.svg);

    rows.forEach((r, i) => {
      const v = r.leads || 0;
      const h = (v / max) * f.ih;
      const x = PAD.l + i * slot + (slot - w) / 2;
      if (v > 0) {
        f.svg.append(el('rect', {
          class: 'bar', x, y: PAD.t + f.ih - h, width: w, height: h, fill: 'var(--s1)',
        }));
      }
      const hit = el('rect', { class: 'hit', x, y: PAD.t, width: w, height: f.ih });
      f.svg.append(hit);
      const show = () => {
        const box = f.svg.getBoundingClientRect();
        tip.show((x + w / 2) * (box.width / f.width),
                 (PAD.t + f.ih - h) * (box.height / f.height),
                 r.day, [{ label: v === 1 ? 'enquiry' : 'enquiries', value: v }]);
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', tip.hide);
    });
  }

  /* ---- Tables -------------------------------------------------------------- */
  /* rows are {k: label, v: value} — one shape for every table on the page. */
  function table(hostSel, rows, cols) {
    const host = $(hostSel);
    host.replaceChildren();
    if (!rows || !rows.length) {
      const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nothing yet.';
      host.append(p); return;
    }
    const max = Math.max(...rows.map((r) => r.v || 0)) || 1;
    const t = document.createElement('table'); t.className = 'tbl';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    cols.forEach((c) => { const th = document.createElement('th'); th.textContent = c; hr.append(th); });
    thead.append(hr);
    const tb = document.createElement('tbody');
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.className = 'meter';
      // CSSOM, not a style attribute — the CSP allows this and forbids that.
      td1.style.setProperty('--w', `${Math.round(((r.v || 0) / max) * 100)}%`);
      const span = document.createElement('span');
      span.className = 'name';
      const label = String(r.k ?? '—');
      span.textContent = label;
      span.title = label;
      td1.append(span);
      const td2 = document.createElement('td');
      td2.textContent = num(r.v);
      tr.append(td1, td2);
      tb.append(tr);
    });
    t.append(thead, tb);
    host.append(t);
  }

  const EVENT_NAMES = {
    tour_request: 'Enquiry sent', phone_click: 'Phone tapped', portal_click: 'Resident portal',
    plan_view: 'Floor plan filtered', gallery_open: 'Photo opened', map_click: 'Map opened',
    outbound: 'Left the site',
  };

  function render() {
    const d = current;
    renderTiles(d.totals);
    renderTraffic(d.daily);
    renderLeads(d.daily);

    table('#t-pages', d.pages.map((r) => ({ k: r.path, v: r.views })), ['Page', 'Views']);
    table('#t-refs', d.referrers.map((r) => ({ k: r.ref, v: r.views })), ['Source', 'Views']);
    table('#t-plans', d.plans.map((r) => ({ k: r.plan, v: r.count })), ['Plan', 'Times']);
    table('#t-events', d.events.map((r) => ({ k: EVENT_NAMES[r.kind] || r.kind, v: r.count })), ['Action', 'Count']);
    table('#t-devices', d.devices.map((r) => ({ k: r.device, v: r.views })), ['Device', 'Views']);
    table('#t-countries', d.countries.map((r) => ({ k: r.country, v: r.views })), ['Country', 'Views']);
  }

  /* ---- Enquiries -----------------------------------------------------------
     Every value below is something a stranger typed into a form on the public
     internet, so it reaches the page through textContent and never innerHTML.
     The panel is above Traffic because this is what a leasing team opens the
     dashboard to see. */
  let leadScope = 'open';

  const INTEREST = {
    tour: 'Wants a tour', availability: 'Asking availability',
    pricing: 'Asking pricing', question: 'General question',
  };
  const PLAN = { 1: 'One bedroom', 2: 'Two bedroom', 3: 'Three bedroom' };
  const SOURCE = {
    search: 'Search', listing: 'Listing site', social: 'Social',
    walkby: 'Walked by', referral: 'Referral',
  };

  /** "3 minutes ago" down to the day, then a date. Leasing is a same-day game;
   *  "22 Sep" is no use when what matters is whether this came in over lunch. */
  function ago(ts) {
    const secs = Math.floor(Date.now() / 1000) - ts;
    if (secs < 90) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const d = Math.round(hrs / 24);
    if (d <= 6) return `${d} day${d === 1 ? '' : 's'} ago`;
    return new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function leadCard(r) {
    const card = document.createElement('article');
    card.className = 'lead' + (r.handled ? ' lead--done' : '');

    const head = document.createElement('div');
    head.className = 'lead__head';

    const who = document.createElement('h3');
    who.className = 'lead__who';
    who.textContent = `${r.first_name} ${r.last_name}`.trim();
    head.append(who);

    if (r.interest) {
      const tag = document.createElement('span');
      tag.className = 'lead__tag';
      tag.textContent = INTEREST[r.interest] || r.interest;
      head.append(tag);
    }

    const when = document.createElement('time');
    when.className = 'lead__when';
    when.dateTime = new Date(r.ts * 1000).toISOString();
    when.textContent = ago(r.ts);
    when.title = new Date(r.ts * 1000).toLocaleString();
    head.append(when);
    card.append(head);

    // Tappable on a phone, which is where a leasing agent reads this.
    const contact = document.createElement('p');
    contact.className = 'lead__contact';
    const mail = document.createElement('a');
    mail.href = `mailto:${encodeURIComponent(r.email)}`;
    mail.textContent = r.email;
    contact.append(mail);
    if (r.phone) {
      contact.append(document.createTextNode(' \u00b7 '));
      const tel = document.createElement('a');
      tel.href = `tel:${String(r.phone).replace(/[^0-9+]/g, '')}`;
      tel.textContent = r.phone;
      contact.append(tel);
    }
    card.append(contact);

    const facts = [
      r.plan && `Wants ${PLAN[r.plan] || r.plan}`,
      r.move_in && `Moving ${r.move_in}`,
      r.source && `Found us: ${SOURCE[r.source] || r.source}`,
    ].filter(Boolean);
    if (facts.length) {
      const meta = document.createElement('p');
      meta.className = 'lead__meta';
      meta.textContent = facts.join(' \u00b7 ');
      card.append(meta);
    }

    if (r.message) {
      const msg = document.createElement('p');
      msg.className = 'lead__msg';
      msg.textContent = r.message;      // never innerHTML: this is their text
      card.append(msg);
    }

    const foot = document.createElement('div');
    foot.className = 'lead__foot';

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'ghost';
    done.textContent = r.handled ? 'Reopen' : 'Mark handled';
    done.addEventListener('click', async () => {
      done.disabled = true;
      try {
        const res = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: r.id, handled: r.handled ? 0 : 1 }),
        });
        if (res.status === 401) { location.reload(); return; }
        if (!res.ok) throw new Error();
        loadLeads();
      } catch {
        done.disabled = false;
        done.textContent = 'Could not save — retry';
      }
    });
    foot.append(done);

    if (!r.notified) {
      const flag = document.createElement('span');
      flag.className = 'lead__flag';
      flag.textContent = 'No email sent';
      flag.title = 'Saved here, but the notification email did not go out.';
      foot.append(flag);
    }
    card.append(foot);
    return card;
  }

  async function loadLeads() {
    const host = $('#leads');
    const warn = $('#lead-warn');
    try {
      const qs = leadScope === 'all' ? '?all=1&limit=200' : '?limit=200';
      const res = await fetch(`/api/inquiries${qs}`, { headers: { Accept: 'application/json' } });
      if (res.status === 401) { location.reload(); return; }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const d = await res.json();

      host.replaceChildren();
      if (!d.inquiries.length) {
        const p = document.createElement('p');
        p.className = 'empty';
        p.textContent = leadScope === 'all'
          ? 'No enquiries yet.'
          : 'Nothing waiting — every enquiry has been handled.';
        host.append(p);
      } else {
        const list = document.createElement('div');
        list.className = 'leads';
        d.inquiries.forEach((r) => list.append(leadCard(r)));
        host.append(list);
      }

      // The only place anyone learns that email delivery is broken: to the
      // visitor a lead that was stored but not emailed looks like success.
      if (d.unnotified > 0) {
        warn.hidden = false;
        warn.textContent = `${d.unnotified} enquir${d.unnotified === 1 ? 'y was' : 'ies were'} saved without a notification email going out. `
          + 'The leads are safe here, but check RESEND_API_KEY and LEAD_TO on the Pages project.';
      } else {
        warn.hidden = true;
      }
    } catch (err) {
      host.replaceChildren();
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = `Could not load the enquiries — ${err.message}.`;
      host.append(p);
    }
  }

  document.querySelectorAll('.seg [data-leads]').forEach((btn) => {
    btn.addEventListener('click', () => {
      leadScope = btn.dataset.leads;
      document.querySelectorAll('.seg [data-leads]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === btn)));
      loadLeads();
    });
  });

  /* ---- Controls ------------------------------------------------------------ */
  document.querySelectorAll('.seg [data-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      days = Number(btn.dataset.days);
      document.querySelectorAll('.seg [data-days]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === btn)));
      load();
    });
  });

  $('#signout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  // Charts are drawn at real pixel size rather than scaled, so they need a
  // redraw when the column width changes.
  let t = null;
  window.addEventListener('resize', () => {
    if (!current) return;
    clearTimeout(t);
    t = setTimeout(render, 150);
  });

  load();
  loadLeads();
})();
