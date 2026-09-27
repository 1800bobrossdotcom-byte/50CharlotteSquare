/**
 * Charlotte Square: the leasing team's lead sheet, in Google Sheets.
 *
 * New enquiries from the website arrive here as rows, newest at the top. Each
 * row has a Status dropdown, an Owner dropdown, a Next step date, a Replied
 * checkbox and a Notes column for the team. A new lead nobody has replied to
 * after a day turns pale red. The dropdown choices live on the Lists tab, so
 * the team can change them without touching this code.
 *
 * The website sends each enquiry to this script's web-app address with a
 * secret token. Nothing without the token can add a row.
 *
 * ONE-TIME SETUP (about five minutes)
 *   1. Signed in with your Evolution24 Google Workspace account, make a new
 *      Google Sheet (sheets.new) and name it, e.g. "Charlotte Square leads".
 *      Whoever makes it owns it; the script runs as them.
 *   2. Extensions → Apps Script. Delete the sample code, paste this whole file
 *      in, and press Save.
 *   3. Press Save first. Then, in the toolbar, check the function menu says
 *      "setup" and press Run. Allow access when Google asks (if it says the
 *      app isn't verified: Advanced → Go to the project). The sheet gets its
 *      tabs, dropdowns and colours. The connection token appears in the
 *      Execution log at the bottom.
 *   4. Deploy → New deployment → gear icon → Web app.
 *      Execute as: Me. Who has access: Anyone. Press Deploy and copy the
 *      Web app URL.
 *   5. In Cloudflare, on the Worker, Settings → Variables and Secrets, add two
 *      secrets: LEADS_SHEET_URL (the Web app URL) and LEADS_SHEET_TOKEN (the
 *      token from step 3).
 *   6. Share the sheet (Share button) with the leasing team as Editors.
 *      Keep it inside the Workspace: it holds prospects' contact details.
 *
 * Lost the token? Open the sheet: Charlotte Square menu → Show the connection
 * token. Changed this code later? Deploy → Manage deployments → edit → Version:
 * New version, so the web app runs the new code at the same address.
 */

const LEADS = 'Leads';
const LISTS = 'Lists';
const ROWS = 1000;   // rows made ready with dropdowns; new leads push them down

const HEADERS = ['Received', 'Status', 'Owner', 'Next step', 'Replied', 'Name', 'Email', 'Phone',
  'Interested in', 'Home', 'Move-in', 'Heard about us', 'Came via', 'Message', 'Notes', 'Enquiry #', 'Form'];
const WIDTHS = [140, 120, 110, 100, 70, 160, 210, 125, 160, 110, 130, 130, 170, 360, 260, 80, 70];
const COL = {};
HEADERS.forEach((h, i) => { COL[h] = i + 1; });

// Status: the choice, and its colour in the sheet.
const STATUS = [
  ['New', '#F4C7C3'], ['Contacted', '#FCE8B2'], ['Tour booked', '#C9DAF8'], ['Toured', '#D9D2E9'],
  ['Applied', '#B7E1CD'], ['Leased', '#93C47D'], ['Not a fit', '#E0E0E0'], ['No reply', '#E0E0E0'],
];
const OWNERS = ['Vicki', 'Gianni', 'Unassigned'];

/** Run this one. (It is first so the editor's Run menu picks it.)
 *  Builds the Leads and Lists tabs. Safe to run again: it never deletes a lead. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  let leads = ss.getSheetByName(LEADS);
  if (!leads) {
    const first = ss.getSheets()[0];
    leads = ss.getSheets().length === 1 && first.getLastRow() === 0 ? first.setName(LEADS) : ss.insertSheet(LEADS, 0);
  }
  const lists = ss.getSheetByName(LISTS) || ss.insertSheet(LISTS);

  // The dropdown choices, written once; after that they are the team's to edit.
  if (lists.getLastRow() === 0) {
    lists.getRange(1, 1, 1, 2).setValues([['Status', 'Owner']]).setFontWeight('bold');
    lists.getRange(2, 1, STATUS.length, 1).setValues(STATUS.map((s) => [s[0]]));
    lists.getRange(2, 2, OWNERS.length, 1).setValues(OWNERS.map((o) => [o]));
    lists.setColumnWidths(1, 2, 180);
    lists.setFrozenRows(1);
  }

  if (leads.getMaxRows() < ROWS) leads.insertRowsAfter(leads.getMaxRows(), ROWS - leads.getMaxRows());
  if (leads.getMaxColumns() < HEADERS.length) {
    leads.insertColumnsAfter(leads.getMaxColumns(), HEADERS.length - leads.getMaxColumns());
  }
  leads.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#1A1613').setFontColor('#F5F1E9').setVerticalAlignment('middle');
  leads.setFrozenRows(1);
  leads.setRowHeight(1, 34);
  WIDTHS.forEach((w, i) => leads.setColumnWidth(i + 1, w));

  const body = (name) => leads.getRange(2, COL[name], ROWS - 1, 1);
  body('Status').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(lists.getRange('A2:A'), true).setAllowInvalid(false).build());
  body('Owner').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(lists.getRange('B2:B'), true).setAllowInvalid(false).build());
  body('Next step').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireDate().setAllowInvalid(false).setHelpText('Pick a date: double-click for the calendar.').build())
    .setNumberFormat('ddd mmm d');
  body('Replied').insertCheckboxes();
  body('Received').setNumberFormat('mmm d, h:mm am/pm');
  // Text as typed: a phone number stays a phone number, not a sum.
  ['Name', 'Email', 'Phone', 'Came via', 'Message', 'Notes'].forEach((h) => body(h).setNumberFormat('@'));
  body('Message').setWrap(true);
  body('Notes').setWrap(true);
  leads.getRange(2, 1, ROWS - 1, HEADERS.length).setVerticalAlignment('top');

  // Status colours, then a pale red row for a new lead with no reply after a day.
  const all = leads.getRange(2, 1, ROWS - 1, HEADERS.length);
  const rules = STATUS.map((s) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(s[0]).setBackground(s[1]).setRanges([body('Status')]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($B2="New", $E2=FALSE, $A2<>"", NOW()-$A2>1)')
    .setBackground('#FDECEA').setRanges([all]).build());
  leads.setConditionalFormatRules(rules);

  if (!leads.getFilter()) leads.getRange(1, 1, ROWS, HEADERS.length).createFilter();
  ss.setActiveSheet(leads);

  const token = tokenFor_();
  console.log('Connection token. Paste the next line, and only that, into Cloudflare as the secret LEADS_SHEET_TOKEN:');
  console.log(token);
  ss.toast('Done. The connection token is in the Apps Script execution log, or use Charlotte Square → Show the connection token.', 'Lead sheet ready', 15);
}

/** Menu in the sheet itself. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Charlotte Square')
    .addItem('Show the connection token', 'showToken')
    .addItem('Set up the sheet again', 'setup')
    .addToUi();
}

/** The shared secret, made once and kept in this script's properties. */
function tokenFor_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  return token;
}

function showToken() {
  const ui = SpreadsheetApp.getUi();
  ui.alert('Connection token', 'Paste this into Cloudflare as the secret LEADS_SHEET_TOKEN:\n\n' + tokenFor_(), ui.ButtonSet.OK);
}

/** Opening the web-app address in a browser just says it is there. */
function doGet() {
  return ContentService.createTextOutput('The Charlotte Square lead sheet is connected. The website sends new enquiries here.');
}

/** One enquiry from the website: {token, lead}. Answers {ok} or {ok:false, error}. */
function doPost(e) {
  const answer = (obj) => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return answer({ ok: false, error: 'Not JSON.' });
  }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || !body || body.token !== token) return answer({ ok: false, error: 'Wrong token.' });

  const lead = body.lead || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(LEADS);
    if (!sheet) return answer({ ok: false, error: 'Run setup first.' });

    // The website may send the same enquiry twice (a retry): keep one row.
    const id = String(lead.id || '');
    if (id) {
      const ids = sheet.getRange(2, COL['Enquiry #'], Math.max(sheet.getLastRow() - 1, 1), 1);
      if (ids.createTextFinder(id).matchEntireCell(true).findNext()) return answer({ ok: true, duplicate: true });
    }

    // Newest at the top, with the dropdowns, checkbox and formats of the row below.
    sheet.insertRowBefore(2);
    const row = sheet.getRange(2, 1, 1, HEADERS.length);
    const below = sheet.getRange(3, 1, 1, HEADERS.length);
    below.copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    below.copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);

    const received = new Date(lead.received);
    const values = {
      'Received': isNaN(received) ? new Date() : received,
      'Status': 'New',
      'Owner': '',
      'Next step': '',
      'Replied': false,
      'Name': text_(lead.name),
      'Email': text_(lead.email),
      'Phone': text_(lead.phone),
      'Interested in': text_(lead.interest),
      'Home': text_(lead.home),
      'Move-in': text_(lead.move_in),
      'Heard about us': text_(lead.source),
      'Came via': text_(lead.came_via),
      'Message': text_(lead.message),
      'Notes': '',
      'Enquiry #': id ? Number(id) : '',
      'Form': text_(lead.form),
    };
    row.setValues([HEADERS.map((h) => values[h])]);
    return answer({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/** Whatever a visitor typed, as plain text. A leading = + - or @ would make
 *  Sheets treat it as a formula, which a stranger could use to fetch data or
 *  plant a link; a leading apostrophe keeps it text and does not show. */
function text_(v) {
  const s = v == null ? '' : String(v).slice(0, 5000);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
