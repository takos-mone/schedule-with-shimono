// Reads the owner's calendars and turns them into symbols per slot.

var DEFAULT_RULE = { kind: 'block', bufferMin: 30 };
var DAY_MS = 24 * 3600 * 1000;

function getRules_() {
  return getSetting_('calendarRules', {});
}

function ruleFor_(rules, calId) {
  return rules[calId] || DEFAULT_RULE;
}

// Events overlapping [fromMs, toMs) from every calendar not marked "ignore".
// Details (title etc.) are included only when withDetails is true (admin).
function loadEvents_(fromMs, toMs, withDetails) {
  var rules = getRules_();
  var from = new Date(fromMs - DAY_MS);
  var to = new Date(toMs + DAY_MS);
  var out = [];
  CalendarApp.getAllCalendars().forEach(function (cal) {
    var rule = ruleFor_(rules, cal.getId());
    if (rule.kind === 'ignore') return;
    cal.getEvents(from, to).forEach(function (ev) {
      if (ev.getMyStatus() === CalendarApp.GuestStatus.NO) return;
      var allDay = ev.isAllDayEvent();
      var e = {
        start: (allDay ? ev.getAllDayStartDate() : ev.getStartTime()).getTime(),
        end: (allDay ? ev.getAllDayEndDate() : ev.getEndTime()).getTime(),
        allDay: allDay,
        kind: rule.kind,
        bufferMin: rule.bufferMin,
      };
      if (withDetails) {
        e.title = ev.getTitle();
        e.location = ev.getLocation();
        e.description = ev.getDescription();
        e.calendar = cal.getName();
      }
      out.push(e);
    });
  });
  return out;
}

// Final symbol per slot for a link. Past slots are always ×.
function computeLink_(link, withDetails) {
  var slots = Slots.generateSlots(link);
  if (!slots.length) return { slots: [], symbols: [], auto: [], events: [] };
  var now = Date.now();
  var events = loadEvents_(slots[0].start, slots[slots.length - 1].end, withDetails);
  var pending = activePending_(getRequests_(), now);
  var symbols = Slots.classify(slots, { events: events, pending: pending, overrides: link.overrides || {} });
  var auto = withDetails ? Slots.classify(slots, { events: events, pending: pending, overrides: {} }) : null;
  slots.forEach(function (s, i) {
    if (s.start < now) {
      symbols[i] = '×';
      if (auto) auto[i] = '×';
    }
  });
  return { slots: slots, symbols: symbols, auto: auto, events: events };
}
