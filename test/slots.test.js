const test = require('node:test');
const assert = require('node:assert/strict');
const Slots = require('../shared/slots.js');

// 2026-10-26 is a Monday. JST = UTC+9.
const jst = (date, hhmm) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - 9 * 3600 * 1000;
};
const link = (o = {}) => ({
  startDate: '2026-10-26', endDate: '2026-10-27',
  dayStart: 17 * 60, dayEnd: 19 * 60, weekdays: '1111111', slotMinutes: 30, ...o,
});
const symAt = (slots, syms, date, hhmm) => syms[slots.findIndex((s) => s.start === jst(date, hhmm))];

test('generateSlots: two days 17:00-19:00 in 30 min steps', () => {
  const slots = Slots.generateSlots(link());
  assert.equal(slots.length, 8);
  assert.equal(slots[0].start, jst('2026-10-26', '17:00'));
  assert.equal(slots[0].end, jst('2026-10-26', '17:30'));
  assert.equal(slots[0].date, '2026-10-26');
  assert.equal(slots[7].start, jst('2026-10-27', '18:30'));
});

test('generateSlots: weekday mask excludes Sunday, 60 min slots', () => {
  const slots = Slots.generateSlots(link({ startDate: '2026-10-31', endDate: '2026-11-01', weekdays: '1111110', slotMinutes: 60 }));
  assert.deepEqual([...new Set(slots.map((s) => s.date))], ['2026-10-31']);
  assert.equal(slots.length, 2);
});

test('classify: block event with buffer; boundary is half-open', () => {
  const slots = Slots.generateSlots(link({ endDate: '2026-10-26', dayStart: 16 * 60, dayEnd: 20 * 60 }));
  const syms = Slots.classify(slots, {
    events: [{ start: jst('2026-10-26', '18:00'), end: jst('2026-10-26', '19:00'), allDay: false, kind: 'block', bufferMin: 30 }],
    pending: [], overrides: {},
  });
  assert.equal(symAt(slots, syms, '2026-10-26', '17:00'), '◎');
  assert.equal(symAt(slots, syms, '2026-10-26', '17:30'), '×');
  assert.equal(symAt(slots, syms, '2026-10-26', '18:30'), '×');
  assert.equal(symAt(slots, syms, '2026-10-26', '19:00'), '×');
  assert.equal(symAt(slots, syms, '2026-10-26', '19:30'), '◎');
});

test('classify: event ending exactly at slot start does not touch it (no buffer)', () => {
  const slots = Slots.generateSlots(link({ endDate: '2026-10-26' }));
  const syms = Slots.classify(slots, {
    events: [{ start: jst('2026-10-26', '16:00'), end: jst('2026-10-26', '17:00'), allDay: false, kind: 'block', bufferMin: 0 }],
    pending: [], overrides: {},
  });
  assert.equal(syms[0], '◎');
});

test('classify: soft event is △ in body and ○ in buffer', () => {
  const slots = Slots.generateSlots(link({ endDate: '2026-10-26', dayEnd: 21 * 60 }));
  const syms = Slots.classify(slots, {
    events: [{ start: jst('2026-10-26', '19:00'), end: jst('2026-10-26', '20:00'), allDay: false, kind: 'soft', bufferMin: 30 }],
    pending: [], overrides: {},
  });
  assert.equal(symAt(slots, syms, '2026-10-26', '18:00'), '◎');
  assert.equal(symAt(slots, syms, '2026-10-26', '18:30'), '○');
  assert.equal(symAt(slots, syms, '2026-10-26', '19:00'), '△');
  assert.equal(symAt(slots, syms, '2026-10-26', '20:00'), '○');
});

test('classify: all-day from ignore calendar has no effect; other all-day blocks the day', () => {
  const slots = Slots.generateSlots(link());
  const day = { start: jst('2026-10-26', '00:00'), end: jst('2026-10-27', '00:00'), allDay: true };
  const a = Slots.classify(slots, { events: [{ ...day, kind: 'ignore', bufferMin: 0 }], pending: [], overrides: {} });
  assert.ok(a.every((s) => s === '◎'));
  const b = Slots.classify(slots, { events: [{ ...day, kind: 'soft', bufferMin: 30 }], pending: [], overrides: {} });
  assert.deepEqual(b.slice(0, 4), ['×', '×', '×', '×']);
  assert.deepEqual(b.slice(4), ['◎', '◎', '◎', '◎']);
});

test('classify: pending is △, block beats pending, override beats all', () => {
  const slots = Slots.generateSlots(link({ endDate: '2026-10-26' }));
  const t = (h) => jst('2026-10-26', h);
  const syms = Slots.classify(slots, {
    events: [{ start: t('18:30'), end: t('19:00'), allDay: false, kind: 'block', bufferMin: 0 }],
    pending: [{ start: t('17:00'), end: t('19:00') }],
    overrides: { [t('18:30')]: '◎' },
  });
  assert.deepEqual(syms, ['△', '△', '△', '◎']);
});

test('mergeRanges joins contiguous starts and splits gaps', () => {
  const t = (h) => jst('2026-10-26', h);
  const r = Slots.mergeRanges([t('18:00'), t('17:00'), t('17:30'), t('19:00')], 30);
  assert.deepEqual(r, [
    { start: t('17:00'), end: t('18:30') },
    { start: t('19:00'), end: t('19:30') },
  ]);
});

test('validateRanges: rejects × and unknown slots', () => {
  const slots = Slots.generateSlots(link({ endDate: '2026-10-26' }));
  const syms = ['◎', '×', '△', '○'];
  const t = (h) => jst('2026-10-26', h);
  assert.deepEqual(Slots.validateRanges([{ start: t('18:00'), end: t('19:00') }], slots, syms), { ok: true });
  assert.deepEqual(Slots.validateRanges([{ start: t('17:00'), end: t('18:00') }], slots, syms), { ok: false, error: 'conflict' });
  assert.deepEqual(Slots.validateRanges([{ start: t('20:00'), end: t('20:30') }], slots, syms), { ok: false, error: 'invalid' });
  assert.deepEqual(Slots.validateRanges([{ start: t('18:15'), end: t('19:00') }], slots, syms), { ok: false, error: 'invalid' });
});

test('formatRange and jstDateString', () => {
  const r = { start: jst('2026-10-28', '17:00'), end: jst('2026-10-28', '19:30') };
  assert.equal(Slots.formatRange(r), '10/28(水) 17:00–19:30');
  assert.equal(Slots.jstDateString(jst('2026-10-28', '23:30')), '2026-10-28');
});
