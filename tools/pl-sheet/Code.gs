/**
 * Evolution24: Rent Manager's P&L beside the P&L sheets, in Google Sheets.
 *
 * Accounting keeps a P&L tab per property ("301 Central PL 2026", ...), typed
 * in by hand. This script reads Rent Manager's Income Statement export for
 * one property, sorts each Rent Manager GL account into a line of that
 * property's P&L tab, and writes a tab beside it ("RM vs 301 Central PL
 * 2026") with, for every month, the sheet's number, Rent Manager's number and
 * the difference, the differences highlighted. The P&L tabs themselves are
 * only read, never changed.
 *
 * Which account goes in which line lives on the RM Mapping tab, which the
 * script fills: every account it meets for the first time is added with a
 * suggested line, marked "Suggested: check". Change the line there and run
 * the reconcile again. Rent Manager's chart of accounts is shared by every
 * property, so the mapping is set once and serves them all.
 *
 * ONE-TIME SETUP (about two minutes)
 *   1. Open the P&L Google Sheet. Extensions → Apps Script. Paste this whole
 *      file in (in place of any sample code) and press Save.
 *   2. Back in the sheet, reload the page. A "Rent Manager" menu appears.
 *      The first time it is used, Google asks to allow access (if it says the
 *      app isn't verified: Advanced → Go to the project). The script only
 *      touches this spreadsheet.
 *
 * STRAIGHT FROM RENT MANAGER (no export): see "Rent Manager directly" below
 *   and "Rent Manager's P&L" in the website's README for the Cloudflare secrets.
 *
 * EACH MONTH, FROM AN EXPORT
 *   1. In Rent Manager: Reports → Income Statement, one property, a
 *      12-month (month-by-month) layout, the year to date. Export to Excel.
 *   2. In the sheet: File → Import → Upload the file → "Insert new sheet(s)".
 *   3. With that new tab open: Rent Manager → Reconcile this export.
 *      It finds the property's P&L tab by name (or asks), and writes
 *      "RM vs <tab>". Accounts it could not place are listed at the bottom
 *      and added to RM Mapping.
 *   4. Delete the imported tab when done, if you like; nothing depends on it.
 *
 * The rules that pull numbers out of the export are written to cope with the
 * usual Rent Manager layouts (account number and name in the first columns,
 * one column per month). If an export does not read, the script says what it
 * could not find.
 */

const MAP_TAB = 'RM Mapping';
const OUT_PREFIX = 'RM vs ';
const TOLERANCE = 1;   // differences under a dollar are not highlighted

/* ---------------------------------------------------------------------------
   Pure helpers: no Google calls, so they can be tested outside Apps Script.
   --------------------------------------------------------------------------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad2 = (n) => (n < 10 ? '0' : '') + n;

/** A cell as a month, "2026-01", or null. A month name alone takes defaultYear. */
function parseMonth(v, defaultYear) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return v.getFullYear() + '-' + pad2(v.getMonth() + 1);
  }
  const s = String(v).trim().toLowerCase();
  let m = /^(\d{4})-(\d{2})(-\d{2}(t.*)?)?$/.exec(s);                 // 2026-01, 2026-01-01T...
  if (m) return m[1] + '-' + m[2];
  m = /^(\d{1,2})\/(\d{1,2}\/)?(\d{2}|\d{4})$/.exec(s);               // 01/2026, 1/31/2026
  if (m && +m[1] >= 1 && +m[1] <= 12) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2(+m[1]);
  m = /^([a-z]{3,9})\.?(?:[\s\-\/,']+(\d{2}|\d{4}))?$/.exec(s);       // January, Jan 2026, Jan-26
  if (m) {
    const i = MONTHS.indexOf(m[1].slice(0, 3));
    if (i < 0 || !('january february march april may june july august september october november december sept'
      .split(' ').some((full) => full.indexOf(m[1]) === 0))) return null;
    const y = m[2] ? (m[2].length === 2 ? '20' + m[2] : m[2]) : defaultYear;
    return y ? y + '-' + pad2(i + 1) : null;
  }
  return null;
}

/** A cell as an amount, or null for blank, dashes and words. "(1,200.50)" is -1200.5. */
function parseMoney(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s || /^[-–—\s]+$/.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, '');
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return (neg ? -1 : 1) * Number(s);
}

/** A label for matching: lower case, no "(9%)"-style notes, words only. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The four-digit year in a tab's name ("301 Central PL 2026"), the last one if several. */
function yearOf(title) {
  const all = String(title).match(/20\d{2}/g);
  return all ? all[all.length - 1] : String(new Date().getFullYear());
}

/**
 * A P&L tab, read: its months (column → "YYYY-MM") and its lines.
 * Each line: { row, label, key, section: income|expense|total|cam|debt|other, values: {month: n|null} }.
 */
function readPL(values, title) {
  const year = yearOf(title);
  let hdr = -1;
  for (let r = 0; r < Math.min(values.length, 15); r++) {
    if (/^income\b/i.test(String(values[r][0] || '').trim())) { hdr = r; break; }
  }
  if (hdr < 0) throw new Error('No "Income" header row in column A of "' + title + '".');
  const months = {};
  values[hdr].forEach((v, c) => {
    if (c === 0) return;
    const m = parseMonth(v, year);
    if (m && !Object.keys(months).some((k) => months[k] === m)) months[c] = m;
  });
  if (!Object.keys(months).length) throw new Error('No month columns on the header row of "' + title + '".');
  const lines = [];
  let section = 'income';
  for (let r = hdr + 1; r < values.length; r++) {
    const label = String(values[r][0] || '').trim();
    if (!label) continue;
    const key = norm(label);
    if (/^gross income/.test(key)) { lines.push(line(r, label, key, 'total:gross', values[r], months)); section = 'between'; continue; }
    if (/^expenses$/.test(key)) { section = 'expense'; continue; }
    if (/^operating expenses/.test(key)) { lines.push(line(r, label, key, 'total:opex', values[r], months)); section = 'after'; continue; }
    if (/^net operating income/.test(key)) { lines.push(line(r, label, key, 'total:noi', values[r], months)); section = 'debt'; continue; }
    if (/cam includes/.test(key)) { section = 'cam'; continue; }
    if (/^(dscr|before tax cash flow|total debt)/.test(key) || /^total\b/.test(key)) continue;
    if (section === 'between' || section === 'after') continue;
    lines.push(line(r, label, key, section, values[r], months));
  }
  return { title: title, months: months, lines: lines };
}

function line(r, label, key, section, row, months) {
  const vals = {};
  Object.keys(months).forEach((c) => { vals[months[c]] = parseMoney(row[c]); });
  return { row: r + 1, label: label, key: key, section: section, values: vals };
}

/**
 * A Rent Manager income statement export, read: its months and its accounts.
 * Each account: { acct, name, amounts: {month: n} }. Totals and headings are skipped.
 */
function readExport(values) {
  let hdr = -1, months = {};
  const year = (function () {
    for (let r = 0; r < Math.min(values.length, 12); r++) {
      const m = values[r].join(' ').match(/20\d{2}/);
      if (m) return m[0];
    }
    return String(new Date().getFullYear());
  })();
  let best = -1, bestMonths = {};
  for (let r = 0; r < Math.min(values.length, 30); r++) {
    const found = {};
    values[r].forEach((v, c) => { const m = parseMonth(v, year); if (m) found[c] = m; });
    const n = Object.keys(found).length;
    if (n >= 2) { hdr = r; months = found; break; }          // the first row with two months or more
    if (n === 1 && best < 0) { best = r; bestMonths = found; }   // else a one-month report
  }
  if (hdr < 0 && best >= 0) { hdr = best; months = bestMonths; }
  if (hdr < 0) throw new Error('No row of month headings (January, Jan 2026, 01/2026 ...) in the first 30 rows of this tab. Export the Income Statement with one column per month.');
  const firstMonthCol = Math.min.apply(null, Object.keys(months).map(Number));
  const accounts = [];
  const skipped = [];
  for (let r = hdr + 1; r < values.length; r++) {
    const row = values[r];
    const amounts = {};
    let any = false;
    Object.keys(months).forEach((c) => {
      const n = parseMoney(row[c]);
      if (n !== null) { amounts[months[c]] = (amounts[months[c]] || 0) + n; any = true; }
    });
    if (!any) continue;
    let acct = '', name = '';
    for (let c = 0; c < firstMonthCol; c++) {
      const s = String(row[c] === null || row[c] === undefined ? '' : row[c]).trim();
      if (!s) continue;
      let m;
      if (!acct && (m = /^(\d{3,6}(?:[-.]\d{1,4})?)(?:\s*[-–:]\s*|\s+)(.+)$/.exec(s))) { acct = m[1]; name = m[2].trim(); break; }
      if (!acct && /^\d{3,6}([-.]\d{1,4})?$/.test(s)) { acct = s; continue; }
      if (!name) name = s;
    }
    if (!name && !acct) continue;
    if (/^(total|net|gross)\b/i.test(name) || /\btotal$/i.test(name)) { skipped.push(name); continue; }
    accounts.push({ acct: acct, name: name, amounts: amounts });
  }
  if (!accounts.length) throw new Error('Found the month headings but no account rows below them.');
  const top = values.slice(0, hdr + 1).map((r) => r.join(' ')).join(' ');
  return { months: Object.keys(months).map((c) => months[c]), accounts: accounts, top: top, skippedTotals: skipped };
}

/** A suggested P&L line for an account name. Alternatives with "|", first match wins. */
const SUGGEST = [
  [/air ?b|short.?term|vrbo|booking/i, 'Air BB'],
  [/swap/i, 'Mortgage Swap'],
  [/utilit.*(reimb|income|recover|charge)|rubs/i, 'Utilities'],
  [/rent|parking (income|fee)|storage (income|fee)|concession|vacancy|loss to lease/i, 'Rent'],
  [/late|application|pet|laundry|fee income|other income|misc.*income|nsf|interest income|damage/i, 'Other Income'],
  [/deposit refund/i, 'Security Deposit Refunds'],
  [/furnish|furniture/i, 'Apartment Conversion'],
  [/advertis|marketing|listing|leasing commission/i, 'Marketing'],
  [/clean/i, 'Cleaning-Units | Cleaning'],
  [/labor|maintenance (payroll|wage|staff)/i, 'Maintenance Labor'],
  [/internet|cable|wifi|wi-fi/i, 'Internet'],
  [/phone|telephone/i, 'Phone | Internet'],
  [/trash|refuse|garbage|disposal|dumpster/i, 'Trash'],
  [/water|sewer/i, 'Water'],
  [/electric|gas|rg ?& ?e|steam|heat|national grid|nyseg/i, 'Electric | Utilities'],
  [/legal|attorney|account|admin|bank|professional|office|software|license|permit/i, 'Legal'],
  [/capital|capex|improvement/i, 'CAPEX'],
  [/repair|supplies|turnover|maintenance|paint|plumb|hvac|appliance|flooring|lock/i, 'Turnover | Repairs'],
  [/management|payroll|salar|wage/i, 'Management'],
  [/insurance/i, 'Insurance'],
  [/tax/i, 'Prop'],
  [/janitor/i, 'Janitorial'],
  [/pest|extermin/i, 'Pest'],
  [/snow|lawn|landscap|grounds/i, 'Lawn'],
  [/elevator/i, 'Elevator'],
  [/sprinkler|fire|life safety|alarm monitor/i, 'Life Safety'],
  [/\bring\b/i, 'Amazon Ring | Security'],
  [/security|camera|fob|access control/i, 'Security'],
  [/parking|garage/i, 'Parking'],
  [/second mortgage|2nd/i, '2nd'],
  [/mortgage|interest expense|debt|loan/i, 'Debt Service | TOTAL DEBT SERVICE'],
];
function suggest(name) {
  for (let i = 0; i < SUGGEST.length; i++) if (SUGGEST[i][0].test(name)) return SUGGEST[i][1];
  return '';
}

/** The P&L line a mapping names, on this tab: alternatives in order, an exact label before a prefix. */
function findLine(pl, target) {
  const alts = String(target || '').split('|').map(norm).filter(Boolean);
  for (let i = 0; i < alts.length; i++) {
    const a = alts[i];
    const exact = pl.lines.filter((l) => l.key === a && l.section.indexOf('total') !== 0);
    if (exact.length) return exact[0];
    const pre = pl.lines.filter((l) => (l.key + ' ').indexOf(a + ' ') === 0 && l.section.indexOf('total') !== 0);
    if (pre.length) return pre[0];
  }
  return null;
}

/** Mapping rows ([acct, name, line, note]) as a lookup: by account number, else by name. */
function mappingLookup(rows) {
  const byAcct = {}, byName = {};
  rows.forEach((r) => {
    const acct = String(r[0] || '').trim(), name = norm(r[1]);
    const entry = { line: String(r[2] || '').trim(), note: String(r[3] || '').trim() };
    if (acct) byAcct[acct] = entry; else if (name) byName[name] = entry;
  });
  return (a) => (a.acct && byAcct[a.acct]) || byName[norm(a.name)] || null;
}

/**
 * The comparison. Returns { months, rows, unplaced, newMappings }.
 * rows: { label, kind: line|total, sheet: {m: n|null}, rm: {m: n}, note }
 */
function reconcile(pl, exp, mappingRows) {
  const lookup = mappingLookup(mappingRows);
  const months = exp.months.filter((m, i, a) => a.indexOf(m) === i).sort();
  const rm = {};          // line row number → {month: n}
  const notes = {};       // line row number → set of notes
  const unplaced = [];
  const newMappings = [];
  const seen = {};
  exp.accounts.forEach((a) => {
    let map = lookup(a);
    const id = a.acct || norm(a.name);
    if (!map) {
      const s = suggest(a.name);
      map = { line: s, note: s ? 'Suggested: check' : 'Not placed: choose a line' };
      if (!seen[id]) { newMappings.push([a.acct, a.name, map.line, map.note]); seen[id] = 1; }
    }
    const target = map.line ? findLine(pl, map.line) : null;
    if (!target) {
      unplaced.push({ acct: a.acct, name: a.name, amounts: a.amounts,
        why: map.line ? 'No line "' + map.line + '" on this tab' : 'No P&L line chosen on RM Mapping' });
      return;
    }
    const bucket = rm[target.row] || (rm[target.row] = {});
    months.forEach((m) => { if (a.amounts[m] !== undefined) bucket[m] = (bucket[m] || 0) + a.amounts[m]; });
    const n = notes[target.row] || (notes[target.row] = []);
    const tag = (a.acct ? a.acct + ' ' : '') + a.name + (/^suggested/i.test(map.note) ? ' (suggested)' : '');
    if (n.indexOf(tag) < 0) n.push(tag);
  });

  // CAM detail lines roll up into the CAM line, as on the sheet.
  const camLine = pl.lines.find((l) => l.section === 'expense' && /^cam\b/.test(l.key));
  const camSubs = pl.lines.filter((l) => l.section === 'cam');
  const rmOf = (l) => rm[l.row] || {};
  const rmCam = {};
  if (camLine) {
    months.forEach((m) => {
      let t = rmOf(camLine)[m] || 0;
      camSubs.forEach((s) => { t += rmOf(s)[m] || 0; });
      rmCam[m] = t;
    });
  }
  const rmFor = (l) => (l === camLine ? rmCam : rmOf(l));
  const sumSection = (sec) => {
    const t = {};
    months.forEach((m) => {
      t[m] = pl.lines.filter((l) => l.section === sec).reduce((s, l) => s + (rmFor(l)[m] || 0), 0);
    });
    return t;
  };
  const gross = sumSection('income');
  const opex = sumSection('expense');
  const noi = {};
  months.forEach((m) => { noi[m] = gross[m] - opex[m]; });

  const rows = pl.lines.map((l) => {
    const isTotal = l.section.indexOf('total') === 0;
    const r = isTotal ? { 'total:gross': gross, 'total:opex': opex, 'total:noi': noi }[l.section] : rmFor(l);
    let note = (notes[l.row] || []).join('; ');
    if (l === camLine && camSubs.length) note = (note ? note + '; ' : '') + 'includes the CAM detail lines below';
    return { label: l.label, kind: isTotal ? 'total' : l.section === 'cam' ? 'cam' : 'line',
      sheet: l.values, rm: r, note: note };
  });
  const cents = (o) => { Object.keys(o).forEach((m) => { o[m] = Math.round(o[m] * 100) / 100; }); return o; };
  rows.forEach((r) => { r.rm = cents(Object.assign({}, r.rm)); });
  unplaced.forEach((u) => cents(u.amounts));
  return { months: months, rows: rows, unplaced: unplaced, newMappings: newMappings };
}

/** Which P&L tab an export is for: the tabs whose street number and street name both appear in it. */
function guessTab(tabs, text) {
  const t = ' ' + norm(text) + ' ';
  return tabs.filter((tab) => {
    const src = tab.name + ' ' + (tab.b1 || '');
    const nums = (src.match(/\d+/g) || []).filter((n) => !/^20\d{2}$/.test(n));
    const words = norm(tab.b1 || tab.name).split(' ').filter((w) => /^[a-z]{4,}$/.test(w) && !/^(street|avenue|drive|budget)$/.test(w));
    if (!nums.length || !words.length) return false;
    const numHit = nums.some((n) => new RegExp('(^|\\D)' + n + '(\\D|$)').test(t));
    const wordHit = t.indexOf(' ' + words[0].slice(0, 5)) >= 0;
    return numHit && wordHit;
  }).map((tab) => tab.name);
}

/* ---------------------------------------------------------------------------
   Google Sheets
   --------------------------------------------------------------------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Rent Manager')
    .addItem('Reconcile this export', 'reconcileActiveExport')
    .addItem('Open the RM Mapping tab', 'openMapping')
    .addSeparator()
    .addItem('Connect to Rent Manager (via the website)', 'connectRm')
    .addItem('Check Rent Manager connection', 'checkRmConnection')
    .addToUi();
}

function isPLTab(sh) {
  if (sh.isSheetHidden()) return false;
  const name = sh.getName();
  if (name.indexOf(OUT_PREFIX) === 0 || name === MAP_TAB) return false;
  return /\bPL\b|Budget/i.test(name) && /^income/i.test(String(sh.getRange('A5').getValue()).trim());
}

function mappingSheet(ss) {
  let sh = ss.getSheetByName(MAP_TAB);
  if (!sh) {
    sh = ss.insertSheet(MAP_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['RM account #', 'RM account name', 'P&L line (first match wins; alternatives with |)', 'Note']])
      .setFontWeight('bold').setBackground('#1A1613').setFontColor('#F5F1E9');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, 1, 110); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 320); sh.setColumnWidth(4, 220);
    sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}

function openMapping() {
  const ss = SpreadsheetApp.getActive();
  ss.setActiveSheet(mappingSheet(ss));
}

function reconcileActiveExport() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const src = ss.getActiveSheet();
  if (isPLTab(src) || src.getName() === MAP_TAB || src.getName().indexOf(OUT_PREFIX) === 0) {
    ui.alert('Open the tab with the Rent Manager export first (File → Import → Insert new sheet), then run this again.');
    return;
  }
  let exp;
  try {
    exp = readExport(src.getDataRange().getValues());
  } catch (err) {
    ui.alert('Could not read "' + src.getName() + '" as a Rent Manager income statement.\n\n' + err.message);
    return;
  }

  const tabs = ss.getSheets().filter(isPLTab).map((sh) => ({ name: sh.getName(), b1: String(sh.getRange('B1').getValue()) }));
  let guess = guessTab(tabs, exp.top + ' ' + src.getName());
  let tabName = guess.length === 1 ? guess[0] : null;
  if (tabName) {
    const ok = ui.alert('Compare with "' + tabName + '"?', ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) tabName = null;
  }
  if (!tabName) {
    const list = tabs.map((t, i) => (i + 1) + '. ' + t.name).join('\n');
    const res = ui.prompt('Which P&L tab is this export for? Type its number.', list, ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    const i = parseInt(res.getResponseText(), 10) - 1;
    if (!(i >= 0 && i < tabs.length)) { ui.alert('No tab with that number.'); return; }
    tabName = tabs[i].name;
  }

  const plSheet = ss.getSheetByName(tabName);
  let pl;
  try {
    pl = readPL(plSheet.getRange(1, 1, Math.min(plSheet.getLastRow(), 80), plSheet.getLastColumn()).getValues(), tabName);
  } catch (err) {
    ui.alert(err.message);
    return;
  }

  const mapSh = mappingSheet(ss);
  const mapRows = mapSh.getLastRow() > 1 ? mapSh.getRange(2, 1, mapSh.getLastRow() - 1, 4).getValues() : [];
  const result = reconcile(pl, exp, mapRows);
  if (result.newMappings.length) {
    mapSh.getRange(mapSh.getLastRow() + 1, 1, result.newMappings.length, 4).setValues(result.newMappings);
    mapSh.getRange(2, 4, mapSh.getLastRow() - 1, 1).getValues().forEach((v, i) => {
      mapSh.getRange(i + 2, 4).setBackground(/^suggested|^not placed/i.test(v[0]) ? '#FFF2CC' : null);
    });
  }

  const out = writeComparison(ss, tabName, src.getName(), result);
  ss.setActiveSheet(out);
  const flagged = countFlagged(result);
  ui.alert('Done: "' + out.getName() + '".\n\n' +
    flagged + ' month/line differences of $' + TOLERANCE + ' or more are highlighted.\n' +
    (result.unplaced.length ? result.unplaced.length + ' Rent Manager accounts could not be placed; they are listed at the bottom.\n' : '') +
    (result.newMappings.length ? result.newMappings.length + ' new accounts were added to "' + MAP_TAB + '" with a suggested line. Check them there and run this again.' : ''));
}

function countFlagged(result) {
  let n = 0;
  result.rows.forEach((r) => result.months.forEach((m) => {
    if (r.kind === 'cam') return;
    if (Math.abs((r.sheet[m] || 0) - (r.rm[m] || 0)) >= TOLERANCE) n++;
  }));
  return n;
}

function writeComparison(ss, tabName, srcName, result) {
  const name = (OUT_PREFIX + tabName).slice(0, 99);
  let sh = ss.getSheetByName(name);
  if (sh) sh.clear(); else sh = ss.insertSheet(name, ss.getSheetByName(tabName).getIndex());
  sh.clearConditionalFormatRules();
  const months = result.months;
  const width = 1 + months.length * 3 + 1;
  const label = (m) => {
    const p = m.split('-');
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1] + ' ' + p[0];
  };
  const pad = (row) => { while (row.length < width) row.push(''); return row; };

  const data = [];
  data.push(pad(['Rent Manager vs "' + tabName + '"']));
  data.push(pad(['From the export on tab "' + srcName + '", ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy h:mm a') +
    '. Difference = sheet minus Rent Manager; highlighted when $' + TOLERANCE + ' or more. The P&L tab is not changed.']));
  const h1 = ['']; const h2 = ['P&L line'];
  months.forEach((m) => { h1.push(label(m), '', ''); h2.push('Sheet', 'Rent Manager', 'Difference'); });
  h1.push(''); h2.push('Rent Manager accounts in this line');
  data.push(h1, h2);
  const bg = data.map(() => new Array(width).fill(null));
  const bold = [];
  result.rows.forEach((r) => {
    const row = [r.kind === 'cam' ? '    ' + r.label : r.label];
    const colors = [null];
    months.forEach((m) => {
      const s = r.sheet[m], v = r.rm[m];
      const has = (s !== null && s !== undefined) || (v !== undefined && v !== 0);
      const d = has ? (s || 0) - (v || 0) : '';
      row.push(s === null || s === undefined ? '' : s, v === undefined ? '' : v, d);
      colors.push(null, null, d !== '' && Math.abs(d) >= TOLERANCE && r.kind !== 'cam' ? '#F4CCCC' : null);
    });
    row.push(r.note);
    colors.push(null);
    if (r.kind === 'total') bold.push(data.length + 1);
    data.push(row); bg.push(colors);
  });
  if (result.unplaced.length) {
    data.push(pad([''])); bg.push(new Array(width).fill(null));
    data.push(pad(['Rent Manager accounts not placed in a line (fix on "' + MAP_TAB + '", then run again)'])); bg.push(new Array(width).fill('#FFF2CC'));
    bold.push(data.length);
    result.unplaced.forEach((u) => {
      const row = [(u.acct ? u.acct + ' ' : '') + u.name];
      months.forEach((m) => row.push('', u.amounts[m] === undefined ? '' : u.amounts[m], ''));
      row.push(u.why);
      data.push(row); bg.push(new Array(width).fill(null));
    });
  }

  sh.getRange(1, 1, data.length, width).setValues(data).setBackgrounds(bg);
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sh.getRange(2, 1).setFontColor('#666666');
  sh.getRange(3, 1, 2, width).setFontWeight('bold').setBackground('#1A1613').setFontColor('#F5F1E9');
  months.forEach((m, i) => sh.getRange(3, 2 + i * 3, 1, 3).merge().setHorizontalAlignment('center'));
  bold.forEach((r) => sh.getRange(r, 1, 1, width).setFontWeight('bold'));
  sh.getRange(5, 2, Math.max(data.length - 4, 1), months.length * 3).setNumberFormat('#,##0.00;(#,##0.00);"–"');
  sh.setFrozenRows(4); sh.setFrozenColumns(1);
  sh.setColumnWidth(1, 280);
  sh.setColumnWidths(2, months.length * 3, 96);
  sh.setColumnWidth(width, 420);
  return sh;
}

/* ---------------------------------------------------------------------------
   Rent Manager directly, through the website's Worker

   The Rent Manager accounting login is a secret on the website's Cloudflare
   Worker (RM_ACCT_USERNAME, RM_ACCT_PASSWORD), never in this sheet. The sheet
   holds only the address and the token (PL_SHEET_TOKEN) that lets it ask the
   Worker, in this script's Script Properties: anyone who can edit the script
   can see them, and they can read the P&L numbers, nothing else.
   --------------------------------------------------------------------------- */

const CONN_TAB = 'RM Connection';
const DEFAULT_API = 'https://www.charlottesquareroc.com/api/pl';

function connectRm() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const res = ui.prompt('Connect to Rent Manager',
    'Paste the PL_SHEET_TOKEN that was added on the website\'s Worker in Cloudflare.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const token = res.getResponseText().trim();
  if (token.length < 24) { ui.alert('That token is too short. It should be the same long random text as PL_SHEET_TOKEN in Cloudflare.'); return; }
  props.setProperty('PL_SHEET_TOKEN', token);
  if (!props.getProperty('PL_API_URL')) props.setProperty('PL_API_URL', DEFAULT_API);
  ui.alert('Saved. Now: Rent Manager → Check Rent Manager connection.');
}

function plApi(query) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('PL_SHEET_TOKEN');
  if (!token) throw new Error('Not connected yet: Rent Manager → Connect to Rent Manager (via the website).');
  const res = UrlFetchApp.fetch((props.getProperty('PL_API_URL') || DEFAULT_API) + query, {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
  });
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { error: res.getContentText().slice(0, 300) }; }
  if (res.getResponseCode() === 401) throw new Error('The website did not accept the token. Run Connect again with the PL_SHEET_TOKEN from Cloudflare.');
  if (res.getResponseCode() >= 400) throw new Error(body.error || ('The website answered ' + res.getResponseCode() + '.'));
  return body;
}

/** GL accounts worth a P&L line: income and expense, or any whose type is unknown. */
function plAccounts(accounts) {
  return accounts.filter((a) => !/asset|liabilit|equity|bank|cash|receivable|payable|deposit held/i.test(a.type || ''));
}

function checkRmConnection() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  let r;
  try { r = plApi('?check'); } catch (err) { ui.alert(err.message); return; }

  let sh = ss.getSheetByName(CONN_TAB);
  if (sh) sh.clear(); else sh = ss.insertSheet(CONN_TAB);
  const tabs = ss.getSheets().filter(isPLTab).map((s) => ({ name: s.getName(), b1: String(s.getRange('B1').getValue()) }));
  const rows = [];
  const W = 5;
  const pad = (row) => { while (row.length < W) row.push(''); return row.slice(0, W); };
  rows.push(pad(['Rent Manager connection, ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy h:mm a') +
    (r.note ? ' (' + r.note + ')' : '')]));
  rows.push(pad(['Company: ' + r.company + (r.rate && r.rate.remaining !== null ? ' · Rent Manager API calls left this hour: ' + r.rate.remaining : '')]));
  rows.push(pad(['']));
  rows.push(pad(['Properties (' + r.properties.length + ')', 'Rent Manager ID', 'Short name', 'P&L tab (check, and correct if wrong)', 'Active']));
  const header1 = rows.length;
  r.properties.forEach((p) => {
    const g = guessTab(tabs, p.name + ' ' + p.short);
    rows.push(pad([p.name, p.id, p.short, g.length === 1 ? g[0] : '', p.active === null ? '' : String(p.active)]));
  });
  if (!r.properties.length) rows.push(pad(['None read (Rent Manager answered ' + r.propertiesStatus + (r.propertiesSaid ? ': ' + r.propertiesSaid : '') + ')']));
  rows.push(pad(['']));
  rows.push(pad(['What Rent Manager answers (for whoever maintains this script)', 'Status', 'Records', 'Message', 'Fields']));
  const header2 = rows.length;
  r.probes.forEach((p) => rows.push(pad([p.path, p.status, p.count, p.said || '', p.fields ? JSON.stringify(p.fields) : ''])));
  sh.getRange(1, 1, rows.length, W).setValues(rows);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  [header1, header2].forEach((h) => sh.getRange(h, 1, 1, W).setFontWeight('bold').setBackground('#1A1613').setFontColor('#F5F1E9'));
  sh.setColumnWidth(1, 320); sh.setColumnWidths(2, 2, 110); sh.setColumnWidth(4, 300); sh.setColumnWidth(5, 600);
  sh.getRange(header2 + 1, 5, Math.max(r.probes.length, 1), 1).setWrap(false);

  // The chart of accounts into RM Mapping, with a suggested line for each new one.
  const mapSh = mappingSheet(ss);
  const have = {};
  if (mapSh.getLastRow() > 1) {
    mapSh.getRange(2, 1, mapSh.getLastRow() - 1, 2).getValues().forEach((v) => {
      if (String(v[0]).trim()) have[String(v[0]).trim()] = 1; else if (v[1]) have['name:' + norm(v[1])] = 1;
    });
  }
  const add = plAccounts(r.accounts || [])
    .filter((a) => !(a.number ? have[a.number] : have['name:' + norm(a.name)]))
    .map((a) => {
      const s = suggest(a.name);
      return [a.number, a.name, s, (s ? 'Suggested: check' : 'Not placed: choose a line') + (a.type ? ' · ' + a.type : '')];
    });
  if (add.length) {
    mapSh.getRange(mapSh.getLastRow() + 1, 1, add.length, 4).setValues(add);
    mapSh.getRange(mapSh.getLastRow() - add.length + 1, 4, add.length, 1).setBackground('#FFF2CC');
  }
  ss.setActiveSheet(sh);
  ui.alert('Connected to Rent Manager.\n\n' + r.properties.length + ' properties and ' + (r.accounts || []).length +
    ' GL accounts read. ' + add.length + ' accounts added to "' + MAP_TAB + '" with a suggested P&L line.\n\n' +
    'Check the P&L tab beside each property on "' + CONN_TAB + '", and send that tab to whoever maintains this script: ' +
    'its last table says how Rent Manager hands out the monthly numbers.');
}

// Lets the pure helpers be tested in Node; Apps Script ignores this.
if (typeof module !== 'undefined') {
  module.exports = { parseMonth, parseMoney, norm, readPL, readExport, reconcile, suggest, findLine, guessTab };
}
