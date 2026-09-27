/**
 * Charlotte Square: the leasing team's lead sheet, in Google Sheets.
 *
 * New enquiries from the website arrive on the Leads tab, newest at the top.
 * Each row has a Status dropdown, an Owner dropdown, a Next step date, a
 * Replied checkbox and a Notes column for the team. A new lead nobody has
 * replied to after a day turns pale red; a Next step date that has come
 * round turns red. The Overview tab has the numbers at a glance under the
 * Charlotte Square logo. The dropdown choices live on the Lists tab, so the
 * team can change them without touching this code.
 *
 * The website sends each enquiry to this script's web-app address with a
 * secret token. Nothing without the token can add a row, and the web app can
 * only add rows: it cannot read, change or delete anything.
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
 *      Web app URL. ("Anyone" lets the website reach it; the token keeps
 *      everyone else out. Who can SEE the sheet is its Share setting.)
 *   5. In Cloudflare, on the Worker, Settings → Variables and Secrets, add two
 *      secrets: LEADS_SHEET_URL (the Web app URL) and LEADS_SHEET_TOKEN (the
 *      token from step 3).
 *   6. Share the sheet (Share button) with the leasing team as Editors.
 *      Keep it inside the Workspace: it holds prospects' contact details.
 *
 * UPDATING THIS CODE LATER: paste over the old code, Save, Run setup (it
 * restyles and never deletes a lead), then Deploy → Manage deployments →
 * pencil → Version: New version → Deploy. The web-app address stays the same.
 *
 * Lost the token? Open the sheet: Charlotte Square menu → Show the connection
 * token.
 */

const LEADS = 'Leads';
const LISTS = 'Lists';
const OVERVIEW = 'Overview';
const ROWS = 1000;     // rows made ready with dropdowns; new leads push them down
const ROW_H = 44;      // every lead row: two lines of a message, then clipped

const HEADERS = ['Received', 'Status', 'Owner', 'Next step', 'Replied', 'Name', 'Email', 'Phone',
  'Interested in', 'Home', 'Move-in', 'Heard about us', 'Came via', 'Message', 'Notes', 'Enquiry #', 'Form'];
const WIDTHS = [150, 128, 110, 110, 76, 170, 220, 130, 170, 120, 150, 150, 170, 380, 280, 86, 76];
const COL = {};
HEADERS.forEach((h, i) => { COL[h] = i + 1; });

// The website's own colours and type.
const INK = '#1A1613';
const STONE = '#F5F1E9';
const PAGE = '#F3F0EB';
const ELEV = '#FAF8F5';
const LINE = '#E7E2DA';
const MUTED = '#8A8580';
const SUBTLE = '#6B6660';
const OXBLOOD = '#7A1F12';
const SERIF = 'Instrument Serif';
const SANS = 'DM Sans';

// Status: the choice, its chip colour and its text colour.
const STATUS = [
  ['New', '#F6DEDA', '#7A1F12'],
  ['Contacted', '#F7EBD0', '#7D6220'],
  ['Tour booked', '#DCE7F1', '#294B6B'],
  ['Toured', '#E5E0EF', '#4A3D6B'],
  ['Applied', '#DFEBE4', '#2E473F'],
  ['Leased', '#2E473F', '#FFFFFF'],
  ['Not a fit', '#ECE8E2', '#6B6660'],
  ['No reply', '#ECE8E2', '#6B6660'],
];
const CLOSED = ['Leased', 'Not a fit', 'No reply'];
const OWNERS = ['Vicki', 'Gianni', 'Unassigned'];
// "Heard about us", worded as the website sends it.
const SOURCES = ['Search', 'Apartment listing site', 'Social media', 'Walked by', 'Friend or resident'];

/** Run this one. (It is first so the editor's Run menu picks it.)
 *  Builds and styles the Overview, Leads and Lists tabs. Safe to run again:
 *  it restyles, and never deletes a lead. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  let leads = ss.getSheetByName(LEADS);
  if (!leads) {
    const first = ss.getSheets()[0];
    leads = ss.getSheets().length === 1 && first.getLastRow() === 0 ? first.setName(LEADS) : ss.insertSheet(LEADS);
  }
  const lists = ss.getSheetByName(LISTS) || ss.insertSheet(LISTS);
  const overview = ss.getSheetByName(OVERVIEW) || ss.insertSheet(OVERVIEW);

  buildLists_(lists);
  buildLeads_(leads, lists);
  buildOverview_(overview);

  // Overview, Leads, Lists, left to right; open on Leads, where the work is.
  ss.setActiveSheet(overview); ss.moveActiveSheet(1);
  ss.setActiveSheet(leads); ss.moveActiveSheet(2);
  ss.setActiveSheet(lists); ss.moveActiveSheet(3);
  ss.setActiveSheet(leads);

  const token = tokenFor_();
  console.log('Connection token. Paste the next line, and only that, into Cloudflare as the secret LEADS_SHEET_TOKEN:');
  console.log(token);
  ss.toast('Done. The connection token is in the Apps Script execution log, or use Charlotte Square → Show the connection token.', 'Lead sheet ready', 15);
}

/* ---- Lists: the dropdown choices, the team's to edit ---------------------- */
function buildLists_(lists) {
  if (lists.getLastRow() === 0) {
    lists.getRange(2, 1, STATUS.length, 1).setValues(STATUS.map((s) => [s[0]]));
    lists.getRange(2, 2, OWNERS.length, 1).setValues(OWNERS.map((o) => [o]));
  }
  lists.getRange(1, 1, 1, 2).setValues([['Status', 'Owner']]);
  lists.getRange(1, 3).setValue('Edit these lists and the dropdowns on Leads follow. One choice per cell.');
  lists.getRange(1, 1, lists.getMaxRows(), 3).setFontFamily(SANS).setFontSize(10).setVerticalAlignment('middle');
  lists.getRange(1, 1, 1, 2).setBackground(INK).setFontColor(STONE).setFontWeight('bold');
  lists.getRange(1, 3).setFontColor(MUTED).setFontStyle('italic');
  lists.setRowHeight(1, 36);
  lists.setColumnWidths(1, 2, 190);
  lists.setColumnWidth(3, 480);
  lists.setFrozenRows(1);
  lists.setTabColor('#948A7E');
  lists.setConditionalFormatRules(statusRules_(lists.getRange(1, 1, lists.getMaxRows(), 1)));
}

/* ---- Leads: one row per enquiry ------------------------------------------ */
function buildLeads_(leads, lists) {
  if (leads.getMaxRows() < ROWS) leads.insertRowsAfter(leads.getMaxRows(), ROWS - leads.getMaxRows());
  if (leads.getMaxColumns() < HEADERS.length) {
    leads.insertColumnsAfter(leads.getMaxColumns(), HEADERS.length - leads.getMaxColumns());
  }
  const last = leads.getMaxRows();
  const width = HEADERS.length;

  // Column titles: ink, like the website's footer, with a note on the ones to use.
  const head = leads.getRange(1, 1, 1, width);
  head.setValues([HEADERS]).setBackground(INK).setFontColor(STONE).setFontFamily(SANS).setFontSize(10)
    .setFontWeight('bold').setVerticalAlignment('middle').setHorizontalAlignment('left');
  leads.setRowHeight(1, 40);
  leads.setFrozenRows(1);
  WIDTHS.forEach((w, i) => leads.setColumnWidth(i + 1, w));
  const notes = {
    'Status': 'Where this lead stands. The choices are on the Lists tab.',
    'Owner': 'Who is looking after it.',
    'Next step': 'When to follow up. Double-click for a calendar. Turns red on the day.',
    'Replied': 'Tick once someone has replied. A New lead with no reply after a day turns the row pale red.',
    'Notes': 'Anything the team should know.',
    'Enquiry #': 'The same number as on the website dashboard.',
  };
  HEADERS.forEach((h, i) => leads.getRange(1, i + 1).setNote(notes[h] || ''));

  // The body: the website's type, calm rows, room to read.
  const body = leads.getRange(2, 1, last - 1, width);
  body.setFontFamily(SANS).setFontSize(10).setFontColor(INK).setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  leads.setRowHeightsForced(2, last - 1, ROW_H);
  const col = (name) => leads.getRange(2, COL[name], last - 1, 1);
  col('Received').setNumberFormat('mmm d, h:mm am/pm').setFontColor(SUBTLE);
  col('Name').setFontWeight('bold');
  col('Email').setFontColor(OXBLOOD);
  ['Name', 'Email', 'Phone', 'Came via', 'Message', 'Notes'].forEach((h) => col(h).setNumberFormat('@'));
  col('Message').setWrap(true);
  col('Notes').setWrap(true);
  col('Status').setFontWeight('bold').setHorizontalAlignment('center');
  col('Owner').setHorizontalAlignment('center');
  col('Replied').setHorizontalAlignment('center').setFontColor(OXBLOOD);
  col('Next step').setNumberFormat('ddd mmm d').setHorizontalAlignment('center');
  col('Enquiry #').setFontColor(MUTED).setHorizontalAlignment('center');
  col('Form').setFontColor(MUTED).setHorizontalAlignment('center');

  // Dropdowns, date picker and checkbox. requireCheckbox leaves any ticks as
  // they are, where insertCheckboxes would clear them.
  col('Status').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(lists.getRange('A2:A'), true).setAllowInvalid(false).build());
  col('Owner').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(lists.getRange('B2:B'), true).setAllowInvalid(false).build());
  col('Next step').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireDate().setAllowInvalid(false).setHelpText('Pick a date: double-click for the calendar.').build());
  col('Replied').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  // Alternate rows in white and the website's paper tone. From the title row
  // down, so a lead added just under the titles is inside it and picks it up.
  leads.getBandings().forEach((b) => b.remove());
  leads.getRange(1, 1, last, width).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(INK).setFirstRowColor('#FFFFFF').setSecondRowColor(ELEV);
  leads.setHiddenGridlines(true);

  // Colours that mean something. Every rule also starts at the title row, for
  // the same reason; none of them can match a title.
  const whole = (name) => leads.getRange(1, COL[name], last, 1);
  const rules = statusRules_(whole('Status'));
  const closed = CLOSED.map((s) => `$B1="${s}"`).join(',');
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=AND(ISNUMBER($D1), $D1<=TODAY(), NOT(OR(${closed})))`)
    .setFontColor(OXBLOOD).setBold(true).setBackground('#FBEDEA').setRanges([whole('Next step')]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($B1="New", $E1<>TRUE, ISNUMBER($A1), NOW()-$A1>1)')
    .setBackground('#FBEDEA').setRanges([leads.getRange(1, 1, last, width)]).build());
  leads.setConditionalFormatRules(rules);

  // A nudge, not a lock, on the titles: the website writes by position.
  leads.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter((p) => p.getDescription() === 'Column titles').forEach((p) => p.remove());
  head.protect().setDescription('Column titles').setWarningOnly(true);

  if (!leads.getFilter()) leads.getRange(1, 1, last, width).createFilter();
  leads.setTabColor(OXBLOOD);
}

/** The status chip colours, for any range of statuses. */
function statusRules_(range) {
  return STATUS.map((s) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(s[0]).setBackground(s[1]).setFontColor(s[2]).setBold(true).setRanges([range]).build());
}

/* ---- Overview: the numbers at a glance, under the logo --------------------- */
function buildOverview_(sheet) {
  sheet.clear();
  sheet.getImages().forEach((img) => img.remove());
  sheet.setConditionalFormatRules([]);
  if (sheet.getMaxRows() < 40) sheet.insertRowsAfter(sheet.getMaxRows(), 40 - sheet.getMaxRows());
  if (sheet.getMaxColumns() < 9) sheet.insertColumnsAfter(sheet.getMaxColumns(), 9 - sheet.getMaxColumns());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.setHiddenGridlines(true);

  // A four-column grid: B, D, F, H hold content; A, C, E, G, I are gutters.
  [28, 210, 22, 210, 22, 210, 22, 210, 28].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.getRange(1, 1, 40, 9).setBackground(PAGE).setFontFamily(SANS).setFontSize(10).setFontColor(INK)
    .setVerticalAlignment('middle');

  // The banner: ink, the Charlotte Square logo, and Evolution24's.
  sheet.getRange('B2:H5').setBackground(INK);
  [[1, 20], [2, 18], [3, 44], [4, 30], [5, 18]].forEach(([r, h]) => sheet.setRowHeight(r, h));
  sheet.insertImage(image_(LOGO_PNG, 'charlotte-square.png'), 2, 3, 22, 3).setWidth(258).setHeight(69);
  sheet.getRange('F3:F4').merge();
  sheet.getRange('F3').setValue('LEAD SHEET').setFontSize(9).setFontWeight('bold')
    .setFontColor('#948A7E').setHorizontalAlignment('right');
  sheet.insertImage(image_(EVO_PNG, 'evolution24.png'), 8, 3, 66, 6).setWidth(120).setHeight(49);

  // Four numbers.
  sheet.setRowHeight(6, 20);
  const tiles = [
    ['NEW · LAST 7 DAYS', '=COUNTIF(Leads!A:A,">="&(NOW()-7))', 'enquiries received'],
    ['WAITING FOR A REPLY', '=COUNTIFS(Leads!B:B,"New",Leads!E:E,FALSE)', 'New, and Replied not ticked'],
    ['FOLLOW-UPS DUE', `=COUNTIFS(Leads!D:D,"<="&TODAY(),${CLOSED.map((s) => `Leads!B:B,"<>${s}"`).join(',')})`, 'Next step is today or past'],
    ['TOURS BOOKED', '=COUNTIF(Leads!B:B,"Tour booked")', 'status Tour booked'],
  ];
  [[7, 30], [8, 50], [9, 28]].forEach(([r, h]) => sheet.setRowHeight(r, h));
  tiles.forEach(([label, formula, caption], i) => {
    const c = 2 + i * 2;
    sheet.getRange(7, c, 3, 1).setBackground('#FFFFFF')
      .setBorder(true, true, true, true, false, false, LINE, SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(7, c).setValue(label).setFontSize(8).setFontWeight('bold').setFontColor(MUTED)
      .setVerticalAlignment('bottom');
    sheet.getRange(8, c).setFormula(formula).setFontFamily(SERIF).setFontSize(30).setHorizontalAlignment('left');
    sheet.getRange(9, c).setValue(caption).setFontSize(9).setFontColor(MUTED).setVerticalAlignment('top');
  });
  // Waiting and due turn oxblood when there is anything in them.
  const rules = ['D8', 'F8'].map((a1) => SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setFontColor(OXBLOOD).setRanges([sheet.getRange(a1)]).build());

  // By status, each with a bar.
  sheet.setRowHeight(10, 26);
  sheet.getRange('B11').setValue('BY STATUS').setFontSize(8).setFontWeight('bold').setFontColor(MUTED);
  sheet.getRange('H11').setFormula('=COUNT(Leads!P:P)&" leads in all"').setFontSize(9).setFontColor(MUTED)
    .setHorizontalAlignment('right');
  const top = 12;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const r = top + i;
    sheet.setRowHeight(r, 30);
    sheet.getRange(r, 2).setFormula(`=IF(Lists!A${i + 2}="","",Lists!A${i + 2})`)
      .setHorizontalAlignment('center').setFontWeight('bold');
    sheet.getRange(r, 4, 1, 3).merge();
    sheet.getRange(r, 4).setFormula(
      `=IF(B${r}="","",SPARKLINE(H${r},{"charttype","bar";"max",MAX(1,MAX($H$${top}:$H$${top + n - 1}));"color1","${OXBLOOD}"}))`);
    sheet.getRange(r, 8).setFormula(`=IF(B${r}="","",COUNTIF(Leads!B:B,B${r}))`)
      .setFontFamily(SERIF).setFontSize(16).setHorizontalAlignment('right');
  }
  statusRules_(sheet.getRange(top, 2, n, 1)).forEach((rule) => rules.push(rule));

  // Where they heard about us.
  const head = top + n + 1;
  sheet.setRowHeight(head - 1, 26);
  sheet.getRange(head, 2).setValue('WHERE THEY HEARD ABOUT US').setFontSize(8).setFontWeight('bold').setFontColor(MUTED);
  const labels = SOURCES.concat(['Not given']);
  labels.forEach((label, i) => {
    const r = head + 1 + i;
    sheet.setRowHeight(r, 30);
    sheet.getRange(r, 2).setValue(label).setFontColor(SUBTLE);
    sheet.getRange(r, 8).setFormula(label === 'Not given'
      ? '=COUNTIFS(Leads!P:P,">0",Leads!L:L,"")'
      : `=COUNTIF(Leads!L:L,"${label}")`)
      .setFontFamily(SERIF).setFontSize(16).setHorizontalAlignment('right');
    sheet.getRange(r, 4, 1, 3).merge();
    sheet.getRange(r, 4).setFormula(
      `=SPARKLINE(H${r},{"charttype","bar";"max",MAX(1,MAX($H$${head + 1}:$H$${head + labels.length}));"color1","#2E473F"})`);
  });

  const foot = head + labels.length + 2;
  sheet.getRange(foot, 2, 1, 7).merge();
  sheet.getRange(foot, 2)
    .setValue('Updates by itself as enquiries arrive from the website. Change the dropdown choices on the Lists tab.')
    .setFontSize(9).setFontColor(MUTED).setFontStyle('italic');
  sheet.setConditionalFormatRules(rules);
  sheet.setTabColor(INK);
}

function image_(b64, name) {
  return Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', name);
}

/** Menu in the sheet itself. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Charlotte Square')
    .addItem('Show the connection token', 'showToken')
    .addItem('Set up and restyle the sheet', 'setup')
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

    // Newest at the top, with the dropdowns, checkbox and look of the row below.
    sheet.insertRowBefore(2);
    const row = sheet.getRange(2, 1, 1, HEADERS.length);
    const below = sheet.getRange(3, 1, 1, HEADERS.length);
    below.copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    below.copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    sheet.setRowHeightsForced(2, 1, ROW_H);

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

    // The address as a link that starts an email to them. A link, not a
    // formula, so nothing they typed can run.
    const email = String(lead.email || '');
    if (/^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/.test(email)) {
      sheet.getRange(2, COL['Email']).setRichTextValue(SpreadsheetApp.newRichTextValue()
        .setText(email).setLinkUrl('mailto:' + email)
        .setTextStyle(SpreadsheetApp.newTextStyle().setForegroundColor(OXBLOOD).setUnderline(false).build())
        .build());
    }
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

/* The Charlotte Square logo in white (the C from the building's sign, the
   name and "at the East End"), and Evolution24's logo in white, as PNGs.
   Kept here so the sheet needs no outside address to show them. */
const LOGO_PNG = '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';
const EVO_PNG = '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';
