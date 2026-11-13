// public/streak.js
// Reading streak (시안 C, docs/design/Design.md):
//   - home: this week as seven day circles (#streak-week) with "11월 · 이번 주" and "N일째 이어 읽는 중"
//   - 나: the big number (#streak-count), the longest streak, and this month's calendar (#streak-month)
// A day counts when I open a poem or a book that day (the server checks me in).
//
// API (controllers/streakController.js):
//   GET  /api/streak[?month=YYYY-MM] -> { current, longest, checkedInToday, week: ["2026-11-09", ...],
//                                         month?: "2026-11", days?: ["2026-11-01", ...] }
//   POST /api/streak/checkin         -> the same without month/days
// If the API fails, the streak UI stays hidden: no made-up numbers.
//
// Elements (all optional): [data-streak] wrappers, #streak-week, #streak-week-label, #streak-summary,
// #streak-count, #streak-sub, #streak-month.
// Depends on auth.js (authFetch). Dates are Korea calendar days.

(function () {
  'use strict';

  var state = null;        // last good response, or null when unavailable
  var days = null;         // this month's read days (only when #streak-month is on the page)

  var DOW_KO = ['월', '화', '수', '목', '금', '토', '일'];

  function $(id) { return document.getElementById(id); }

  // ---- Asia/Seoul calendar helpers ----
  function seoulToday() {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }
  function utc(iso) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] || 1));
  }
  function iso(d) { return d.toISOString().slice(0, 10); }

  // The seven dates (Mon..Sun) of the week that contains `day`.
  function weekOf(day) {
    var d = utc(day);
    var fromMonday = (d.getUTCDay() + 6) % 7;      // Mon = 0 ... Sun = 6
    var out = [];
    for (var i = 0; i < 7; i++) {
      var x = new Date(d);
      x.setUTCDate(d.getUTCDate() - fromMonday + i);
      out.push(iso(x));
    }
    return out;
  }


  function valid(data) {
    return data && typeof data.current === 'number' && Array.isArray(data.week);
  }

  function setHidden(hidden) {
    document.querySelectorAll('[data-streak]').forEach(function (el) { el.hidden = hidden; });
  }

  function dayLabel(d, read, today) {
    var x = utc(d);
    return (x.getUTCMonth() + 1) + '월 ' + x.getUTCDate() + '일 ' + DOW_KO[(x.getUTCDay() + 6) % 7] + '요일' +
      (d === today ? ', 오늘' : '') + (read ? ', 읽음' : (d > today ? '' : ', 안 읽음'));
  }

  // ---- Rendering ----
  function renderWeek(today) {
    var el = $('streak-week');
    if (!el) return;
    var read = {};
    state.week.forEach(function (d) { read[String(d).slice(0, 10)] = true; });
    el.setAttribute('role', 'list');
    el.innerHTML = weekOf(today).map(function (d, i) {
      var cls = 'sw-day' + (read[d] ? ' is-read' : '') + (d === today ? ' is-today' : '') + (d > today ? ' is-future' : '');
      return '<div class="' + cls + '" role="listitem" aria-label="' + dayLabel(d, read[d], today) + '">' +
          '<span class="sw-dow" aria-hidden="true">' + DOW_KO[i] + '</span>' +
          '<span class="sw-num" aria-hidden="true">' + utc(d).getUTCDate() + '</span>' +
          '<i class="sw-dot" aria-hidden="true"></i>' +
        '</div>';
    }).join('');

    var label = $('streak-week-label');
    if (label) label.textContent = (utc(today).getUTCMonth() + 1) + '월 · 이번 주';
  }

  function renderSummary() {
    var sum = $('streak-summary');
    if (sum) {
      sum.textContent = state.current > 0
        ? state.current + '일째 이어 읽는 중'
        : '오늘 시나 책을 열면 시작돼요';
    }
    var count = $('streak-count');
    if (count) {
      count.textContent = state.current;
      count.setAttribute('aria-label', state.current + '일째 이어 읽는 중');
    }
    var sub = $('streak-sub');
    if (sub) {
      sub.innerHTML = '가장 길게 이은 기록 <b>' + (state.longest || 0) + '</b>일 · ' +
        (state.checkedInToday ? '오늘 읽음' : '오늘은 아직이에요');
    }
  }

  function renderMonth(today) {
    var el = $('streak-month');
    if (!el || !days) return;
    var read = {};
    days.forEach(function (d) { read[String(d).slice(0, 10)] = true; });
    if (state.checkedInToday) read[today] = true;

    var first = utc(today.slice(0, 7) + '-01');
    var y = first.getUTCFullYear(), m = first.getUTCMonth();
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var lead = (first.getUTCDay() + 6) % 7;            // empty cells before the 1st (Mon first)
    var count = Object.keys(read).filter(function (d) { return d.slice(0, 7) === today.slice(0, 7); }).length;

    var cells = '';
    for (var i = 0; i < lead; i++) cells += '<span class="sm-cell is-empty" aria-hidden="true"></span>';
    for (var n = 1; n <= last; n++) {
      var d = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(n).padStart(2, '0');
      var cls = 'sm-cell' + (read[d] ? ' is-read' : '') + (d === today ? ' is-today' : '') + (d > today ? ' is-future' : '');
      cells += '<span class="' + cls + '" role="listitem" aria-label="' + dayLabel(d, read[d], today) + '">' + n + '</span>';
    }

    el.innerHTML =
      '<div class="sm-head"><span>' + y + '년 ' + (m + 1) + '월</span><span>읽은 날 ' + count + '일</span></div>' +
      '<div class="sm-grid sm-dows" aria-hidden="true">' + DOW_KO.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="sm-grid" role="list" aria-label="' + (m + 1) + '월에 읽은 날">' + cells + '</div>';
  }

  function render() {
    if (!state) { setHidden(true); return; }
    setHidden(false);
    var today = seoulToday();
    renderWeek(today);
    renderSummary();
    renderMonth(today);
  }

  // ---- API ----
  async function request(path, method) {
    try {
      var res = await authFetch(path, { method: method });
      if (!res.ok) return null;
      var data = await res.json();
      return valid(data) ? data : null;
    } catch (err) {
      return null;                              // offline etc. -> hide
    }
  }

  // Load the streak and draw it. Resolves to the state, or null when hidden.
  // A page with #streak-month also gets this month's read days.
  async function load() {
    var path = '/api/streak';
    if ($('streak-month')) path += '?month=' + seoulToday().slice(0, 7);
    state = await request(path, 'GET');
    days = state && Array.isArray(state.days) ? state.days : days;
    render();
    return state;
  }

  // Mark today as read. Resolves to the new state, or null if it failed.
  async function checkin() {
    var next = await request('/api/streak/checkin', 'POST');
    if (next) { state = next; render(); }
    return next;
  }

  window.TypoemStreak = {
    load: load,
    checkin: checkin,
    get: function () { return state; },
  };
})();
