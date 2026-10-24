// Owner-only pages and google.script.run endpoints.

var DEFAULT_LINK = { dayStart: 17 * 60, dayEnd: 22 * 60, weekdays: '1111110', slotMinutes: 30 };

function adminPage_(params) {
  var t = HtmlService.createTemplateFromFile('AdminPage');
  t.params = JSON.stringify(params);
  return t.evaluate()
    .setTitle('日程調整 管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Email approve link: ?action=approve&req=<requestId> approves every pending range of the request.
// The older per-range form (&id=<rangeId>) still works for mails sent before this change.
function approvePage_(requestId, rangeId) {
  var res;
  try {
    res = requestId ? approveRequest_(requestId) : approveRange_(rangeId, null, null);
  } catch (err) {
    res = { ok: false, error: String(err.message || err) };
  }
  var msg = !res.ok ? '承認できませんでした：' + res.error
    : res.already ? 'この申請はすでに処理済みです（' + res.status + '）。'
    : '承認しました：' + res.label + '　カレンダーに登録し、相手に確定メールを送りました。';
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:24px"><p style="font-size:16px">' + esc_(msg) + '</p>'
    + '<p><a href="' + esc_(ENV.ADMIN_URL) + '" target="_top">管理ページへ</a></p></div>')
    .setTitle('日程調整');
}

// ---- state for the admin UI ----

function adminGetState() {
  assertOwner_();
  var links = getLinks_();
  var requests = getRequests_();
  var byReq = {};
  requests.forEach(function (r) {
    var g = byReq[r.requestId] || (byReq[r.requestId] = {
      requestId: r.requestId, linkId: r.linkId, name: r.name, email: r.email, message: r.message, note: r.note,
      createdAt: r.createdAt, ranges: [],
    });
    g.ranges.push({ id: r.id, start: r.start, end: r.end, status: r.status, label: Slots.formatRange(r) });
  });
  var groups = Object.keys(byReq).map(function (k) { return byReq[k]; })
    .sort(function (a, b) { return b.createdAt - a.createdAt; });
  return {
    guestBase: ENV.GUEST_BASE,
    defaults: DEFAULT_LINK,
    links: links.map(function (l) { delete l._row; return l; }),
    requests: groups,
    rules: getRules_(),
  };
}

function adminListCalendars() {
  assertOwner_();
  return CalendarApp.getAllCalendars().map(function (c) { return { id: c.getId(), name: c.getName() }; });
}

// Events (with details) and pending holds for [fromDate, toDate], used by the
// editor to compute symbols in the browser. Cached for 5 minutes unless force.
var CAL_CACHE_SEC = 300;

function adminGetCalendarData(fromDate, toDate, force) {
  assertOwner_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) throw new Error('期間が正しくありません');
  var from = Slots.jstMidnight(fromDate);
  var to = Slots.jstMidnight(toDate) + DAY_MS;
  var cache = CacheService.getScriptCache();
  var key = 'cal:' + from + ':' + to + ':' + dataVersion_();
  var hit = !force && cache.get(key);
  if (hit) return JSON.parse(hit);
  var events = loadEvents_(from, to, true).map(function (e) {
    if (e.description && e.description.length > 500) e.description = e.description.slice(0, 500) + '…';
    return e;
  });
  var out = {
    from: from, to: to, loadedAt: Date.now(), events: events,
    pending: activePending_(getRequests_(), Date.now()).map(function (r) { return { start: r.start, end: r.end }; }),
  };
  var str = JSON.stringify(out);
  if (str.length < 95000) cache.put(key, str, CAL_CACHE_SEC);
  return out;
}

function normalizeLink_(d) {
  var link = {
    id: d.id || '',
    name: String(d.name || '').trim().slice(0, 60) || '名前なし',
    startDate: String(d.startDate),
    endDate: String(d.endDate),
    dayStart: Number(d.dayStart),
    dayEnd: Number(d.dayEnd),
    weekdays: /^[01]{7}$/.test(d.weekdays) ? d.weekdays : DEFAULT_LINK.weekdays,
    slotMinutes: [15, 30, 60].indexOf(Number(d.slotMinutes)) >= 0 ? Number(d.slotMinutes) : 30,
    overrides: {},
    active: d.active !== false,
    archived: !!d.archived,
    archivedAt: d.archivedAt || 0,
    createdAt: d.createdAt || Date.now(),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(link.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(link.endDate)) throw new Error('期間が正しくありません');
  var days = (Slots.jstMidnight(link.endDate) - Slots.jstMidnight(link.startDate)) / DAY_MS;
  if (days < 0 || days >= LIMITS.maxPeriodDays) throw new Error('期間は 1〜' + LIMITS.maxPeriodDays + ' 日にしてください');
  if (!(link.dayStart >= 0 && link.dayEnd <= 1440 && link.dayStart < link.dayEnd)) throw new Error('時間帯が正しくありません');
  var ok = { '◎': 1, '○': 1, '△': 1, '×': 1 };
  Object.keys(d.overrides || {}).forEach(function (k) {
    if (ok[d.overrides[k]]) link.overrides[k] = d.overrides[k];
  });
  return link;
}

function adminSaveLink(draft) {
  assertOwner_();
  return withLock_(function () {
    var link = normalizeLink_(draft);
    if (!link.id) link.id = newId_(22);
    else if (!getLink_(link.id)) throw new Error('リンクが見つかりません');
    saveLink_(link);
    bumpVersion_();
    return link;
  });
}

function adminSetActive(id, active) {
  assertOwner_();
  return withLock_(function () {
    var link = getLink_(id);
    if (!link) throw new Error('リンクが見つかりません');
    link.active = !!active;
    saveLink_(link);
    bumpVersion_();
    return true;
  });
}

// Completing a link stops it for guests and moves it to 過去の日程調整; restoring reopens it.
function adminSetArchived(id, archived) {
  assertOwner_();
  return withLock_(function () {
    var link = getLink_(id);
    if (!link) throw new Error('リンクが見つかりません');
    link.archived = !!archived;
    link.archivedAt = archived ? Date.now() : 0;
    link.active = !archived;
    saveLink_(link);
    bumpVersion_();
    return true;
  });
}

function adminSaveRules(rules) {
  assertOwner_();
  var clean = {};
  Object.keys(rules || {}).forEach(function (id) {
    var r = rules[id];
    var kind = { block: 1, soft: 1, ignore: 1 }[r.kind] ? r.kind : 'block';
    clean[id] = { name: String(r.name || ''), kind: kind, bufferMin: Math.max(0, Math.min(240, Number(r.bufferMin) || 0)) };
  });
  withLock_(function () {
    setSetting_('calendarRules', clean);
    bumpVersion_();
  });
  return clean;
}

// ---- decisions ----

function adminApprove(rangeId, start, end) {
  assertOwner_();
  return approveRange_(rangeId, start, end);
}

function bookingCalendar_() {
  var cal = CalendarApp.getCalendarById(getSetting_('bookingCalendarId', ''));
  if (!cal) throw new Error('「日程調整」カレンダーがありません。setup() を実行してください');
  return cal;
}

// Creates the calendar event for one pending range and marks it approved. Call inside withLock_.
function bookRange_(cal, r) {
  var title = r.name + (r.message ? '：' + r.message.split('\n')[0].slice(0, 40) : '');
  var ev = cal.createEvent(title, new Date(r.start), new Date(r.end), {
    description: '申請者: ' + r.name + ' <' + r.email + '>'
      + (r.message ? '\n\nご用件:\n' + r.message : '') + (r.note ? '\n\n備考・コメント:\n' + r.note : ''),
  });
  updateRequestRow_(r._row, { status: 'approved', eventId: ev.getId(), decidedAt: Date.now(), start: r.start, end: r.end });
}

function statusLabel_(rows) {
  return rows.every(function (r) { return r.status === 'approved'; }) ? '承認済み'
    : rows.every(function (r) { return r.status === 'rejected'; }) ? '却下済み' : '処理済み';
}

// Admin page: approve one range, optionally with adjusted times.
function approveRange_(rangeId, start, end) {
  assertOwner_();
  var res = withLock_(function () {
    var r = getRequests_().filter(function (x) { return x.id === rangeId; })[0];
    if (!r) return { ok: false, error: '申請が見つかりません' };
    if (r.status !== 'pending') return { ok: true, already: true, status: statusLabel_([r]) };
    if (start != null && end != null) {
      start = Number(start); end = Number(end);
      if (!(start < end)) return { ok: false, error: '時刻が正しくありません' };
      r.start = start; r.end = end;
    }
    bookRange_(bookingCalendar_(), r);
    bumpVersion_();
    return { ok: true, rows: [r], label: Slots.formatRange(r) };
  });
  if (res.ok && !res.already) mailConfirmed_(res.rows);
  delete res.rows;
  return res;
}

// Email / admin "approve all": approve every pending range of a request with one confirmation mail.
function adminApproveRequest(requestId) {
  assertOwner_();
  return approveRequest_(requestId);
}

function approveRequest_(requestId) {
  assertOwner_();
  var res = withLock_(function () {
    var mine = getRequests_().filter(function (x) { return x.requestId === requestId; });
    if (!mine.length) return { ok: false, error: '申請が見つかりません' };
    var pending = mine.filter(function (r) { return r.status === 'pending'; });
    if (!pending.length) return { ok: true, already: true, status: statusLabel_(mine) };
    var cal = bookingCalendar_();
    pending.forEach(function (r) { bookRange_(cal, r); });
    bumpVersion_();
    return { ok: true, rows: pending, label: pending.map(function (r) { return Slots.formatRange(r); }).join('、') };
  });
  if (res.ok && !res.already) mailConfirmed_(res.rows);
  delete res.rows;
  return res;
}

// type: 'modify' (message only) or 'reject' (message + reject all pending ranges of the request)
function adminReply(requestId, type, text) {
  assertOwner_();
  text = String(text || '').trim();
  if (!text) throw new Error('本文を入力してください');
  var rows = withLock_(function () {
    var mine = getRequests_().filter(function (r) { return r.requestId === requestId; });
    if (!mine.length) throw new Error('申請が見つかりません');
    if (type === 'reject') {
      mine.forEach(function (r) {
        if (r.status === 'pending') { updateRequestRow_(r._row, { status: 'rejected', decidedAt: Date.now() }); r.status = 'rejected'; }
      });
      bumpVersion_();
    }
    return mine;
  });
  mailReply_(rows, type === 'reject' ? 'reject' : 'modify', text);
  return true;
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
