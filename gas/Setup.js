// Run setup() once from the Apps Script editor. It authorizes the scopes and
// creates the spreadsheet, the 「日程調整」 calendar and default calendar rules.
// Running it again keeps existing data and only fills in what is missing.

var BOOKING_CALENDAR_NAME = '日程調整';

// Default rules matched by calendar name (spec §5). Anything unmatched is block/30.
var DEFAULT_RULES_BY_NAME = [
  { match: /松尾研/, kind: 'soft' },
  { match: /^家族$/, kind: 'soft' },
  { match: /祝日/, kind: 'ignore' },
];

function setup() {
  var props = props_();
  var ss = null;
  var id = props.getProperty('SHEET_ID');
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('日程調整 with 下野 データ');
    props.setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(SHEET).forEach(function (k) {
    var def = SHEET[k];
    var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
    if (sh.getLastRow() === 0) sh.appendRow(def.header);
    sh.getRange(1, 1, sh.getMaxRows(), def.header.length).setNumberFormat('@');
  });
  var blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  var cal = CalendarApp.getCalendarById(getSetting_('bookingCalendarId', '')) ||
    CalendarApp.getOwnedCalendarsByName(BOOKING_CALENDAR_NAME)[0] ||
    CalendarApp.createCalendar(BOOKING_CALENDAR_NAME);
  setSetting_('bookingCalendarId', cal.getId());

  if (getSetting_('ownerName', null) === null) setSetting_('ownerName', '下野');

  var rules = getSetting_('calendarRules', {});
  var owner = Session.getEffectiveUser().getEmail();
  CalendarApp.getAllCalendars().forEach(function (c) {
    var cid = c.getId();
    if (rules[cid]) return;
    var kind = 'block';
    var hit = DEFAULT_RULES_BY_NAME.filter(function (r) { return r.match.test(c.getName()); })[0];
    if (hit) kind = hit.kind;
    else if (/@/.test(cid) && !/@group\./.test(cid) && cid !== owner) kind = 'ignore'; // someone else's personal calendar
    rules[cid] = { name: c.getName(), kind: kind, bufferMin: kind === 'ignore' ? 0 : 30 };
  });
  setSetting_('calendarRules', rules);
  bumpVersion_();
  Logger.log('setup done. sheet=%s calendars=%s', ss.getUrl(), Object.keys(rules).length);
}
