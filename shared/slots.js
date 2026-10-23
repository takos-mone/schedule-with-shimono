// Pure slot logic shared by Apps Script, the guest page and node tests.
// Times are epoch milliseconds; dates are 'YYYY-MM-DD' in JST (UTC+9, no DST).
var Slots = (function () {
  var JST_OFFSET_MS = 9 * 3600 * 1000;
  var MIN = 60 * 1000;
  var DAY = 24 * 3600 * 1000;
  var WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Epoch ms of 00:00 JST on the given date.
  function jstMidnight(date) {
    var p = date.split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]) - JST_OFFSET_MS;
  }

  function jstParts(ms) {
    var d = new Date(ms + JST_OFFSET_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }

  function jstDateString(ms) {
    var p = jstParts(ms);
    return p.y + '-' + pad(p.m) + '-' + pad(p.d);
  }

  function hhmm(ms) {
    var p = jstParts(ms);
    return p.h + ':' + pad(p.mi);
  }

  function formatRange(r) {
    var p = jstParts(r.start);
    return p.m + '/' + p.d + '(' + WEEKDAY_JA[p.wd] + ') ' + hhmm(r.start) + '–' + hhmm(r.end);
  }

  // weekdays: 7-char mask Mon..Sun, '1' = shown.
  function generateSlots(link) {
    var out = [];
    var step = link.slotMinutes * MIN;
    var first = jstMidnight(link.startDate);
    var last = jstMidnight(link.endDate);
    for (var day = first; day <= last; day += DAY) {
      var wd = jstParts(day).wd; // 0 = Sun
      var maskIndex = (wd + 6) % 7; // Mon = 0
      if (link.weekdays.charAt(maskIndex) !== '1') continue;
      var date = jstDateString(day);
      for (var t = day + link.dayStart * MIN; t + step <= day + link.dayEnd * MIN; t += step) {
        out.push({ start: t, end: t + step, date: date });
      }
    }
    return out;
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  // Rule order follows the spec §5.
  function classifyOne(slot, ctx) {
    if (Object.prototype.hasOwnProperty.call(ctx.overrides, slot.start)) return ctx.overrides[slot.start];
    var i, e, buf, inBody = false, inBuffer = false, softBody = false, softBuffer = false, allDay = false;
    for (i = 0; i < ctx.events.length; i++) {
      e = ctx.events[i];
      if (e.kind === 'ignore') continue;
      if (e.allDay) {
        if (overlaps(slot.start, slot.end, e.start, e.end)) allDay = true;
        continue;
      }
      buf = (e.bufferMin || 0) * MIN;
      var body = overlaps(slot.start, slot.end, e.start, e.end);
      var near = !body && overlaps(slot.start, slot.end, e.start - buf, e.end + buf);
      if (e.kind === 'block') { inBody = inBody || body; inBuffer = inBuffer || near; }
      else { softBody = softBody || body; softBuffer = softBuffer || near; }
    }
    if (inBody || inBuffer || allDay) return '×';
    for (i = 0; i < ctx.pending.length; i++) {
      if (overlaps(slot.start, slot.end, ctx.pending[i].start, ctx.pending[i].end)) return '△';
    }
    if (softBody) return '△';
    if (softBuffer) return '○';
    return '◎';
  }

  function classify(slots, ctx) {
    var c = { events: ctx.events || [], pending: ctx.pending || [], overrides: ctx.overrides || {} };
    return slots.map(function (s) { return classifyOne(s, c); });
  }

  function mergeRanges(starts, slotMinutes) {
    var step = slotMinutes * MIN;
    var sorted = starts.slice().sort(function (a, b) { return a - b; });
    var out = [];
    sorted.forEach(function (s) {
      var last = out[out.length - 1];
      if (last && last.end === s) last.end = s + step;
      else if (!last || s > last.end) out.push({ start: s, end: s + step });
    });
    return out;
  }

  function validateRanges(ranges, slots, symbols) {
    var byStart = {};
    slots.forEach(function (s, i) { byStart[s.start] = i; });
    for (var r = 0; r < ranges.length; r++) {
      var range = ranges[r];
      if (!(range.start < range.end)) return { ok: false, error: 'invalid' };
      var cursor = range.start;
      while (cursor < range.end) {
        var i = byStart[cursor];
        if (i === undefined || slots[i].end > range.end) return { ok: false, error: 'invalid' };
        if (symbols[i] === '×') return { ok: false, error: 'conflict' };
        cursor = slots[i].end;
      }
    }
    return { ok: true };
  }

  return {
    JST_OFFSET_MS: JST_OFFSET_MS,
    jstMidnight: jstMidnight,
    jstDateString: jstDateString,
    hhmm: hhmm,
    formatRange: formatRange,
    generateSlots: generateSlots,
    classify: classify,
    mergeRanges: mergeRanges,
    validateRanges: validateRanges,
  };
})();

if (typeof module !== 'undefined') module.exports = Slots;
