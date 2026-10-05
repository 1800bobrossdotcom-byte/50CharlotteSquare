/* =============================================================================
   Rent Manager — the open units at Charlotte Square, read from Evolution24's
   Rent Manager through its Web API (WAPI12), so the site lists what is
   actually available instead of "Pricing on request".

   Read only, and only unit details: the unit's number, bedrooms, baths, size,
   rent and when it is available. Nothing about a resident, a lease or a
   payment is asked for, kept or shown.

   Settings, in the Worker's Variables and Secrets in Cloudflare:
     RM_USERNAME, RM_PASSWORD   the website's own Rent Manager user (secrets)
     RM_COMPANY                 optional: the company code in Rent Manager's web
                                addresses; "evolution" (evolution.twa.rentmanager.com)
     RM_LOCATION_ID             optional: only for a company with several locations
     RM_PROPERTY_ID             optional: Charlotte Square is property 12, as in the
                                old site's Apply links
     RM_BASE_URL                only for local tests, which point it at a stub

   Rent Manager limits API calls per hour for the whole company, and the X-Rate
   headers on every reply say how many are left. So visitors never cause a
   call: a schedule (crons in wrangler.toml) fetches the list into D1 and the
   site reads that copy, which also keeps the list up if Rent Manager is down.

   How the units are read is two steps, because Rent Manager's field reference
   is behind a login. "Check connection" on the dashboard signs in and records
   what a unit looks like (field names and types, never resident data); the
   normalizer below reads those fields. The list reaches the site only after
   someone switches on "Show on website" on the dashboard.
   ============================================================================= */
import { leadTo, sendEmail } from './email.js';

const DEFAULT_COMPANY = 'evolution';
const DEFAULT_PROPERTY = 12;
const STALE_AFTER = 24 * 3600;       // an older list is not shown: it would mislead

export const rmConfigured = (env) => Boolean(env.RM_USERNAME && env.RM_PASSWORD);
export const company = (env) => String(env.RM_COMPANY || DEFAULT_COMPANY).trim().toLowerCase();
export const propertyId = (env) => Number.parseInt(env.RM_PROPERTY_ID || DEFAULT_PROPERTY, 10);
const apiBase = (env) => String(env.RM_BASE_URL || `https://${company(env)}.api.rentmanager.com`).replace(/\/+$/, '');

/** Rent Manager's own application for one unit, as the old site linked it. */
export const applyUrl = (env, unitId) =>
  `https://${company(env)}.twa.rentmanager.com/ApplyNow?locations=&unitID=${encodeURIComponent(unitId)}`;

export class RMError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

/* ---- Talking to Rent Manager ------------------------------------------------ */
function rateFrom(res) {
  const n = (h) => { const v = res.headers.get(h); return v == null || v === '' ? null : Number(v); };
  return { limit: n('X-RateLimit'), remaining: n('X-RateRemaining'), resetIn: n('X-RateTimeLeft') };
}

async function call(env, path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-RM12Api-ApiToken'] = token;
  let res;
  try {
    res = await fetch(apiBase(env) + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new RMError(`Rent Manager could not be reached (${err.message}).`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const total = res.headers.get('X-Total-Results');
  return { status: res.status, ok: res.ok, data, rate: rateFrom(res), total: total == null ? null : Number(total) };
}

/** What went wrong, in words the dashboard can show as they are. */
function explain(r, what) {
  const said = r.data && typeof r.data === 'object' ? (r.data.UserMessage || r.data.Message || r.data.DeveloperMessage || '') : '';
  const tail = said ? ` Rent Manager said: "${String(said).slice(0, 200)}"` : '';
  if (r.status === 401) return `Rent Manager did not accept the login. Check RM_USERNAME and RM_PASSWORD in Cloudflare, that the user has Web API access, and, if the company has more than one location, RM_LOCATION_ID.${tail}`;
  if (r.status === 403) return `The website's Rent Manager user is not allowed to read ${what}. Give it read access to properties and units.${tail}`;
  if (r.status === 404) return `Rent Manager found no ${what} for this user. Check the property number (RM_PROPERTY_ID, now ${'{pid}'}) and that the user can see that property.${tail}`;
  if (r.status === 429) return 'Rent Manager’s hourly limit on API calls is used up. The next scheduled refresh will try again.';
  if (r.status >= 500) return `Rent Manager had a problem answering (${r.status}). The next scheduled refresh will try again.${tail}`;
  return `Rent Manager answered ${r.status} when asked for ${what}.${tail}`;
}

export async function authorize(env) {
  const body = { Username: env.RM_USERNAME, Password: env.RM_PASSWORD };
  if (env.RM_LOCATION_ID) body.LocationID = Number(env.RM_LOCATION_ID);
  const r = await call(env, '/Authentication/AuthorizeUser', { method: 'POST', body });
  if (!r.ok) throw new RMError(explain(r, 'a login'), r.status);
  const token = typeof r.data === 'string' ? r.data
    : r.data && (r.data.Token || r.data.ApiToken || r.data.APIToken || r.data.token);
  if (!token) throw new RMError('Rent Manager accepted the login but sent back no token.', r.status);
  return { token, rate: r.rate };
}

const asList = (data) => (Array.isArray(data) ? data
  : data && Array.isArray(data.Items) ? data.Items
  : data && typeof data === 'object' ? [data] : []);

/* ---- Storage: one row per key in rm_cache ---------------------------------- */
async function getKey(env, key) {
  try {
    const row = await env.DB.prepare('SELECT ts, body FROM rm_cache WHERE key = ?').bind(key).first();
    return row ? { ...JSON.parse(row.body), ts: row.ts } : null;
  } catch {
    return null;   // no table yet
  }
}

async function putKey(env, key, body) {
  const ts = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO rm_cache (key, ts, body) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, body = excluded.body`,
  ).bind(key, ts, JSON.stringify(body)).run();
  return { ...body, ts };
}

export const getListing = (env) => getKey(env, 'listing');
export const getStatus = (env) => getKey(env, 'status');
export const getDiscovery = (env) => getKey(env, 'discovery');
export async function isPublished(env) {
  const p = await getKey(env, 'publish');
  return Boolean(p && p.on);
}
export const setPublished = (env, on) => putKey(env, 'publish', { on: Boolean(on) });

/* ---- Step 1: what a unit looks like ------------------------------------------
   Names and types of every field, and a sample value only for fields whose
   names say they are about the unit itself (status, dates, rent, size, rooms,
   number). Free text such as comments, and anything about people, is never
   copied: the summary is safe to paste into a chat. */
const SAMPLE_OK = /(status|vacan|occup|ready|avail|notice|move|date|rent|bed|bath|sq|foot|size|name|number|type|floor|active|web|listing|market|amount)/i;
const NEVER = /(tenant|lease|contact|owner|resident|person|user|phone|email|address|note|comment|ssn|birth|bank|account|history|first|last|full|middle|display|signer|agent|guarantor|occupant|emergency|vendor|employer)/i;

function describe(obj, depth = 0) {
  if (!obj || typeof obj !== 'object') return typeof obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'ApiUri') continue;
    if (Array.isArray(v)) {
      out[k] = v.length && typeof v[0] === 'object' && depth < 1 ? { list: describe(v[0], depth + 1) } : 'list';
    } else if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      out[k] = keys.length === 1 && keys[0] === 'ApiUri' ? 'embed' : depth < 1 ? describe(v, depth + 1) : 'object';
    } else if (v !== null && SAMPLE_OK.test(k) && !NEVER.test(k)) {
      out[k] = `${typeof v}: ${String(v).slice(0, 40)}`;
    } else {
      out[k] = v === null ? 'null' : typeof v;
    }
  }
  return out;
}

// Embeds worth asking for: the unit's type, rent and status. Never people.
const WANTED_EMBED = /(type|rent|status|occup|vacan|market|avail|ready|notice|floor)/i;

async function unitsQuery(env, token, extra) {
  const pid = propertyId(env);
  let r = await call(env, `/Units?filters=PropertyID,eq,${pid}${extra}`, { token });
  // If this company's units are filtered under another name, ask through the property.
  if (r.status === 400) r = await call(env, `/Properties/${pid}/Units?${extra.replace(/^&/, '')}`, { token });
  return r;
}

export async function discover(env) {
  const { token } = await authorize(env);
  const pid = propertyId(env);
  const props = await call(env, '/Properties?pagesize=100', { token });
  const properties = props.ok ? asList(props.data).map((p) => ({
    id: p.PropertyID ?? p.Id ?? p.ID ?? null,
    name: p.Name ?? p.ShortName ?? p.PropertyName ?? '',
  })) : [];
  const one = await unitsQuery(env, token, '&pagesize=1');
  if (!one.ok) throw new RMError(explain(one, 'units').replace('{pid}', String(pid)), one.status);
  const sample = asList(one.data)[0];
  if (!sample) throw new RMError(`Rent Manager returned no units for property ${pid}.`, one.status);
  const embeds = Object.entries(sample)
    .filter(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && v.ApiUri
      && WANTED_EMBED.test(k) && !NEVER.test(k))
    .map(([k]) => k);
  let embedded = null;
  let rate = one.rate;
  if (embeds.length) {
    const rich = await unitsQuery(env, token, `&pagesize=1&embeds=${embeds.join(',')}`);
    if (rich.ok) embedded = describe(asList(rich.data)[0]);
    rate = rich.rate;
  }
  return putKey(env, 'discovery', {
    company: company(env), property: pid, properties,
    unitCount: one.total, fields: describe(sample), embeds, embedded, rate,
  });
}

/* ---- Step 2: the open units -------------------------------------------------
   Reads the fields the connection check found. Where a unit's state cannot be
   read it is left off: an empty list says "ask the leasing team", a wrong one
   would send people to homes that are not free. */
const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const toDay = (v) => {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m && !m[1].startsWith('0001') && !m[1].startsWith('1900') ? m[1] : null;
};
const nameOf = (o) => (o && typeof o === 'object' ? pick(o.Name, o.Description, o.Status, o.StatusName) : o);

function currentRent(u) {
  const direct = toNum(pick(u.MarketRent, u.Rent, u.AskingRent, u.AdvertisedRent));
  if (direct) return direct;
  const list = pick(u.MarketRents, u.UnitMarketRents);
  if (Array.isArray(list) && list.length) {
    const today = new Date().toISOString().slice(0, 10);
    const live = list
      .map((r) => ({ amount: toNum(pick(r.Amount, r.MarketRent, r.Rent)), from: toDay(pick(r.DateFrom, r.StartDate, r.EffectiveDate)) || '0000' }))
      .filter((r) => r.amount && r.from <= today)
      .sort((a, b) => (a.from < b.from ? 1 : -1));
    if (live.length) return live[0].amount;
  }
  const type = u.UnitType || {};
  return toNum(pick(type.MarketRent, type.Rent, type.DefaultRent));
}

export function normalize(env, u) {
  const type = u.UnitType && typeof u.UnitType === 'object' ? u.UnitType : {};
  const id = pick(u.UnitID, u.Id, u.ID);
  if (id === undefined) return null;
  const statusText = String(pick(
    nameOf(u.CurrentOccupancyStatus), nameOf(u.OccupancyStatus), nameOf(u.CurrentUnitStatus),
    nameOf(u.UnitStatus), nameOf(u.VacancyStatus), u.Status, '',
  )).toLowerCase();
  const vacantFlag = pick(u.IsVacant, u.Vacant);
  const t = statusText;
  // Order matters. "Vacant-Rented" and "Notice-Rented" are already leased; a
  // model, a down unit or an office is never for rent; "not ready" is empty
  // but being prepared, so it is listed as opening soon, not as available now.
  let status = 'unknown';
  if (/model|\bdown\b|offline|admin|employee|unavailable|not available|hold/.test(t)) status = 'taken';
  else if (/rented|leased|occupied/.test(t.replace(/un(rented|leased)/g, ''))) status = 'taken';
  else if (/not ready|make[- ]?ready|unready/.test(t)) status = 'making-ready';
  else if (vacantFlag === true || /vacant|available|ready/.test(t)) status = 'vacant';
  else if (/notice|vacating|move[- ]?out/.test(t)) status = 'notice';
  else if (vacantFlag === false) status = 'taken';
  const statusObj = [u.CurrentOccupancyStatus, u.OccupancyStatus, u.CurrentUnitStatus, u.UnitStatus]
    .find((o) => o && typeof o === 'object') || {};
  const available = toDay(pick(u.AvailableDate, u.ReadyDate, u.DateAvailable, u.VacateDate, u.ExpectedMoveOutDate,
    statusObj.AvailableDate, statusObj.ReadyDate, statusObj.EndDate, statusObj.Date));
  return {
    id,
    unit: String(pick(u.Name, u.UnitName, u.Number, id)).trim(),
    beds: toNum(pick(u.Bedrooms, u.Beds, u.BedroomCount, type.Bedrooms, type.Beds)),
    baths: toNum(pick(u.Bathrooms, u.Baths, u.BathroomCount, type.Bathrooms, type.Baths)),
    sqft: toNum(pick(u.SquareFootage, u.SqFt, u.SquareFeet, type.SquareFootage, type.SqFt)),
    rent: currentRent(u),
    status,
    available,
  };
}

/** The public shape: only what a listing shows, plus the Apply link. */
function publicUnit(env, n) {
  const today = new Date().toISOString().slice(0, 10);
  const future = n.available && n.available > today ? n.available : null;
  return {
    id: n.id, unit: n.unit, beds: n.beds, baths: n.baths, sqft: n.sqft, rent: n.rent,
    // "now", a date, or null for a unit being made ready with no date yet.
    available: n.status === 'vacant' ? (future || 'now') : future,
    apply: applyUrl(env, n.id),
  };
}

export async function refresh(env) {
  const { token } = await authorize(env);
  const pid = propertyId(env);
  const found = await getDiscovery(env);
  const embeds = found && Array.isArray(found.embeds) ? found.embeds : [];
  const r = await unitsQuery(env, token, `&pagesize=1000${embeds.length ? `&embeds=${embeds.join(',')}` : ''}`);
  if (!r.ok) throw new RMError(explain(r, 'units').replace('{pid}', String(pid)), r.status);
  const all = asList(r.data).map((u) => normalize(env, u)).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const open = all.filter((n) => n.status === 'vacant' || n.status === 'making-ready'
    // A notice unit is listed only with a move-out date still to come:
    // without one there is nothing true to say about when it opens.
    || (n.status === 'notice' && n.available && n.available > today))
    .map((n) => publicUnit(env, n))
    .sort((a, b) => (a.beds ?? 9) - (b.beds ?? 9) || (a.rent ?? 1e9) - (b.rent ?? 1e9));
  const listing = await putKey(env, 'listing', { property: pid, units: open });
  await putKey(env, 'status', {
    ok: true, total: all.length, open: open.length,
    unread: all.filter((n) => n.status === 'unknown').length,
    noRent: open.filter((n) => !n.rent).length, rate: r.rate,
  });
  return listing;
}

/** For the site: the list, only when switched on and recent enough to trust. */
export async function publicListing(env) {
  if (!(await isPublished(env))) return { units: [] };
  const l = await getListing(env);
  if (!l || !l.ts || Date.now() / 1000 - l.ts > STALE_AFTER) return { units: [] };
  return { updated: l.ts, units: l.units || [] };
}

/** The scheduled run: first a connection check if there has never been one,
 *  then the list. A failure after a success emails the leasing inbox once. */
export async function scheduledRefresh(env) {
  if (!rmConfigured(env) || !env.DB) return;
  const before = await getStatus(env);
  if (before && before.rate && before.rate.remaining !== null && before.rate.remaining < 5
      && Date.now() / 1000 - before.ts < (before.rate.resetIn || 0)) return;   // leave the hour's last calls alone
  try {
    if (!(await getDiscovery(env))) await discover(env);
    await refresh(env);
  } catch (err) {
    await putKey(env, 'status', { ok: false, error: err.message, code: err.status || 0 });
    if (before && before.ok) {
      const to = leadTo(env);
      if (to.length) {
        await sendEmail(env, {
          to,
          subject: 'Charlotte Square: the Rent Manager listing stopped updating',
          text: `The website could not read the open units from Rent Manager.\n\n${err.message}\n\nThe site keeps showing the last list for up to a day, then shows "Ask about availability". The dashboard's Rent Manager panel has the details and a Check connection button.`,
        }).catch(() => {});
      }
    }
  }
}
