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
const DISCOVERY_VERSION = 3;

// Rent Manager's collections send a unit's ID, property, name and sort order
// and nothing more unless asked for fields by name, and the list of names is
// behind a login. So the check finds out how Rent Manager treats a name it
// does not know, then asks for the likely ones in the cheapest way that
// reaction allows, most useful first, and every refresh asks for exactly the
// ones it accepted. None of these names a person.
const BASE_FIELDS = ['UnitID', 'PropertyID', 'Name', 'SortOrder'];
const FIELD_GROUPS = [
  ['UnitTypeID', 'SquareFootage', 'Bedrooms', 'Bathrooms'],
  ['MarketRent', 'IsVacant', 'ReadyDate', 'AvailableDate'],
  ['Status', 'UnitStatus', 'IsReady', 'VacateDate', 'ExpectedMoveOutDate', 'IsDown', 'IsModel', 'IsActive'],
  ['SqFt', 'SquareFeet', 'Beds', 'Baths', 'Rent', 'DefaultRent', 'DateAvailable', 'NoticeDate', 'IsOnNotice', 'OccupancyStatus'],
];
const EMBED_GROUPS = [['UnitType'], ['UnitStatuses'], ['MarketRents'], ['CurrentOccupancyStatus'],
  ['CurrentUnitStatus'], ['CurrentMarketRent'], ['Vacancy'], ['OccupancyStatus']];
const RELEVANT = /(type|sq|foot|feet|bed|bath|rent|vacan|ready|avail|status|notice|move|model|down|active|floor|date)/i;
const unique = (a) => [...new Set(a)];
const isStub = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'ApiUri' in v;
const said = (d) => (d && typeof d === 'object'
  ? String(d.UserMessage || d.Message || d.DeveloperMessage || JSON.stringify(d)) : String(d || '')).slice(0, 400);

async function unitsQuery(env, token, extra) {
  const pid = propertyId(env);
  let r = await call(env, `/Units?filters=PropertyID,eq,${pid}${extra}`, { token });
  // If this company's units are filtered under another name, ask through the property.
  if (r.status === 400) r = await call(env, `/Properties/${pid}/Units?${extra.replace(/^&/, '')}`, { token });
  return r;
}

/** One request for a unit, logged for the field summary. */
async function ask(env, token, unitId, qs, budget, note) {
  budget.left--;
  const r = await call(env, `/Units/${unitId}${qs ? `?${qs}` : ''}`, { token });
  budget.rate = r.rate;
  budget.log.push({ note, status: r.status, said: r.ok ? '' : said(r.data) });
  return r;
}

/** Which of `names` Rent Manager accepts as fields (kind 'fields') or embeds. */
function present(r, names, kind) {
  const u = asList(r.data)[0] || {};
  return names.filter((n) => n in u && (kind === 'fields' || Array.isArray(u[n]) || (u[n] && typeof u[n] === 'object' && !isStub(u[n]))));
}

/** How Rent Manager treats a name it does not know: 'ignores' it, 'lists' the
 *  valid ones in its refusal (returned), or 'names' only the bad one. */
async function reaction(env, token, unitId, param, budget) {
  const fake = 'ZzNoSuchName';
  const qs = param === 'fields' ? `fields=UnitID,${fake}` : `${param}=${fake}`;
  const r = await ask(env, token, unitId, qs, budget, `${param}: how is an unknown name treated?`);
  if (r.ok) return { how: 'ignores' };
  if (r.status !== 400) return { how: 'error', status: r.status };
  const words = unique((said(r.data).match(/\b[A-Z][A-Za-z0-9]{2,}\b/g) || []).filter((w) => w !== fake));
  return words.length >= 6 ? { how: 'lists', valid: words } : { how: 'names' };
}

/** Group by group, most useful first: ask for the group; on a refusal that
 *  names one name, drop it and ask again; on one that names none, split. */
async function groups(env, token, unitId, param, kind, list, budget) {
  const got = [];
  const queue = list.map((g) => g.slice());
  while (queue.length && budget.left > 0) {
    const g = queue.shift();
    if (!g.length) continue;
    const qs = kind === 'fields' ? `fields=${unique([...BASE_FIELDS, ...g]).join(',')}` : `${param}=${g.join(',')}`;
    const r = await ask(env, token, unitId, qs, budget, `${param}: ${g.join(',')}`);
    if (r.ok) { got.push(...present(r, g, kind)); continue; }
    if (r.status !== 400) continue;
    const text = said(r.data);
    const named = g.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(text));
    if (named.length && named.length < g.length) queue.unshift(g.filter((n) => !named.includes(n)));
    else if (g.length > 1) queue.unshift(g.slice(0, Math.ceil(g.length / 2)), g.slice(Math.ceil(g.length / 2)));
  }
  return unique(got);
}

/** Fields or embeds Rent Manager accepts, in as few calls as its reaction allows. */
async function accepted(env, token, unitId, param, kind, list, extra, budget) {
  const all = unique([...extra, ...list.flat()]).filter((n) => !NEVER.test(n));
  const how = await reaction(env, token, unitId, param, budget);
  budget.reactions[param] = how.how;
  if (how.how === 'ignores') {
    const qs = kind === 'fields' ? `fields=${unique([...BASE_FIELDS, ...all]).join(',')}` : `${param}=${all.join(',')}`;
    const r = await ask(env, token, unitId, qs, budget, `${param}: all at once`);
    return r.ok ? present(r, all, kind) : [];
  }
  if (how.how === 'lists') {
    const valid = how.valid.filter((n) => RELEVANT.test(n) && !NEVER.test(n) && !BASE_FIELDS.includes(n));
    const qs = kind === 'fields' ? `fields=${unique([...BASE_FIELDS, ...valid]).join(',')}` : `${param}=${valid.join(',')}`;
    const r = valid.length ? await ask(env, token, unitId, qs, budget, `${param}: the valid names it listed`) : null;
    return r && r.ok ? present(r, valid, kind) : [];
  }
  return groups(env, token, unitId, param, kind, [extra.filter((n) => !NEVER.test(n)), ...list], budget);
}

/** The query string that asks for the accepted fields and embeds. */
function selectQuery(acc) {
  if (!acc) return '';
  const fields = acc.fields || [];
  const embeds = acc.mode === 'no-embeds' ? [] : acc.embeds || [];
  const parts = [];
  if (fields.length || embeds.length) {
    parts.push(`fields=${unique([...BASE_FIELDS, ...fields, ...(acc.mode === 'separate' ? [] : embeds)]).join(',')}`);
  }
  if (embeds.length) parts.push(`${acc.embedParam || 'embeds'}=${embeds.join(',')}`);
  return parts.length ? `&${parts.join('&')}` : '';
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
  const id = sample.UnitID ?? sample.Id ?? sample.ID;

  const budget = { left: 18, log: [], rate: one.rate, reactions: {} };
  // The unit's own record, which may carry every field and embed name.
  const inst = await ask(env, token, id, '', budget, 'the unit record');
  const full = inst.ok ? asList(inst.data)[0] || {} : {};
  const named = Object.keys(full).filter((k) => k !== 'ApiUri' && !BASE_FIELDS.includes(k) && !NEVER.test(k));
  const fullFields = named.filter((k) => full[k] === null || typeof full[k] !== 'object');
  const fullEmbeds = named.filter((k) => full[k] && typeof full[k] === 'object' && WANTED_EMBED.test(k));

  // Embeds first, one per call if it comes to that: they are where Rent
  // Manager is likeliest to keep a unit's status, rent and room counts. Then
  // the most useful plain fields.
  let embedParam = 'embeds';
  let embeds = await accepted(env, token, id, 'embeds', 'embeds', EMBED_GROUPS.slice(0, 6), fullEmbeds, budget);
  if (!embeds.length && budget.reactions.embeds === 'ignores' && budget.left > 4) {
    embedParam = 'embed';           // Rent Manager's guide spells it both ways
    embeds = await accepted(env, token, id, 'embed', 'embeds', EMBED_GROUPS.slice(0, 6), fullEmbeds, budget);
  }
  const fields = await accepted(env, token, id, 'fields', 'fields', FIELD_GROUPS.slice(0, 2), fullFields, budget);

  // One unit with everything accepted, asked the way refreshes will ask.
  const acc = { fields, embeds, embedParam, mode: 'together' };
  let embedded = null;
  if (fields.length || embeds.length) {
    for (const mode of embeds.length ? ['together', 'separate', 'no-embeds'] : ['together']) {
      acc.mode = mode;
      const r = await ask(env, token, id, selectQuery(acc).slice(1), budget, `sample, ${mode}`);
      if (r.ok) { embedded = describe(asList(r.data)[0]); break; }
    }
  }
  return putKey(env, 'discovery', {
    v: DISCOVERY_VERSION, company: company(env), property: pid, properties, unitCount: one.total,
    fields: describe(sample), full: inst.ok ? describe(full) : `not readable (${inst.status})`,
    reactions: budget.reactions, accepted: acc, embeds: acc.mode === 'no-embeds' ? [] : embeds,
    embedded, probes: budget.log, rate: budget.rate,
  });
}

/** After a deploy that changes how the check works, run it once by itself,
 *  rather than waiting for the schedule: at most once an hour per version. */
export async function rediscoverIfStale(env) {
  if (!rmConfigured(env) || !env.DB) return;
  const found = await getDiscovery(env);
  if (found && (found.v || 1) >= DISCOVERY_VERSION) return;
  const tried = await getKey(env, `tried-v${DISCOVERY_VERSION}`);
  if (tried && Date.now() / 1000 - tried.ts < 3600) return;
  await putKey(env, `tried-v${DISCOVERY_VERSION}`, { at: Date.now() });
  try {
    await discover(env);
    await refresh(env);
  } catch (err) {
    await putKey(env, 'status', { ok: false, error: err.message, code: err.status || 0 });
  }
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
const nameOf = (o) => {
  if (!o || typeof o !== 'object') return o;
  const inner = [o.UnitStatusType, o.StatusType, o.OccupancyStatusType, o.Type].find((t) => t && typeof t === 'object');
  return pick(o.Name, o.StatusName, o.Description, typeof o.Status === 'string' ? o.Status : undefined, inner && pick(inner.Name, inner.Description));
};
/** The status in force today from a list of status periods: started, not ended. */
function currentOf(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const live = list.filter((x) => x && typeof x === 'object')
    .map((x) => ({ x, from: toDay(pick(x.StartDate, x.DateFrom, x.EffectiveDate)) || '0000', to: toDay(pick(x.EndDate, x.DateTo)) }))
    .filter((r) => r.from <= today && (!r.to || r.to >= today))
    .sort((a, b) => (a.from < b.from ? 1 : -1));
  return live.length ? live[0].x : null;
}

function currentRent(u) {
  const direct = toNum(pick(typeof u.MarketRent === 'object' ? undefined : u.MarketRent, u.Rent, u.AskingRent, u.AdvertisedRent, u.DefaultRent));
  if (direct) return direct;
  const cur = [u.CurrentMarketRent, u.MarketRent].find((o) => o && typeof o === 'object' && !Array.isArray(o));
  if (cur) {
    const a = toNum(pick(cur.Amount, cur.MarketRent, cur.Rent));
    if (a) return a;
  }
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
  const fromList = currentOf(u.UnitStatuses) || currentOf(u.OccupancyStatuses);
  const statusText = String(pick(
    nameOf(u.CurrentOccupancyStatus), nameOf(u.OccupancyStatus), nameOf(u.CurrentUnitStatus),
    nameOf(u.UnitStatus), nameOf(u.VacancyStatus), nameOf(u.Vacancy), nameOf(fromList),
    typeof u.Status === 'string' ? u.Status : nameOf(u.Status), '',
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
  const statusObj = [u.CurrentOccupancyStatus, u.OccupancyStatus, u.CurrentUnitStatus, u.UnitStatus, u.Vacancy, fromList]
    .find((o) => o && typeof o === 'object' && !Array.isArray(o)) || {};
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
  const select = found && found.accepted ? selectQuery(found.accepted)
    : found && Array.isArray(found.embeds) && found.embeds.length ? `&embeds=${found.embeds.join(',')}` : '';
  const r = await unitsQuery(env, token, `&pagesize=1000${select}`);
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
  // The first time Rent Manager returns open units, the list goes on the site
  // by itself, as Evolution24 asked. Once the switch has been set either way
  // on the dashboard, that choice stands.
  if (open.length && !(await getKey(env, 'publish'))) await setPublished(env, true);
  await putKey(env, 'status', {
    ok: true, total: all.length, open: open.length,
    unread: all.filter((n) => n.status === 'unknown').length,
    noRent: open.filter((n) => !n.rent).length, rate: r.rate,
  });
  return listing;
}

/** A public, wordless health line: whether the connection is set up, when it
 *  last ran, whether that worked, and Rent Manager's status code if not. No
 *  error text, field names or settings. */
export async function publicStatus(env) {
  const [st, published] = await Promise.all([getStatus(env), isPublished(env)]);
  return {
    configured: rmConfigured(env), published,
    at: st ? st.ts : null,
    ok: st ? Boolean(st.ok) : null,
    open: st && st.ok ? st.open : null,
    code: st && !st.ok ? st.code || 0 : null,
  };
}

/** What a unit looks like (field names and types, the same summary as the
 *  dashboard's, never resident data), readable for two hours after a
 *  connection check so the field mapping can be finished without copying it
 *  out of the dashboard. Otherwise null. */
export async function recentDiscovery(env) {
  const d = await getDiscovery(env);
  if (!d || !d.ts || Date.now() / 1000 - d.ts > 2 * 3600) return null;
  const { v, company: co, property, unitCount, properties, embeds, fields, full, reactions, accepted: acc, embedded, probes, ts } = d;
  return { v, company: co, property, unitCount, properties, embeds, fields, full, reactions, accepted: acc, embedded, probes, ts };
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
    const found = await getDiscovery(env);
    if (!found || (found.v || 1) < DISCOVERY_VERSION) await discover(env);
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
