/* =============================================================================
   Rent Manager accounting — for Evolution24's P&L Google Sheet, not the website.

   The sheet (tools/pl-sheet/Code.gs) compares accounting's hand-kept P&L tabs
   with Rent Manager. It asks this Worker, through /api/pl, with a token; the
   Worker signs in to Rent Manager with its own accounting login, so the login
   lives in Cloudflare and never in the sheet.

   A separate login from the website's (RM_USERNAME, which reads units only),
   so the unit listings never carry accounting access:
     RM_ACCT_USERNAME, RM_ACCT_PASSWORD   secrets: a Rent Manager user with
                                          read access to properties and the
                                          general ledger
     RM_ACCT_LOCATION_ID                  optional, as RM_LOCATION_ID
     PL_SHEET_TOKEN                       secret: what the sheet must send

   Step one, here: the connection check. Rent Manager's field reference is
   behind a login, so the check signs in, lists the properties and the chart
   of accounts, and asks the likely accounting resources for one record each,
   keeping what each answers (its status, how many records, its field names,
   and sample values only for dates, amounts and IDs; never a person's
   details). The monthly pull is written from what it finds.
   ============================================================================= */
import { call, asList, company, getKey, putKey, RMError } from './rentmanager.js';

export const acctConfigured = (env) => Boolean(env.RM_ACCT_USERNAME && env.RM_ACCT_PASSWORD);

async function signIn(env) {
  const body = { Username: env.RM_ACCT_USERNAME, Password: env.RM_ACCT_PASSWORD };
  if (env.RM_ACCT_LOCATION_ID) body.LocationID = Number(env.RM_ACCT_LOCATION_ID);
  const r = await call(env, '/Authentication/AuthorizeUser', { method: 'POST', body });
  if (r.status === 401) throw new RMError('Rent Manager did not accept the accounting login. Check RM_ACCT_USERNAME and RM_ACCT_PASSWORD in Cloudflare, that the user has Web API access, and, if the company has several locations, RM_ACCT_LOCATION_ID.', 401);
  if (!r.ok) throw new RMError(`Rent Manager answered ${r.status} to the accounting sign-in.${said(r.data) ? ` It said: "${said(r.data)}"` : ''}`, r.status);
  const token = typeof r.data === 'string' ? r.data : r.data && (r.data.Token || r.data.ApiToken || r.data.APIToken);
  if (!token) throw new RMError('Rent Manager accepted the accounting login but sent back no token.', r.status);
  return token;
}

const said = (d) => (d && typeof d === 'object'
  ? String(d.UserMessage || d.Message || d.DeveloperMessage || '') : String(d || '')).slice(0, 300);
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return null; };
const nameOf = (v) => (v && typeof v === 'object' ? pick(v, 'Name', 'Description') : v);

// Sample values only where the field name says date, amount, ID, type or
// period; and never where it could be about a person or free text.
const SAMPLE_OK = /(date|amount|debit|credit|balance|total|id$|type|period|year|month|number|reference|isactive|posted|status)/i;
const NEVER = /(tenant|lease|contact|owner|resident|person|user|phone|email|address|note|comment|memo|ssn|birth|bank.?account|routing|payee|vendor.?name|first|last|full|middle|display|signer|guarantor|occupant|employer)/i;

function shape(obj, depth = 0) {
  if (!obj || typeof obj !== 'object') return typeof obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'ApiUri') continue;
    if (Array.isArray(v)) out[k] = v.length && typeof v[0] === 'object' && depth < 1 ? { list: shape(v[0], depth + 1) } : 'list';
    else if (v && typeof v === 'object') out[k] = depth < 1 ? shape(v, depth + 1) : 'object';
    else if (v !== null && SAMPLE_OK.test(k) && !NEVER.test(k)) out[k] = `${typeof v}: ${String(v).slice(0, 30)}`;
    else out[k] = v === null ? 'null' : typeof v;
  }
  return out;
}

// What a Rent Manager GL account might call its number, name and type. It
// ignores field names it does not know, so asking for all of them is safe.
const GL_FIELDS = ['GLAccountID', 'Reference', 'AccountNumber', 'Number', 'GLAccountNumber', 'Name', 'Description',
  'GLAccountType', 'AccountType', 'Type', 'IsActive', 'ParentGLAccountID', 'SortOrder'];
const PROPERTY_FIELDS = ['PropertyID', 'Name', 'ShortName', 'IsActive'];

// The accounting resources worth knowing about, each asked for one record.
const PROBES = [
  '/GLAccounts', '/JournalEntries', '/GeneralJournalEntries', '/GLTransactions', '/Transactions',
  '/Bills', '/Checks', '/Charges', '/Payments', '/Deposits', '/BankTransactions', '/Banks',
  '/AccountingPeriods', '/Reports', '/Budgets',
];

export function glAccount(a) {
  const type = pick(a, 'GLAccountType', 'AccountType', 'Type');
  return {
    id: pick(a, 'GLAccountID', 'ID', 'Id'),
    number: String(pick(a, 'Reference', 'AccountNumber', 'GLAccountNumber', 'Number') ?? ''),
    name: String(nameOf(pick(a, 'Name', 'Description')) ?? ''),
    type: String(nameOf(type) ?? ''),
    active: pick(a, 'IsActive'),
  };
}

export async function accountingCheck(env) {
  const token = await signIn(env);
  let rate = null;
  const get = async (path) => { const r = await call(env, path, { token }); rate = r.rate; return r; };

  const props = await get(`/Properties?pagesize=500&fields=${PROPERTY_FIELDS.join(',')}`);
  const properties = props.ok ? asList(props.data).map((p) => ({
    id: pick(p, 'PropertyID', 'ID'), name: String(pick(p, 'Name') ?? ''), short: String(pick(p, 'ShortName') ?? ''), active: pick(p, 'IsActive'),
  })) : [];

  const gl = await get(`/GLAccounts?pagesize=2000&fields=${GL_FIELDS.join(',')}&embeds=GLAccountType`);
  const glPlain = gl.ok ? gl : await get(`/GLAccounts?pagesize=2000&fields=${GL_FIELDS.join(',')}`);
  const glList = glPlain.ok ? asList(glPlain.data) : [];
  const accounts = glList.map(glAccount);

  const probes = [];
  for (const path of PROBES) {
    if (path === '/GLAccounts') {
      probes.push({ path, status: glPlain.status, count: glList.length, said: glPlain.ok ? '' : said(glPlain.data), fields: glList[0] ? shape(glList[0]) : null });
      continue;
    }
    const r = await get(`${path}?pagesize=1`);
    const first = asList(r.data)[0];
    probes.push({ path, status: r.status, count: r.total ?? (Array.isArray(r.data) ? r.data.length : r.ok ? 1 : 0),
      said: r.ok ? '' : said(r.data), fields: r.ok && first && typeof first === 'object' ? shape(first) : null });
  }

  return putKey(env, 'pl-check', {
    company: company(env),
    properties, propertiesStatus: props.status, propertiesSaid: props.ok ? '' : said(props.data),
    accounts, accountsStatus: glPlain.status, probes, rate,
  });
}

export const lastCheck = (env) => getKey(env, 'pl-check');
