// public/streak.js
// Reading streak: the ring (days in a row) and this week's dots on the home
// screen, and the check-in behind the "다 읽었어요" button.
//
// The streak API is being built by another teammate. Until it exists the
// server answers 404, and this file then hides the streak UI completely —
// no made-up numbers.
//
// ASSUMED API (not in the server yet):
//   GET  /api/streak          -> { current, longest, checkedInToday, week: ["2026-11-09", ...] }
//   POST /api/streak/checkin  -> the same shape, after marking today as read
//   `week` lists the dates (YYYY-MM-DD) read in the current week.
//
// Depends on auth.js (authFetch). Dates are computed in Asia/Seoul.

(function () {
  'use strict';

  var state = null;        // last good response, or null when unavailable

  // ---- Asia/Seoul calendar helpers ----
  function seoulToday() {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  // The seven dates (Mon..Sun) of the week that contains `iso`.
  function weekOf(iso) {
    var p = iso.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    var fromMonday = (d.getUTCDay() + 6) % 7;      // Mon = 0 ... Sun = 6
    var days = [];
    for (var i = 0; i < 7; i++) {
      var x = new Date(d);
      x.setUTCDate(d.getUTCDate() - fromMonday + i);
      days.push(x.toISOString().slice(0, 10));
    }
    return days;
  }

  function valid(data) {
    return data && typeof data.current === 'number' && Array.isArray(data.week);
  }

  // ---- Rendering ----
  // Elements (all optional): [data-streak] wrappers, #streak-count,
  // #streak-bar (svg circle r=23), #streak-ring, #streak-week
  var R = 23;
  var CIRC = 2 * Math.PI * R;

  function setHidden(hidden) {
    document.querySelectorAll('[data-streak]').forEach(function (el) { el.hidden = hidden; });
  }

  function render() {
    if (!state) { setHidden(true); return; }
    setHidden(false);

    var count = document.getElementById('streak-count');
    if (count) count.textContent = state.current;

    var ring = document.getElementById('streak-ring');
    if (ring) ring.setAttribute('aria-label', '연속 ' + state.current + '일');

    var bar = document.getElementById('streak-bar');
    if (bar) {
      bar.style.strokeDasharray = CIRC;
      // the ring fills over one week
      bar.style.strokeDashoffset = CIRC * (1 - Math.min(state.current, 7) / 7);
    }

    var week = document.getElementById('streak-week');
    if (week) {
      var today = seoulToday();
      var read = {};
      state.week.forEach(function (d) { read[String(d).slice(0, 10)] = true; });
      var letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
      week.innerHTML = weekOf(today).map(function (d, i) {
        var cls = (read[d] ? 'on' : '') + (d === today ? ' today' : '');
        return '<div class="' + cls.trim() + '"><span>' + letters[i] + '</span><i></i></div>';
      }).join('');
    }
  }

  // ---- API ----
  async function request(path, method) {
    try {
      var res = await authFetch(path, { method: method });
      if (!res.ok) return null;                 // 404 until the API exists
      var data = await res.json();
      return valid(data) ? data : null;
    } catch (err) {
      return null;                              // offline etc. -> hide
    }
  }

  // Load the streak and draw it. Resolves to the state, or null when hidden.
  async function load() {
    state = await request('/api/streak', 'GET');
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
