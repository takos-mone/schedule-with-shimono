// Local preview of both pages against the fake Apps Script services.
//   node scripts/dev-server.mjs  →  http://localhost:8787/?l=<id>  (guest)
//                                    http://localhost:8787/admin   (admin)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeEnv } = require('../test/gas-fakes.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.PORT || 8787);

const day = (offset, hh, mm = 0) => {
  const now = new Date(Date.now() + 9 * 3600e3);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, hh, mm) - 9 * 3600e3;
};
const env = makeEnv({
  calendars: [
    { id: 'owner@example.com', name: 'owner@example.com', events: [] },
    { id: 'univ@group.calendar.google.com', name: '大学関連', events: [1, 2, 3, 4, 5].map((d) => ({ start: day(d, 9), end: day(d, 17, 30), title: '臨床実習' })) },
    { id: 'baito@group.calendar.google.com', name: 'バイト', events: [{ start: day(2, 18), end: day(2, 21), title: '塾講師シフト', }, { start: day(4, 18), end: day(4, 21), title: '塾講師シフト' }] },
    { id: 'matsuo@group.calendar.google.com', name: '松尾研 DL基礎講座', events: [{ start: day(3, 19), end: day(3, 21), title: 'DL基礎講座 第5回' }] },
    { id: 'club@group.calendar.google.com', name: '部活', events: [{ start: day(6, 13), end: day(6, 17), title: '練習' }] },
  ],
});
env.ctx.setup();
const link = env.ctx.adminSaveLink({ name: '山田さん（家庭教師）', startDate: env.ctx.Slots.jstDateString(day(0, 12)), endDate: env.ctx.Slots.jstDateString(day(20, 12)), dayStart: 17 * 60, dayEnd: 22 * 60, weekdays: '1111110', slotMinutes: 30, overrides: {} });
console.log(`guest: http://localhost:${PORT}/?l=${link.id}\nadmin: http://localhost:${PORT}/admin`);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const send = (res, code, body, type = 'text/plain') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api') {
    env.setActive('');
    if (req.method === 'GET') return send(res, 200, env.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).body, 'application/json');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => send(res, 200, env.ctx.doPost({ postData: { contents: body } }).body, 'application/json'));
    return;
  }
  if (url.pathname === '/rpc') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      env.setActive('owner@example.com');
      const { fn, args } = JSON.parse(body);
      try { send(res, 200, JSON.stringify({ ok: true, value: env.ctx[fn](...args) }), 'application/json'); }
      catch (e) { send(res, 200, JSON.stringify({ ok: false, error: String(e.message) }), 'application/json'); }
    });
    return;
  }
  if (url.pathname === '/admin') {
    const shim = `<script>
      function runner(ok, ng) { return new Proxy({}, { get: (_, k) => k === 'withSuccessHandler' ? (f) => runner(f, ng) : k === 'withFailureHandler' ? (f) => runner(ok, f)
        : (...args) => fetch('/rpc', { method: 'POST', body: JSON.stringify({ fn: k, args }) }).then((r) => r.json()).then((r) => r.ok ? ok && ok(r.value) : ng && ng(new Error(r.error))) }); }
      window.google = { script: { run: runner() } };</script>`;
    let html = fs.readFileSync(path.join(root, 'gas/Admin.html'), 'utf8')
      .replace("<?!= include_('SlotsClient') ?>", shim + '<script src="/slots.js"></script>')
      .replace('<?= params ?>', JSON.stringify(JSON.stringify({ mode: url.searchParams.get('mode') || 'home', req: url.searchParams.get('req') || '', type: url.searchParams.get('type') || '' })));
    return send(res, 200, html, types['.html']);
  }
  if (url.pathname === '/config.js') return send(res, 200, "window.CONFIG = { API_URL: '/api' };", types['.js']);
  const file = path.join(root, 'docs', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(path.join(root, 'docs')) || !fs.existsSync(file)) return send(res, 404, 'not found');
  send(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
}).listen(PORT);
