// Web app entry points. Both deployments (public: anyone, admin: owner only)
// run this same code, so every owner-only path checks assertOwner_().

var LIMITS = { maxRanges: 20, perLinkPerDay: 5, totalPerDay: 30, maxPeriodDays: 56 };
var CACHE_TTL_SEC = 120;

function isOwner_() {
  var active = Session.getActiveUser().getEmail();
  return !!active && active === Session.getEffectiveUser().getEmail();
}

function assertOwner_() {
  if (!isOwner_()) throw new Error('forbidden');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function notFound_() {
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">ページが見つかりません。</p>').setTitle('日程調整');
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'availability') return json_(publicAvailability_(p.l));
  if (!isOwner_()) return notFound_();
  if (p.action === 'approve') return approvePage_(p.req, p.id);
  return adminPage_(p.action === 'reply' ? { mode: 'reply', req: p.req || '', type: p.type || '' } : { mode: 'home' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'invalid' });
  }
  if (body.action === 'request') return json_(submitRequest_(body));
  return json_({ ok: false, error: 'invalid' });
}

// ---- public ----

function publicLink_(link) {
  return {
    name: link.name, startDate: link.startDate, endDate: link.endDate,
    dayStart: link.dayStart, dayEnd: link.dayEnd, weekdays: link.weekdays, slotMinutes: link.slotMinutes,
  };
}

function publicAvailability_(id) {
  if (!id || !/^[A-Za-z0-9_-]{10,40}$/.test(id)) return { ok: false, error: 'closed' };
  var cache = CacheService.getScriptCache();
  var key = 'av:' + id + ':' + dataVersion_();
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var link = getLink_(id);
  if (!link || !link.active) return { ok: false, error: 'closed' };
  var r = computeLink_(link, false);
  var out = {
    ok: true,
    ownerName: ownerName_(),
    link: publicLink_(link),
    slots: r.slots.map(function (s, i) { return { s: s.start, y: r.symbols[i] }; }),
  };
  var str = JSON.stringify(out);
  if (str.length < 90000) cache.put(key, str, CACHE_TTL_SEC);
  return out;
}

function str_(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function jstToday_() {
  return Slots.jstDateString(Date.now());
}

function submitRequest_(body) {
  if (body.hp) return { ok: true }; // honeypot filled: silently drop
  var name = str_(body.name, 50);
  var email = str_(body.email, 100);
  var message = str_(body.message, 500);
  var note = str_(body.note, 1000);
  var ranges = Array.isArray(body.ranges) ? body.ranges : [];
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalid' };
  if (!ranges.length || ranges.length > LIMITS.maxRanges) return { ok: false, error: 'invalid' };
  ranges = ranges.map(function (r) { return { start: Number(r.start), end: Number(r.end) }; });

  var result = withLock_(function () {
    var link = getLink_(body.l);
    if (!link || !link.active) return { ok: false, error: 'closed' };
    var today = jstToday_();
    var seenAll = {}, seenLink = {};
    getRequests_().forEach(function (r) {
      if (Slots.jstDateString(r.createdAt) !== today) return;
      seenAll[r.requestId] = true;
      if (r.linkId === link.id) seenLink[r.requestId] = true;
    });
    if (Object.keys(seenLink).length >= LIMITS.perLinkPerDay || Object.keys(seenAll).length >= LIMITS.totalPerDay) {
      return { ok: false, error: 'limit' };
    }
    var c = computeLink_(link, false);
    var v = Slots.validateRanges(ranges, c.slots, c.symbols);
    if (!v.ok) return v;
    var requestId = newId_(16);
    var now = Date.now();
    var rows = ranges.map(function (r) {
      return { id: newId_(16), requestId: requestId, linkId: link.id, start: r.start, end: r.end,
        createdAt: now, name: name, email: email, message: message, note: note };
    });
    appendRequestRows_(rows);
    bumpVersion_();
    return { ok: true, link: link, requestId: requestId, rows: rows };
  });
  if (!result.ok) return result;
  notifyOwner_(result.link, result.requestId, result.rows);
  return { ok: true };
}
