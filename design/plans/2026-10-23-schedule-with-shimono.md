# 日程調整 with 下野 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guest booking page on GitHub Pages + owner-only admin UI and API on one Google Apps Script project, reading the owner's Google Calendar and notifying via Gmail.

**Architecture:** Pure slot logic lives in `shared/slots.js` (UMD-style global, usable from GAS, browser and node tests). GAS code in `gas/` reads calendars, stores data in one spreadsheet, serves JSON to the guest page (public deployment) and HTML to the owner (admin deployment). Guest page in `docs/` is static and fetches the public deployment.

**Tech Stack:** Vanilla JS/HTML/CSS, Google Apps Script (V8), `@google/clasp`, node:test (Node 24), GitHub Pages (`main` / `docs`).

**Spec:** `design/superpowers/specs/2026-10-23-schedule-with-shimono-design.md`

## Global Constraints

- Time zone Asia/Tokyo everywhere; JST has no DST, so slot math uses a fixed +09:00 offset (`JST_OFFSET_MS = 9*3600*1000`).
- Symbols and colors: ◎ `#22a447`/`#fff`, ○ `#b8e35a`/`#2c4a05`, △ `#ff9f2e`/`#fff`, × `#ff6b5e`/`#fff`. Labels: 空いています / 空き・前後に予定 / 相談可・未定 / 不可.
- Guest responses contain only times and symbols — never titles, locations, calendar names or event ids.
- Every admin-only server function begins with `assertOwner_()`.
- No calendar IDs or email addresses committed. Spreadsheet ID lives in Script Properties; deployment IDs/URLs in `.env.local` (gitignored). The public `/exec` URL is written to `docs/config.js` (committed; not secret).
- Guest POST uses `Content-Type: text/plain`.
- Limits: link period ≤ 56 days; ≤ 20 ranges per request; 5 requests/link/day; 30 requests/day total; pending holds count as △ for 7 days.
- Page title: 「日程調整 with 下野」.

## Review Focus

1. Slot overlap at boundaries: an event ending exactly at 17:00 must not mark the 17:00 slot (half-open intervals).
2. All-day events from an "ignore" calendar (祝日) must not block the day; all-day from any other calendar blocks the whole day.
3. Guest selects a slot that became × after page load → server rejects with `conflict`, page refetches and tells the user.
4. Touch drag on phones must select (Pointer Events + `touch-action: none` on the grid).
5. Anonymous call to an admin function through the public deployment must throw, not return data.

---

### Task 1: Slot logic (`shared/slots.js`)

**Files:** Create `shared/slots.js`, `test/slots.test.js`, `package.json`.

**Interfaces — Produces** (global `Slots`, also `module.exports`):
- `generateSlots(link) -> Array<{start:number,end:number,date:string}>` — link: `{startDate:'YYYY-MM-DD', endDate, dayStart:minutes, dayEnd:minutes, weekdays:'1111100' (Mon..Sun), slotMinutes:30|60}`.
- `classify(slots, ctx) -> Array<'◎'|'○'|'△'|'×'>` — ctx: `{events:[{start,end,allDay,kind:'block'|'soft'|'ignore',bufferMin}], pending:[{start,end}], overrides:{[startMs]:symbol}}`. Rule order per spec §5.
- `mergeRanges(starts:number[], slotMinutes) -> [{start,end}]`.
- `validateRanges(ranges, slots, symbols) -> {ok:true}|{ok:false,error:'invalid'|'conflict'}` — every covered slot must exist and be non-×.
- `jstDateString(ms) -> 'YYYY-MM-DD'`, `formatRange(r) -> '10/28(水) 17:00–19:00'`.

- [ ] Tests: 2-day link 17:00–19:00/30 → 8 slots; weekday mask excludes Sunday; block event 18:00–19:00 buffer 30 → 17:30 slot ×, 17:00 ◎; event ending 17:00 doesn't touch 17:00 slot; soft event → △ body, ○ buffer; ignore all-day → no effect; block all-day → whole day ×; pending → △ but block wins; override beats everything; mergeRanges joins contiguous and splits gaps; validateRanges conflict on ×.
- [ ] Implement; `node --test` passes; commit.

### Task 2: GAS backend

**Files:** Create `gas/appsscript.json`, `gas/Store.js`, `gas/Calendar.js`, `gas/Api.js`, `gas/Mail.js`, `gas/Setup.js`.

**Interfaces — Produces:**
- `doGet(e)`: `action=availability&l=` → JSON `{ok, link:{name,startDate,endDate,dayStart,dayEnd,weekdays,slotMinutes}, ownerName, slots:[{s:startMs,y:symbol}]}`; `action=approve&id=` (owner) → HTML result; `action=reply&req=&type=` (owner) → admin page in reply mode; no action (owner) → admin page; otherwise 「ページが見つかりません」.
- `doPost(e)`: body JSON `{action:'request', l, name, email, message, ranges:[{start,end}], hp}` → `{ok:true}` | `{ok:false,error:'invalid'|'conflict'|'limit'|'closed'}`.
- Admin (`google.script.run`): `adminGetState()`, `adminGetGrid(linkDraft)` → `{slots:[{s,y,auto,ev:[i]}], events:[{title,start,end,allDay,location,description,calendar}]}`, `adminSaveLink(link)`, `adminSetActive(id, bool)`, `adminApprove(rangeId, start?, end?)`, `adminReply(requestId, type:'modify'|'reject', text)`, `adminSaveRules(rules)`, `adminListCalendars()`.
- `setup()`: creates spreadsheet (sheets `settings`, `links`, `requests`), booking calendar 「日程調整」, default rules by calendar name, stores `SHEET_ID` in Script Properties. Idempotent.

- [ ] Write per spec §5/§8/§10; reuse `Slots` (deploy copies `shared/slots.js` into `gas/`).
- [ ] `node --check` each file; commit.

### Task 3: Admin UI (`gas/Admin.html`)

Tabs: リンク一覧 / リンク作成・編集 / カレンダー設定, per spec §9 and mockup `design/mockups/admin-and-guest.html` ①. Grid shows event titles; click → detail; brush painting; approve with editable times; modify/reject form.

- [ ] Build; lint by loading in a local harness with a stubbed `google.script.run`; commit.

### Task 4: Guest page (`docs/`)

**Files:** `docs/index.html`, `docs/style.css`, `docs/app.js`, `docs/config.js`, `docs/slots.js` (copy).

- [ ] Week view, legend, Pointer-Events drag select, ranges list, form, submit with text/plain, conflict handling, closed link message.
- [ ] Verify against a mock API in the browser (desktop + 375px); commit.

### Task 5: Deploy

- [ ] `scripts/deploy.mjs`: copy slots.js → gas/, write manifest with `access` per target, `clasp push -f`, `clasp version`, `clasp deploy -V n -i <id>`; first run creates deployments and writes IDs/URLs into `.env.local`, then writes `docs/config.js`.
- [ ] Create GitHub repo, push, enable Pages from `/docs`.
- [ ] Owner runs `setup()` in the editor; verify public JSON via curl, admin URL redirects to login for anonymous curl.
