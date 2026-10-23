// Owner-only pages and google.script.run endpoints.

var DEFAULT_LINK = { dayStart: 17 * 60, dayEnd: 22 * 60, weekdays: '1111110', slotMinutes: 30 };

function adminPage_(params) {
  var t = HtmlService.createTemplateFromFile('Admin');
  t.params = JSON.stringify(params);
  return t.evaluate()
    .setTitle('日程調整 管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function approvePage_(rangeId) {
  var res;
  try {
    res = approveRange_(rangeId, null, null);
  } catch (err) {
    res = { ok: false, error: String(err.message || err) };
  }
  var msg = !res.ok ? '承認できませんでした：' + res.error
    : res.already ? 'この枠はすでに処理済みです（' + res.status + '）。'
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
      requestId: r.requestId, linkId: r.linkId, name: r.name, email: r.email, message: r.message,
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
    calendars: CalendarApp.getAllCalendars().map(function (c) { return { id: c.getId(), name: c.getName() }; }),
  };
}

// Grid for a (possibly unsaved) link: final symbol, auto symbol and event details.
function adminGetGrid(draft) {
  assertOwner_();
  var link = normalizeLink_(draft);
  var r = computeLink_(link, true);
  var timed = r.events.map(function (e, i) { e.i = i; return e; });
  return {
    events: r.events,
    slots: r.slots.map(function (s, i) {
      var ev = timed.filter(function (e) { return e.start < s.end && s.start < e.end; }).map(function (e) { return e.i; });
      return { s: s.start, d: s.date, y: r.symbols[i], a: r.auto[i], ev: ev };
    }),
  };
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
    slotMinutes: Number(d.slotMinutes) === 60 ? 60 : 30,
    overrides: {},
    active: d.active !== false,
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

function approveRange_(rangeId, start, end) {
  assertOwner_();
  var res = withLock_(function () {
    var r = getRequests_().filter(function (x) { return x.id === rangeId; })[0];
    if (!r) return { ok: false, error: '申請が見つかりません' };
    if (r.status !== 'pending') return { ok: true, already: true, status: r.status === 'approved' ? '承認済み' : '却下済み' };
    if (start != null && end != null) {
      start = Number(start); end = Number(end);
      if (!(start < end)) return { ok: false, error: '時刻が正しくありません' };
      r.start = start; r.end = end;
    }
    var cal = CalendarApp.getCalendarById(getSetting_('bookingCalendarId', ''));
    if (!cal) return { ok: false, error: '「日程調整」カレンダーがありません。setup() を実行してください' };
    var title = r.name + (r.message ? '：' + r.message.split('\n')[0].slice(0, 40) : '');
    var ev = cal.createEvent(title, new Date(r.start), new Date(r.end), {
      description: '申請者: ' + r.name + ' <' + r.email + '>\n\n' + r.message,
    });
    updateRequestRow_(r._row, { status: 'approved', eventId: ev.getId(), decidedAt: Date.now(), start: r.start, end: r.end });
    bumpVersion_();
    return { ok: true, row: r, label: Slots.formatRange(r) };
  });
  if (res.ok && !res.already) mailConfirmed_(res.row);
  if (res.row) delete res.row;
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
        if (r.status === 'pending') updateRequestRow_(r._row, { status: 'rejected', decidedAt: Date.now() });
      });
      bumpVersion_();
    }
    return mine;
  });
  mailReply_(rows[0], type === 'reject' ? 'reject' : 'modify', text);
  return true;
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
