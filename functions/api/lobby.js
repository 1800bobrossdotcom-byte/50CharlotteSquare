/* =============================================================================
   GET /api/lobby — what the lobby screen (/lobby/) shows, besides its photos:
   upcoming Rochester events, local headlines for the ticker, and the weather.

     events   Visit Rochester's public events feed
     news     RochesterFirst's community feed, with crime and tragedy left out:
              this plays in a lobby, all day
     weather  the National Weather Service, for downtown Rochester

   Fetched here rather than by the screen, so the TV makes one request to one
   site. Kept fifteen minutes in Cloudflare's cache, and the last good copy of
   each part in D1, so a source that is down leaves the screen as it was
   rather than empty.
   ============================================================================= */

const UA = { 'User-Agent': '(charlottesquareroc.com, lobby screen)' };
const EVENTS_FEED = 'https://www.visitrochester.com/event/rss/';
const NEWS_FEED = 'https://www.rochesterfirst.com/community/feed/';
const FORECAST = 'https://api.weather.gov/gridpoints/BUF/77,65/forecast';
const HOURLY = 'https://api.weather.gov/gridpoints/BUF/77,65/forecast/hourly';
const TTL = 15 * 60;

// Notices from the building, shown first in the ticker. Edit here.
const NOTICES = [
  'Welcome to 50 Charlotte Square',
  'Leasing office: (585) 748-5588',
];

// Not for a lobby: headlines about violence, crime, accidents, illness or loss.
const UNSUITABLE = /\b(kill(s|ed|ing)?|shoot(s|ing)?|shot|gun(s|man|fire)?|murder\w*|homicide|dead|death|dies|died|fatal\w*|crash\w*|collision|police|arrest\w*|charged|indict\w*|court|sentenc\w*|trial|prison|jail|detain\w*|deport\w*|stab\w*|assault\w*|abuse\w*|fire|blaze|cancer|loss|lost|victim\w*|missing|overdose\w*|crime\w*|robber\w*|theft|lawsuit|sued|injur\w*|hospital\w*|emergency|threat\w*|protest\w*|rally|war|attack\w*)\b/i;

const json = (data, headers = {}) => new Response(JSON.stringify(data), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const text = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml); return m ? m[1] : ''; };
const items = (xml) => [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

// Each source gets eight seconds, so a slow one cannot hold up the screen.
async function get(url, accept) {
  const res = await fetch(url, { headers: { ...UA, Accept: accept }, cf: { cacheTtl: 600 }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return accept.includes('json') ? res.json() : res.text();
}

// Shorten at a word. The feed cuts its own descriptions off mid-sentence, so
// anything that doesn't end a sentence gets an ellipsis.
const clip = (s, n) => {
  const t = s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '');
  return /[.!?…"”')]$/.test(t) ? t : `${t.replace(/[\s,;:–-]+$/, '')}…`;
};
const day = (m, d, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Upcoming events, soonest first: today's and this week's, then a few of the
    long-running shows and exhibitions. Undated listings ("ongoing") are left out. */
async function events() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());   // Rochester's date, YYYY-MM-DD
  const seen = new Set();
  const out = [];
  for (const it of items(await get(EVENTS_FEED, 'application/rss+xml, text/xml'))) {
    const title = text(tag(it, 'title')).replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
      .replace(/^new exhibition\s*[-–:]\s*/i, '').trim();
    const desc = decode(tag(it, 'description'));
    const range = /(\d{2})\/(\d{2})\/(\d{4})\s+to\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(desc);
    if (!title || !range || seen.has(title.toLowerCase())) continue;
    const start = day(range[1], range[2], range[3]);
    const end = day(range[4], range[5], range[6]);
    if (end < today) continue;
    seen.add(title.toLowerCase());
    const img = /<img[^>]+src=['"]([^'"]+)['"]/.exec(desc);
    const para = /<p>([\s\S]*?)<\/p>/.exec(desc);
    out.push({
      title, start, end,
      // When it is next on, and for how many days from then.
      from: start > today ? start : today,
      days: (Date.parse(end) - Date.parse(start > today ? start : today)) / 864e5,
      blurb: para ? clip(text(para[1]).replace(/\S*(?:https?:\/\/|www\.|\.(?:com|org|net)\/)\S*/gi, '').replace(/\s+/g, ' ').trim(), 220) : '',
      // Ask the image service for a size that holds up on a TV.
      image: img && /^https:\/\/assets\.simpleviewinc\.com\//.test(img[1])
        ? img[1].replace(/c_fill,h_\d+,q_\d+,w_\d+/, 'c_fill,h_540,q_80,w_810') : null,
    });
  }
  const order = (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.days - b.days);
  const soon = out.filter((e) => e.days <= 14).sort(order);
  const long = out.filter((e) => e.days > 14).sort(order);
  return [...soon.slice(0, 18), ...long.slice(0, 6)]
    .map(({ from, days, ...e }) => e);
}

async function news() {
  const out = [];
  for (const it of items(await get(NEWS_FEED, 'application/rss+xml, text/xml'))) {
    const title = text(tag(it, 'title'));
    if (title && !UNSUITABLE.test(title)) out.push(title);
  }
  return out.slice(0, 14);
}

async function weather() {
  const [hourly, daily] = await Promise.all([get(HOURLY, 'application/geo+json'), get(FORECAST, 'application/geo+json')]);
  const now = hourly.properties.periods[0];
  const next = daily.properties.periods.slice(0, 2).map((p) => ({ name: p.name, temp: p.temperature, summary: p.shortForecast }));
  return { temp: now.temperature, unit: now.temperatureUnit, summary: now.shortForecast, day: now.isDaytime, next };
}

async function lastGood(env) {
  try {
    const row = await env.DB.prepare('SELECT body FROM rm_cache WHERE key = ?').bind('lobby').first();
    return row ? JSON.parse(row.body) : {};
  } catch { return {}; }
}

async function keep(env, data) {
  try {
    await env.DB.prepare(
      `INSERT INTO rm_cache (key, ts, body) VALUES ('lobby', ?, ?)
       ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, body = excluded.body`,
    ).bind(Math.floor(Date.now() / 1000), JSON.stringify(data)).run();
  } catch { /* the cache still has it */ }
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/lobby', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return json(await hit.json(), { 'Cache-Control': 'no-store' });

  const [ev, nw, wx] = await Promise.all([events(), news(), weather()].map((p) => p.catch(() => null)));
  const prev = env.DB ? await lastGood(env) : {};
  const data = {
    updated: Math.floor(Date.now() / 1000),
    notices: NOTICES,
    events: ev && ev.length ? ev : prev.events || [],
    news: nw && nw.length ? nw : prev.news || [],
    weather: wx || prev.weather || null,
    sources: { events: Boolean(ev), news: Boolean(nw), weather: Boolean(wx) },
  };
  if (env.DB && (ev || nw || wx)) waitUntil(keep(env, data));
  waitUntil(cache.put(key, json(data, { 'Cache-Control': `public, max-age=${TTL}` })));
  return json(data, { 'Cache-Control': 'no-store' });
}
