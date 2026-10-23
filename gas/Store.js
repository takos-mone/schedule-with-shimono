// Spreadsheet storage. Guest-provided text is only ever stored inside a JSON
// column so it can never be interpreted as a spreadsheet formula.

var SHEET = {
  settings: { name: 'settings', header: ['key', 'json'] },
  links: { name: 'links', header: ['id', 'json', 'updatedAt'] },
  requests: {
    name: 'requests',
    header: ['id', 'requestId', 'linkId', 'start', 'end', 'status', 'eventId', 'createdAt', 'decidedAt', 'data'],
  },
};

var PENDING_HOLD_MS = 7 * 24 * 3600 * 1000;

function props_() {
  return PropertiesService.getScriptProperties();
}

function ss_() {
  var id = props_().getProperty('SHEET_ID');
  if (!id) throw new Error('setup() has not been run yet');
  return SpreadsheetApp.openById(id);
}

function sheet_(def) {
  return ss_().getSheetByName(def.name);
}

function rows_(def) {
  var sh = sheet_(def);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, def.header.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    def.header.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function dataVersion_() {
  return props_().getProperty('DATA_VERSION') || '0';
}

function bumpVersion_() {
  props_().setProperty('DATA_VERSION', String(Date.now()));
}

// ---- settings ----

function getSetting_(key, fallback) {
  var hit = rows_(SHEET.settings).filter(function (r) { return r.key === key; })[0];
  return hit ? JSON.parse(hit.json) : fallback;
}

function setSetting_(key, value) {
  var sh = sheet_(SHEET.settings);
  var hit = rows_(SHEET.settings).filter(function (r) { return r.key === key; })[0];
  var json = JSON.stringify(value);
  if (hit) sh.getRange(hit._row, 2).setValue(json);
  else sh.appendRow([key, json]);
}

// ---- links ----
// link: { id, name, startDate, endDate, dayStart, dayEnd, weekdays, slotMinutes, overrides, active, createdAt }

function getLinks_() {
  return rows_(SHEET.links).map(function (r) {
    var link = JSON.parse(r.json);
    link._row = r._row;
    return link;
  });
}

function getLink_(id) {
  if (!id) return null;
  return getLinks_().filter(function (l) { return l.id === id; })[0] || null;
}

function saveLink_(link) {
  var sh = sheet_(SHEET.links);
  var existing = getLink_(link.id);
  var clean = JSON.parse(JSON.stringify(link));
  delete clean._row;
  var json = JSON.stringify(clean);
  if (existing) sh.getRange(existing._row, 2, 1, 2).setValues([[json, Date.now()]]);
  else sh.appendRow([clean.id, json, Date.now()]);
  return clean;
}

// ---- requests (one row per range) ----

function getRequests_() {
  return rows_(SHEET.requests).map(function (r) {
    var data = JSON.parse(r.data || '{}');
    return {
      _row: r._row,
      id: String(r.id),
      requestId: String(r.requestId),
      linkId: String(r.linkId),
      start: Number(r.start),
      end: Number(r.end),
      status: String(r.status),
      eventId: String(r.eventId || ''),
      createdAt: Number(r.createdAt),
      decidedAt: Number(r.decidedAt || 0),
      name: data.name || '',
      email: data.email || '',
      message: data.message || '',
    };
  });
}

function appendRequestRows_(rows) {
  var sh = sheet_(SHEET.requests);
  var values = rows.map(function (r) {
    return [r.id, r.requestId, r.linkId, r.start, r.end, 'pending', '', r.createdAt, '',
      JSON.stringify({ name: r.name, email: r.email, message: r.message })];
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
}

function updateRequestRow_(row, patch) {
  var sh = sheet_(SHEET.requests);
  var cols = SHEET.requests.header;
  Object.keys(patch).forEach(function (k) {
    sh.getRange(row, cols.indexOf(k) + 1).setValue(patch[k]);
  });
}

// Pending ranges that still hold their slot as △.
function activePending_(requests, now) {
  return requests.filter(function (r) {
    return r.status === 'pending' && now - r.createdAt < PENDING_HOLD_MS;
  });
}

function newId_(len) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random() + Date.now());
  return Utilities.base64EncodeWebSafe(bytes).replace(/[^A-Za-z0-9_-]/g, '').slice(0, len || 22);
}
