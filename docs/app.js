// Guest booking page. Talks to the public Apps Script deployment (CONFIG.API_URL).
(function () {
  var SYMS = ['◎', '○', '△', '×'];
  var LABEL = { '◎': '空いています', '○': '空き・前後に予定', '△': '相談可・未定', '×': '不可' };
  var WD = '日月火水木金土';
  var ERRORS = {
    conflict: '選んだ時間の一部が埋まりました。表示を更新したので、もう一度選んでください。',
    limit: '本日の申請の上限に達しました。明日もう一度お試しいただくか、下野に直接ご連絡ください。',
    closed: 'このリンクは現在使えません。',
    invalid: '入力内容を確認してください。',
    network: '送信できませんでした。通信環境を確認して、もう一度お試しください。',
  };

  var linkId = new URLSearchParams(location.search).get('l');
  var data = null;      // { link, ownerName, slots:[{s,y}] }
  var bySlot = {};      // start -> symbol
  var weeks = [];       // [[date,...], ...] Monday-start weeks of shown dates
  var week = 0;
  var selected = {};    // start -> true

  function $(id) { return document.getElementById(id); }

  function api(params) {
    return fetch(CONFIG.API_URL + '?' + new URLSearchParams(params)).then(function (r) { return r.json(); });
  }

  function load() {
    return api({ action: 'availability', l: linkId }).then(function (res) {
      if (!res.ok) return showClosed();
      data = res;
      bySlot = {};
      res.slots.forEach(function (x) { bySlot[x.s] = x.y; });
      Object.keys(selected).forEach(function (s) { if (!bySlot[s] || bySlot[s] === '×') delete selected[s]; });
      buildWeeks();
      render();
    });
  }

  function showClosed() {
    $('sub').textContent = '';
    $('app').classList.add('hidden');
    $('closed').classList.remove('hidden');
  }

  function mondayOf(date) {
    var ms = Slots.jstMidnight(date);
    var wd = new Date(ms + Slots.JST_OFFSET_MS).getUTCDay();
    return Slots.jstDateString(ms - ((wd + 6) % 7) * 86400000);
  }

  function buildWeeks() {
    var seen = {}, groups = {}, order = [];
    data.slots.forEach(function (x) {
      var d = Slots.jstDateString(x.s);
      if (seen[d]) return;
      seen[d] = 1;
      var m = mondayOf(d);
      if (!groups[m]) { groups[m] = []; order.push(m); }
      groups[m].push(d);
    });
    weeks = order.map(function (m) { return groups[m]; });
    week = Math.min(week, Math.max(0, weeks.length - 1));
  }

  function md(date) { var p = date.split('-'); return Number(p[1]) + '月' + Number(p[2]) + '日'; }

  function render() {
    var l = data.link;
    $('owner').textContent = data.ownerName;
    document.title = '日程調整 with ' + data.ownerName;
    $('sub').textContent = l.name + ' さん向け ・ ' + md(l.startDate) + ' 〜 ' + md(l.endDate);
    $('legend').innerHTML = SYMS.map(function (s) { return '<span class="pill y-' + s + '">' + s + ' ' + LABEL[s] + '</span>'; }).join('');
    $('app').classList.remove('hidden');
    renderGrid();
    renderPicked();
  }

  function renderGrid() {
    var days = weeks[week] || [];
    var l = data.link;
    $('week').textContent = days.length ? days[0].slice(5).replace('-', '/') + ' – ' + days[days.length - 1].slice(5).replace('-', '/') : '';
    $('prev').disabled = week === 0;
    $('next').disabled = week >= weeks.length - 1;
    var g = $('grid');
    g.style.gridTemplateColumns = '38px repeat(' + Math.max(days.length, 1) + ', minmax(0, 1fr))';
    var h = '<div></div>' + days.map(function (d) {
      var dt = new Date(Slots.jstMidnight(d) + Slots.JST_OFFSET_MS);
      return '<div class="gh">' + dt.getUTCDate() + '<small>' + WD[dt.getUTCDay()] + '</small></div>';
    }).join('');
    for (var m = l.dayStart; m + l.slotMinutes <= l.dayEnd; m += l.slotMinutes) {
      h += '<div class="gt">' + (m % 60 === 0 ? Math.floor(m / 60) + ':00' : '') + '</div>';
      days.forEach(function (d) {
        var s = Slots.jstMidnight(d) + m * 60000;
        var y = bySlot[s];
        if (!y) { h += '<div></div>'; return; }
        h += '<div class="c y-' + y + (y === '×' ? ' x' : '') + (selected[s] ? ' sel' : '') + '" data-s="' + s + '">' + y + '</div>';
      });
    }
    g.innerHTML = h;
  }

  function ranges() {
    return Slots.mergeRanges(Object.keys(selected).map(Number), data.link.slotMinutes);
  }

  function renderPicked() {
    var rs = ranges();
    $('picked').innerHTML = rs.length
      ? rs.map(function (r) { return '<span class="slot">' + Slots.formatRange(r) + '<button type="button" data-a="' + r.start + '" data-z="' + r.end + '" aria-label="取り消す">×</button></span>'; }).join('<br>')
      : '<span class="empty">まだ選ばれていません</span>';
  }

  // ---- drag selection (mouse + touch via Pointer Events) ----
  var drag = null;
  function cellAt(ev) {
    var el = document.elementFromPoint(ev.clientX, ev.clientY);
    return el && el.closest ? el.closest('.c') : null;
  }
  function apply(c) {
    if (!c || !drag) return;
    var s = Number(c.dataset.s);
    if (Slots.jstDateString(s) !== drag.day) return;
    var a = Math.min(s, drag.from), z = Math.max(s, drag.from);
    var next = Object.assign({}, drag.base);
    for (var t = a; t <= z; t += data.link.slotMinutes * 60000) {
      if (!bySlot[t] || bySlot[t] === '×') continue;
      if (drag.add) next[t] = true; else delete next[t];
    }
    selected = next;
    renderGrid();
    renderPicked();
  }
  $('grid').addEventListener('pointerdown', function (ev) {
    var c = ev.target.closest('.c');
    if (!c || c.classList.contains('x')) return;
    var s = Number(c.dataset.s);
    drag = { day: Slots.jstDateString(s), from: s, add: !selected[s], base: Object.assign({}, selected) };
    apply(c);
    ev.preventDefault();
  });
  $('grid').addEventListener('pointermove', function (ev) { if (drag) apply(cellAt(ev)); });
  document.addEventListener('pointerup', function () { drag = null; });
  document.addEventListener('pointercancel', function () { drag = null; });

  $('picked').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-a]');
    if (!b) return;
    for (var t = Number(b.dataset.a); t < Number(b.dataset.z); t += data.link.slotMinutes * 60000) delete selected[t];
    renderGrid();
    renderPicked();
  });

  $('prev').onclick = function () { week--; renderGrid(); };
  $('next').onclick = function () { week++; renderGrid(); };

  // ---- submit ----
  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    var rs = ranges();
    var err = $('error');
    err.textContent = '';
    if (!rs.length) { err.textContent = '時間を選んでください。'; return; }
    if (!f.elements.name.value.trim()) { err.textContent = 'お名前を入力してください。'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.elements.email.value.trim())) { err.textContent = 'メールアドレスを確認してください。'; return; }
    var btn = $('submit');
    btn.disabled = true;
    btn.textContent = '送信中…';
    var body = JSON.stringify({
      action: 'request', l: linkId, name: f.elements.name.value, email: f.elements.email.value, message: f.elements.message.value,
      ranges: rs, hp: f.elements.website.value,
    });
    // text/plain avoids a CORS preflight, which Apps Script cannot answer.
    fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          $('done-list').innerHTML = rs.map(function (r) { return '<span class="slot">' + Slots.formatRange(r) + '</span>'; }).join('<br>');
          $('app').classList.add('hidden');
          $('done').classList.remove('hidden');
          window.scrollTo(0, 0);
          return;
        }
        err.textContent = ERRORS[res.error] || ERRORS.invalid;
        if (res.error === 'conflict') return load();
        if (res.error === 'closed') showClosed();
      })
      .catch(function () { err.textContent = ERRORS.network; })
      .then(function () { btn.disabled = false; btn.textContent = 'この時間で申請する'; });
  });

  if (!linkId) { showClosed(); return; }
  load().catch(function () { $('sub').textContent = ERRORS.network; });
})();
