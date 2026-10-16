/* =============================================================================
   The lobby TV (/lobby/). Photographs of Rochester and the building, three
   upcoming events at a time, the time and weather, and a ticker of building
   notices and local headlines.

   It runs unattended: /api/lobby is read every ten minutes, the last good copy
   is kept in case the network drops, and the page reloads itself every six
   hours to pick up any change to this file.
   ============================================================================= */
(() => {
  'use strict';
  const TZ = 'America/New_York';
  const PHOTO_MS = 11000;
  const EVENTS_MS = 16000;
  const REFRESH_MS = 10 * 60 * 1000;
  const RELOAD_MS = 6 * 60 * 60 * 1000;

  // Rochester, from Wikimedia Commons; the licences ask for the credit on screen.
  const CITY = [
    ['high-falls-sunset', 'High Falls from the Pont de Rennes Bridge', 'Blbrett', 'CC BY-SA 4.0'],
    ['downtown-dawn', 'Downtown Rochester at dawn', 'DanielPenfield', 'CC BY-SA 4.0'],
    ['lilac-festival', 'The Lilac Festival in Highland Park', 'Matthew D. Wilson', 'CC BY-SA 2.5'],
    ['genesee-river', 'Downtown from the Genesee River', 'Dominic Sherony', 'CC BY-SA 2.0'],
    ['eastman-theatre-night', 'The Eastman Theatre, before the show', 'DanielPenfield', 'CC BY-SA 4.0'],
    ['high-falls-park', 'High Falls', 'Lew from Campbell, CA', 'CC BY 2.0'],
    ['durand-eastman-fall', 'Autumn in Durand Eastman Park', 'DanielPenfield', 'CC BY-SA 4.0'],
    ['rochester-night', 'Rochester at night', 'Maximilian Kapitonoff', 'CC BY 2.0'],
    ['lilacs', 'Lilacs in Highland Park', 'LtPowers', 'CC BY-SA 3.0'],
    ['high-falls-day', 'High Falls and the city', 'Evilarry', 'Public domain'],
    ['memorial-art-gallery', 'The Memorial Art Gallery', 'DanielPenfield', 'CC BY-SA 3.0'],
    ['charlotte-lighthouse', 'The Charlotte-Genesee Lighthouse', 'Matthew D. Wilson', 'CC BY-SA 3.0'],
    ['genesee-skyline', 'The Genesee River downtown', 'Evilarry', 'Public domain'],
    ['eastman-theatre', 'The Eastman Theatre', 'Matthew D. Wilson', 'CC BY-SA 2.5'],
    ['durand-eastman-spring', 'Spring in Durand Eastman Park', 'DanielPenfield', 'CC BY-SA 4.0'],
    ['high-falls-night', 'High Falls at night', 'Evilarry', 'Public domain'],
  ].map(([f, caption, by, lic]) => ({ src: `../assets/img/lobby/${f}.jpg`, caption,
    credit: `Photo: ${by} · ${lic}${lic === 'Public domain' ? '' : ' · Wikimedia Commons'}` }));
  const HOME = [
    ['hero-aerial', 'Charlotte Square and the East End'],
    ['hero-terrace', 'The shared terrace'],
    ['pocket-park-summer', 'The pocket park on Charlotte Street'],
    ['hero-exterior', '50 Charlotte Square'],
  ].map(([f, caption]) => ({ src: `../assets/img/${f}.jpg`, caption, credit: '' }));

  const slidesEl = document.querySelector('[data-slides]');
  const timeEl = document.querySelector('[data-time]');
  const dateEl = document.querySelector('[data-date]');
  const weatherEl = document.querySelector('[data-weather]');
  const tickerEl = document.querySelector('[data-ticker]');

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ---- Time ---------------------------------------------------------------- */
  const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const tickClock = () => { const d = new Date(); timeEl.textContent = fmtTime.format(d); dateEl.textContent = fmtDate.format(d); };
  tickClock();
  setInterval(tickClock, 10000);

  /* ---- Data ---------------------------------------------------------------- */
  let data = null;
  try { data = JSON.parse(localStorage.getItem('lobby') || 'null'); } catch (e) { /* none yet */ }

  async function load() {
    try {
      const r = await fetch('/api/lobby', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!r.ok) return;
      data = await r.json();
      try { localStorage.setItem('lobby', JSON.stringify(data)); } catch (e) { /* storage full or off */ }
      paintWeather();
      queueTicker();
    } catch (e) { /* keep what is on screen */ }
  }

  function paintWeather() {
    const w = data && data.weather;
    weatherEl.textContent = '';
    if (!w) return;
    weatherEl.append(el('b', null, `${w.temp}°`), document.createTextNode(w.summary || ''));
  }

  /* ---- Ticker: notices, then headlines, scrolling forever ------------------ */
  let pendingTicker = false;
  function tickerItems() {
    const out = [];
    for (const n of (data && data.notices) || []) out.push(['notice', n]);
    for (const h of (data && data.news) || []) out.push(['news', h]);
    return out;
  }
  function buildTicker() {
    const items = tickerItems();
    tickerEl.classList.remove('is-moving');
    tickerEl.textContent = '';
    if (!items.length) return;
    // Two copies end to end, so the loop is seamless at -50%.
    for (let copy = 0; copy < 2; copy++) {
      items.forEach(([kind, text]) => {
        tickerEl.append(el('span', `ticker__item${kind === 'notice' ? ' ticker__item--notice' : ''}`, text), el('span', 'ticker__sep', '◆'));
      });
      if (data && data.news && data.news.length) tickerEl.append(el('span', 'ticker__credit', 'Headlines: RochesterFirst.com'), el('span', 'ticker__sep', '◆'));
    }
    const px = tickerEl.scrollWidth / 2;
    const speed = window.innerWidth / 14;   // a screen's width every fourteen seconds
    tickerEl.style.setProperty('--tick', `${Math.max(20, px / speed)}s`);
    void tickerEl.offsetWidth;
    tickerEl.classList.add('is-moving');
  }
  // New headlines wait for the end of a loop, so the ticker never jumps.
  function queueTicker() {
    if (!tickerEl.classList.contains('is-moving')) { buildTicker(); return; }
    pendingTicker = true;
  }
  tickerEl.addEventListener('animationiteration', () => { if (pendingTicker) { pendingTicker = false; buildTicker(); } });

  /* ---- Slides --------------------------------------------------------------- */
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const parts = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  function when(e) {
    const s = parts(e.start);
    if (!e.end || e.end === e.start) return `${DOW[s.dow]}, ${MON[s.m - 1]} ${s.d}`;
    const t = parts(e.end);
    if (e.start <= today()) return `Through ${MON[t.m - 1]} ${t.d}`;
    return s.m === t.m ? `${MON[s.m - 1]} ${s.d} – ${t.d}` : `${MON[s.m - 1]} ${s.d} – ${MON[t.m - 1]} ${t.d}`;
  }

  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

  // One pass: a welcome, then two photographs to every three events, with the
  // building's own photographs spread through the city's.
  function playlist() {
    const photos = shuffle(CITY);
    shuffle(HOME).forEach((p, i) => photos.splice(Math.min(photos.length, 3 + i * 5), 0, p));
    const events = (data && data.events) || [];
    const groups = [];
    for (let i = 0; i < events.length && groups.length < 6; i += 3) groups.push(events.slice(i, i + 3));
    const list = [{ type: 'welcome', photo: HOME[0] }];
    let g = 0;
    photos.forEach((p, i) => {
      list.push({ type: 'photo', photo: p });
      if (i % 2 === 1 && g < groups.length) list.push({ type: 'events', events: groups[g++], photo: photos[(i + 5) % photos.length] });
    });
    return list;
  }

  function img(src, cls) {
    const i = el('img', cls);
    i.alt = '';
    i.decoding = 'async';
    i.src = src;
    return i;
  }

  function render(item) {
    const s = el('div', `slide slide--${item.type}`);
    s.append(img(item.photo.src, 'slide__img'));
    if (item.type === 'photo') {
      const c = el('div', 'caption');
      c.append(el('div', 'caption__title', item.photo.caption));
      if (item.photo.credit) c.append(el('div', 'caption__credit', item.photo.credit));
      s.append(c);
    } else if (item.type === 'welcome') {
      const w = el('div', 'welcome');
      const t = el('h1', 'welcome__title');
      t.append('Welcome home.');
      w.append(el('div', 'welcome__eyebrow', '50 Charlotte Square · Rochester’s East End'), t);
      s.append(w);
    } else {
      const box = el('div', 'events');
      const title = el('h2', 'events__title');
      title.append('Happening in ', el('i', null, 'Rochester'));
      const grid = el('div', 'events__grid');
      item.events.forEach((e) => {
        const card = el('article', 'event');
        if (e.image) card.append(img(e.image, 'event__img'));
        else card.append(el('div', 'event__img event__img--none', 'Rochester'));
        const body = el('div', 'event__body');
        body.append(el('div', 'event__when', when(e)), el('div', 'event__name', e.title));
        if (e.blurb) body.append(el('div', 'event__blurb', e.blurb));
        card.append(body);
        grid.append(card);
      });
      box.append(el('div', 'events__eyebrow', 'Coming up'), title, grid, el('div', 'events__credit', 'Events from VisitRochester.com'));
      s.append(box);
    }
    return s;
  }

  // Load a slide's pictures before it is shown, but never wait more than 8s.
  const ready = (node) => Promise.race([
    Promise.all([...node.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = ok; i.onerror = ok; })))),
    new Promise((ok) => setTimeout(ok, 8000)),
  ]);

  let list = [];
  let at = 0;
  async function next() {
    if (at >= list.length) { list = playlist(); at = 0; }
    const item = list[at++];
    const dur = item.type === 'events' ? EVENTS_MS : PHOTO_MS;
    const node = render(item);
    node.style.setProperty('--dur', `${dur + 2000}ms`);
    slidesEl.append(node);
    await ready(node);
    // The old slide's words fade out first, then the pictures crossfade, then
    // the new words come in (see lobby.css), so two captions never overlap.
    const old = [...slidesEl.children].filter((n) => n !== node);
    old.forEach((n) => n.classList.add('is-leaving'));
    setTimeout(() => requestAnimationFrame(() => node.classList.add('is-on')), old.length ? 500 : 0);
    setTimeout(() => old.forEach((n) => n.remove()), 2600);
    setTimeout(next, dur);
  }

  paintWeather();
  buildTicker();
  load().finally(() => { list = playlist(); next(); });
  setInterval(load, REFRESH_MS);
  // Reload only when the site answers, so a dropped connection never leaves a blank screen.
  setInterval(() => {
    fetch('/lobby/', { method: 'HEAD', cache: 'no-store' }).then((r) => { if (r.ok) location.reload(); }).catch(() => {});
  }, RELOAD_MS);
})();
