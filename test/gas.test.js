const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./gas-fakes.js');

const jst = (date, hhmm) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - 9 * 3600 * 1000;
};
const NOW = jst('2026-10-25', '12:00');

function setupEnv(opts = {}) {
  const env = makeEnv({
    now: NOW,
    calendars: [
      { id: 'owner@example.com', name: 'owner@example.com', events: [] },
      { id: 'baito@group.calendar.google.com', name: 'バイト', events: [
        { start: jst('2026-10-27', '18:00'), end: jst('2026-10-27', '21:00'), title: 'シフト' },
      ] },
      { id: 'matsuo@group.calendar.google.com', name: '松尾研 深層学習 DL基礎講座 Autumn 2026', events: [
        { start: jst('2026-10-28', '19:00'), end: jst('2026-10-28', '21:00'), title: 'DL講座' },
      ] },
      { id: 'ja.japanese#holiday@group.v.calendar.google.com', name: '日本の祝日', events: [
        { start: jst('2026-11-03', '00:00'), end: jst('2026-11-04', '00:00'), allDay: true, title: '文化の日' },
      ] },
      { id: 'someone@gmail.com', name: 'someone@gmail.com', events: [
        { start: jst('2026-10-26', '17:00'), end: jst('2026-10-26', '22:00'), title: 'secret' },
      ] },
    ],
    ...opts,
  });
  env.ctx.setup();
  return env;
}

function newLink(env, over = {}) {
  return env.ctx.adminSaveLink({
    name: '山田さん', startDate: '2026-10-26', endDate: '2026-11-08', dayStart: 17 * 60, dayEnd: 22 * 60,
    weekdays: '1111111', slotMinutes: 30, overrides: {}, ...over,
  });
}

const get = (env, params) => JSON.parse(env.ctx.doGet({ parameter: params }).body);
const post = (env, body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
const sym = (res, ms) => res.slots.find((x) => x.s === ms).y;

test('setup assigns default rules by calendar name', () => {
  const env = setupEnv();
  const rules = env.ctx.getRules_();
  assert.equal(rules['baito@group.calendar.google.com'].kind, 'block');
  assert.equal(rules['matsuo@group.calendar.google.com'].kind, 'soft');
  assert.equal(rules['ja.japanese#holiday@group.v.calendar.google.com'].kind, 'ignore');
  assert.equal(rules['someone@gmail.com'].kind, 'ignore');
  assert.equal(rules['owner@example.com'].kind, 'block');
  assert.equal(rules['baito@group.calendar.google.com'].bufferMin, 30);
});

test('availability: symbols only, no event details leak', () => {
  const env = setupEnv();
  const link = newLink(env);
  const res = get(env, { action: 'availability', l: link.id });
  assert.equal(res.ok, true);
  assert.equal(sym(res, jst('2026-10-27', '17:30')), '×'); // バイト buffer
  assert.equal(sym(res, jst('2026-10-27', '17:00')), '◎');
  assert.equal(sym(res, jst('2026-10-28', '19:00')), '△'); // DL講座
  assert.equal(sym(res, jst('2026-10-28', '18:30')), '○');
  assert.equal(sym(res, jst('2026-10-26', '17:00')), '◎'); // someone@gmail.com ignored
  const raw = JSON.stringify(res);
  for (const word of ['シフト', 'DL講座', 'secret', 'バイト', 'owner@example.com', 'overrides']) {
    assert.ok(!raw.includes(word), 'leaked ' + word);
  }
});

test('overrides block a free slot for guests', () => {
  const env = setupEnv();
  const s = jst('2026-10-26', '17:00');
  const link = newLink(env, { overrides: { [s]: '×' } });
  assert.equal(sym(get(env, { action: 'availability', l: link.id }), s), '×');
});

test('request flow: submit, pending shows △ on other links, approve creates event and mails', () => {
  const env = setupEnv();
  const link = newLink(env);
  const other = newLink(env, { name: '佐藤さん' });
  const r = { start: jst('2026-10-26', '17:00'), end: jst('2026-10-26', '18:00') };
  env.setActive(''); // anonymous guest
  const res = post(env, { action: 'request', l: link.id, name: '山田', email: 'yamada@example.com', message: '数学', ranges: [r] });
  assert.deepEqual(res, { ok: true });
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].to, 'owner@example.com');
  assert.match(env.sent[0].htmlBody, /action=approve&amp;id=/);
  assert.equal(sym(get(env, { action: 'availability', l: other.id }), r.start), '△');

  env.setActive('owner@example.com');
  const st = env.ctx.adminGetState();
  const rangeId = st.requests[0].ranges[0].id;
  const page = env.ctx.doGet({ parameter: { action: 'approve', id: rangeId } });
  assert.match(page.html, /承認しました/);
  assert.equal(env.created.length, 1);
  assert.equal(env.created[0].title, '山田：数学');
  assert.equal(env.sent[1].to, 'yamada@example.com');
  assert.match(env.sent[1].subject, /日程確定/);
  // second click is idempotent
  assert.match(env.ctx.doGet({ parameter: { action: 'approve', id: rangeId } }).html, /処理済み/);
  assert.equal(env.created.length, 1);
});

test('request rejected when a slot is ×, outside the link, or limits exceeded', () => {
  const env = setupEnv();
  const link = newLink(env);
  env.setActive('');
  const base = { action: 'request', l: link.id, name: 'a', email: 'a@b.co', message: '' };
  assert.equal(post(env, { ...base, ranges: [{ start: jst('2026-10-27', '18:00'), end: jst('2026-10-27', '18:30') }] }).error, 'conflict');
  assert.equal(post(env, { ...base, ranges: [{ start: jst('2026-10-26', '09:00'), end: jst('2026-10-26', '09:30') }] }).error, 'invalid');
  assert.equal(post(env, { ...base, email: 'nope', ranges: [{ start: jst('2026-10-26', '17:00'), end: jst('2026-10-26', '17:30') }] }).error, 'invalid');
  for (let i = 0; i < 5; i++) {
    const t = jst('2026-10-29', '17:00') + i * 3600000;
    assert.equal(post(env, { ...base, ranges: [{ start: t, end: t + 1800000 }] }).ok, true);
  }
  const t = jst('2026-10-30', '17:00');
  assert.equal(post(env, { ...base, ranges: [{ start: t, end: t + 1800000 }] }).error, 'limit');
});

test('honeypot is silently dropped; stopped link is closed', () => {
  const env = setupEnv();
  const link = newLink(env);
  const r = { start: jst('2026-10-26', '17:00'), end: jst('2026-10-26', '17:30') };
  env.setActive('');
  assert.deepEqual(post(env, { action: 'request', l: link.id, name: 'a', email: 'a@b.co', ranges: [r], hp: 'x' }), { ok: true });
  assert.equal(env.sent.length, 0);
  env.setActive('owner@example.com');
  env.ctx.adminSetActive(link.id, false);
  env.setActive('');
  assert.equal(get(env, { action: 'availability', l: link.id }).error, 'closed');
});

test('anonymous users cannot reach admin functions or pages', () => {
  const env = setupEnv();
  newLink(env);
  env.setActive('');
  assert.throws(() => env.ctx.adminGetState(), /forbidden/);
  assert.throws(() => env.ctx.adminGetGrid({}), /forbidden/);
  assert.throws(() => env.ctx.adminApprove('x'), /forbidden/);
  assert.match(env.ctx.doGet({ parameter: {} }).html, /見つかりません/);
  assert.match(env.ctx.doGet({ parameter: { action: 'approve', id: 'x' } }).html, /見つかりません/);
  env.setActive('stranger@example.com');
  assert.throws(() => env.ctx.adminGetState(), /forbidden/);
});

test('reject marks pending ranges and mails the guest; approve with adjusted times', () => {
  const env = setupEnv();
  const link = newLink(env);
  env.setActive('');
  const a = { start: jst('2026-10-26', '17:00'), end: jst('2026-10-26', '19:00') };
  const b = { start: jst('2026-10-29', '17:00'), end: jst('2026-10-29', '18:00') };
  post(env, { action: 'request', l: link.id, name: '山田', email: 'y@example.com', message: '', ranges: [a, b] });
  env.setActive('owner@example.com');
  let st = env.ctx.adminGetState();
  const req = st.requests[0];
  const res = env.ctx.adminApprove(req.ranges[0].id, a.start, a.start + 3600000);
  assert.equal(res.ok, true);
  assert.equal(env.created[0].end, a.start + 3600000);
  env.ctx.adminReply(req.requestId, 'reject', 'ごめんなさい');
  st = env.ctx.adminGetState();
  assert.equal(JSON.stringify(st.requests[0].ranges.map((x) => x.status)), '["approved","rejected"]');
  assert.match(env.sent.at(-1).htmlBody, /ごめんなさい/);
});

test('admin grid includes event details for the owner', () => {
  const env = setupEnv();
  const g = env.ctx.adminGetGrid({ startDate: '2026-10-27', endDate: '2026-10-27', dayStart: 17 * 60, dayEnd: 22 * 60, weekdays: '1111111', slotMinutes: 30 });
  const slot = g.slots.find((s) => s.s === jst('2026-10-27', '18:00'));
  assert.equal(g.events[slot.ev[0]].title, 'シフト');
  assert.equal(g.events[slot.ev[0]].calendar, 'バイト');
});
