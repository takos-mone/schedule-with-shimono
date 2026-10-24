// Minimal in-memory fakes of the Apps Script services used by gas/*.js.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function makeSheet(name) {
  const rows = [];
  const sheet = {
    name,
    rows,
    getLastRow: () => rows.length,
    getMaxRows: () => Math.max(rows.length, 1000),
    appendRow: (r) => { rows.push(r.slice()); },
    getRange: (row, col, nRows = 1, nCols = 1) => ({
      getValues: () => rows.slice(row - 1, row - 1 + nRows).map((r) => {
        const out = [];
        for (let j = 0; j < nCols; j++) out.push(r[col - 1 + j] === undefined ? '' : r[col - 1 + j]);
        return out;
      }),
      setValues: (vals) => vals.forEach((v, i) => {
        const r = rows[row - 1 + i] || (rows[row - 1 + i] = []);
        v.forEach((x, j) => { r[col - 1 + j] = x; });
      }),
      setValue: (v) => { (rows[row - 1] || (rows[row - 1] = []))[col - 1] = v; },
      setNumberFormat: () => {},
    }),
  };
  return sheet;
}

function makeEnv({ owner = 'owner@example.com', active = owner, calendars = [], now } = {}) {
  const props = {};
  const cache = {};
  const sent = [];
  const sheets = {};
  const spreadsheet = {
    getId: () => 'SHEET1',
    getUrl: () => 'https://sheet',
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: (s) => { delete sheets[s.name]; },
  };
  const created = [];
  const calObjs = calendars.map((c) => ({
    getId: () => c.id,
    getName: () => c.name,
    isOwnedByMe: () => !/holiday|someone/.test(c.id),
    getEvents: (from, to) => (c.events || [])
      .filter((e) => e.start < to.getTime() && from.getTime() < e.end)
      .map((e) => ({
        getMyStatus: () => e.status || 'OWNER',
        isAllDayEvent: () => !!e.allDay,
        getStartTime: () => new Date(e.start), getEndTime: () => new Date(e.end),
        getAllDayStartDate: () => new Date(e.start), getAllDayEndDate: () => new Date(e.end),
        getTitle: () => e.title || '', getLocation: () => '', getDescription: () => '',
      })),
    createEvent: (title, s, e, opt) => { created.push({ title, start: s.getTime(), end: e.getTime(), opt, cal: c.id }); return { getId: () => 'ev' + created.length }; },
  }));
  const ctx = {
    console,
    Date: now ? class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } } : Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    SpreadsheetApp: { openById: () => spreadsheet, create: () => { sheets.Sheet1 = makeSheet('Sheet1'); return spreadsheet; } },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    Session: { getActiveUser: () => ({ getEmail: () => ctx.__active }), getEffectiveUser: () => ({ getEmail: () => owner }) },
    MailApp: { sendEmail: (m) => sent.push(m) },
    CalendarApp: {
      GuestStatus: { NO: 'NO' },
      getAllCalendars: () => calObjs,
      getCalendarById: (id) => calObjs.find((c) => c.getId() === id) || null,
      getOwnedCalendarsByName: (n) => calObjs.filter((c) => c.getName() === n),
      getDefaultCalendar: () => calObjs[0],
      createCalendar: (n) => { const c = { id: 'booking@group.calendar.google.com', name: n, events: [] }; calendars.push(c); const o = { ...calObjs[0], getId: () => c.id, getName: () => n, createEvent: (title, s, e, opt) => { created.push({ title, start: s.getTime(), end: e.getTime(), opt, cal: c.id }); return { getId: () => 'ev' + created.length }; } }; calObjs.push(o); return o; },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_a, s) => [...crypto.createHash('sha256').update(String(s)).digest()],
      base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url'),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, _tz, _fmt) => {
        const j = new Date(d.getTime() + 9 * 3600e3);
        const p = (n) => String(n).padStart(2, '0');
        return `${j.getUTCFullYear()}/${p(j.getUTCMonth() + 1)}/${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
      },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
    HtmlService: {
      createHtmlOutput: (s) => ({ html: s, setTitle() { return this; } }),
      createTemplateFromFile: () => ({ evaluate: () => ({ html: 'ADMIN', setTitle() { return this; }, addMetaTag() { return this; } }) }),
    },
    Logger: { log: () => {} },
    ENV: { ADMIN_URL: 'https://admin', PUBLIC_URL: 'https://public', GUEST_BASE: 'https://guest/' },
    __active: active,
  };
  vm.createContext(ctx);
  const root = path.join(__dirname, '..');
  vm.runInContext(fs.readFileSync(path.join(root, 'shared/slots.js'), 'utf8'), ctx);
  for (const f of fs.readdirSync(path.join(root, 'gas')).filter((f) => f.endsWith('.js') && f !== 'slots.js' && f !== 'Env.js')) {
    vm.runInContext(fs.readFileSync(path.join(root, 'gas', f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, sent, sheets, created, cache, props, setActive: (e) => { ctx.__active = e; } };
}

module.exports = { makeEnv };
