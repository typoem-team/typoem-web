// public/ui.js
// Shared app chrome for the logged-in screens:
//   - date line (11/10 Tue, Asia/Seoul)
//   - bottom tab bar: 오늘 · 내 방 · 단어장 · 나
//   - bottom sheets + toast
//
//   - small helpers shared by the screens (escape, cover / avatar colours, haptic)
//   - window.TypoemNav.back() and window.TypoemNative for the Android app shell
//
// Load after auth.js. A page picks its active tab with <body data-tab="...">
// (today | vocab).

(function () {
  'use strict';

  var LAST_ROOM_KEY = 'typoem:lastRoom';

  // ---- Date: always computed in Asia/Seoul, shown as "11/10 Tue" ----
  // (The server's "today" is UTC for now, so it rolls over at 09:00 KST.)
  function seoulParts(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
    }).formatToParts(date || new Date());
    var out = {};
    parts.forEach(function (p) { out[p.type] = p.value; });
    return out;
  }

  function formatDay(date) {
    var p = seoulParts(date);
    return p.month + '/' + p.day + ' ' + p.weekday;
  }

  // 'YYYY-MM-DD' (a calendar date from the API) -> "11/10 Tue"
  function formatIsoDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    // Noon UTC is the same calendar day in Seoul, so the weekday comes out right.
    return formatDay(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)));
  }

  // ---- Escape user-provided text before inserting into HTML (XSS guard) ----
  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // ---- Colours ----
  // One cover colour per poem, picked by id so a poem always gets the same one.
  var COVERS = ['#2e3d35', '#5a2b33', '#2a3444', '#7a5f36', '#3b3a36', '#4a5a46', '#4b3b4f'];
  function coverColor(id) {
    var n = Math.abs(parseInt(id, 10)) || 0;
    return COVERS[n % COVERS.length];
  }

  // Avatar colour from the nickname (the history API only gives nicknames).
  var AVATARS = ['#6e2f3a', '#2a3444', '#7a5f36', '#1f1b16', '#4a5a46', '#4b3b4f'];
  function avatarColor(name) {
    var s = String(name || ''), h = 7;
    for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i) * (i + 1)) % 65521;
    return AVATARS[h % AVATARS.length];
  }

  // <i> avatar with the first letter of the nickname
  function avatar(name) {
    var first = Array.from(String(name || '?'))[0] || '?';
    return '<i style="background:' + avatarColor(name) + '">' + esc(first) + '</i>';
  }

  // ---- Haptic: a light tap in the Android app, nothing on the web ----
  function haptic() {
    try {
      var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (H) H.impact({ style: 'LIGHT' });
    } catch (e) { /* never let a buzz break the screen */ }
  }

  // ---- Quiet motion: Web Animations API, off when the user asks ----
  var EASE = 'cubic-bezier(.22,.61,.36,1)';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function anim(el, frames, opts) {
    if (reduceMotion || !el || !el.animate) return { finished: Promise.resolve() };
    return el.animate(frames, Object.assign({ duration: 400, easing: EASE, fill: 'both' }, opts));
  }

  // ---- Last opened room (the home screen opens this room) ----
  function getLastRoom() {
    try { return localStorage.getItem(LAST_ROOM_KEY); } catch (e) { return null; }
  }
  function setLastRoom(id) {
    try {
      if (id == null) localStorage.removeItem(LAST_ROOM_KEY);
      else localStorage.setItem(LAST_ROOM_KEY, String(id));
    } catch (e) { /* storage may be unavailable */ }
  }

  // ---- Toast ----
  var toastEl = null;
  var toastTimer = null;
  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    // next frame, so the transition runs the first time too
    requestAnimationFrame(function () { toastEl.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
  }

  // ---- Bottom sheets (one scrim, one open sheet at a time) ----
  var scrim = null;
  var lastFocus = null;

  function ensureScrim() {
    if (scrim) return;
    scrim = document.createElement('div');
    scrim.className = 'scrim';
    document.body.appendChild(scrim);
    scrim.addEventListener('click', closeSheets);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openSheetEl()) closeSheets();
    });
  }

  function openSheetEl() {
    return document.querySelector('.sheet.show');
  }

  function openSheet(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    ensureScrim();
    document.querySelectorAll('.sheet.show').forEach(function (s) {
      if (s !== el) s.classList.remove('show');
    });
    if (!openSheetEl()) lastFocus = document.activeElement;
    scrim.classList.add('show');
    el.classList.add('show');
    el.scrollTop = 0;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }

  // Returns true if a sheet was open (the app's back button uses this later).
  function closeSheets() {
    var open = document.querySelectorAll('.sheet.show');
    if (scrim) scrim.classList.remove('show');
    open.forEach(function (s) { s.classList.remove('show'); });
    if (open.length && lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
    open.forEach(function (s) { s.dispatchEvent(new CustomEvent('sheet:close')); });
    return open.length > 0;
  }

  // The grab handle and any [data-close] button close the sheet they are in.
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('.sheet .handle, .sheet [data-close]') : null;
    if (t) closeSheets();
  });

  // ---- "나" sheet: nickname, privacy policy, log out ----
  var meSheet = null;
  function openMe() {
    if (!meSheet) {
      meSheet = document.createElement('section');
      meSheet.className = 'sheet';
      meSheet.id = 'sheet-me';
      meSheet.setAttribute('role', 'dialog');
      meSheet.setAttribute('aria-label', '나');
      meSheet.innerHTML =
        '<span class="handle"></span>' +
        '<p class="s-title"><b id="nav-user"></b>' +
        '<span id="nav-username"></span></p>' +
        '<a class="s-row" href="/privacy.html">개인정보처리방침</a>' +
        '<button type="button" class="s-row quiet" id="logout-btn">로그아웃</button>';
      document.body.appendChild(meSheet);

      var user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
      // textContent: nickname / username are user input
      meSheet.querySelector('#nav-user').textContent = (user && user.nickname) || '';
      meSheet.querySelector('#nav-username').textContent = (user && user.username) ? '@' + user.username : '';
      meSheet.querySelector('#logout-btn').addEventListener('click', function () {
        if (typeof logout === 'function') logout();
      });
    }
    openSheet(meSheet);
  }

  // ---- Bottom tab bar ----
  var ICONS = {
    today: '<path d="M4 5.5C6.5 4 9.5 4 12 5.5v14C9.5 18 6.5 18 4 19.5zM20 5.5C17.5 4 14.5 4 12 5.5v14c2.5-1.5 5.5-1.5 8 0z"/>',
    rooms: '<path d="M4 10l8-6 8 6v10H4z"/><path d="M9 20v-6h6v6"/>',
    vocab: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    me: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5"/>',
  };

  function icon(key) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[key] + '</svg>';
  }

  function buildTabbar() {
    if (document.getElementById('tabbar')) return;
    var active = document.body.dataset.tab || '';
    var isHome = active === 'today' && !!document.getElementById('home');

    var nav = document.createElement('nav');
    nav.className = 'tabbar';
    nav.id = 'tabbar';
    nav.setAttribute('aria-label', '메뉴');
    nav.innerHTML =
      '<a class="tab" data-tab="today" href="/index.html">' + icon('today') + '오늘</a>' +
      '<a class="tab" data-tab="rooms" href="/index.html#rooms">' + icon('rooms') + '내 방</a>' +
      '<a class="tab" data-tab="vocab" href="/vocab.html">' + icon('vocab') + '단어장</a>' +
      '<button type="button" class="tab" data-tab="me" aria-haspopup="dialog">' + icon('me') + '나</button>';
    nav.querySelectorAll('.tab').forEach(function (t) {
      if (t.dataset.tab === active) t.setAttribute('aria-current', 'page');
    });
    nav.querySelector('[data-tab="me"]').addEventListener('click', function () { haptic(); openMe(); });
    // 내 방 opens the room list sheet on the home screen; from other pages the
    // link goes to /index.html#rooms and the home screen opens it on load.
    nav.querySelector('[data-tab="rooms"]').addEventListener('click', function (e) {
      if (!isHome) return;
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('typoem:rooms'));
    });
    document.body.appendChild(nav);
  }

  function fillDate() {
    var el = document.getElementById('today');
    if (el) el.textContent = formatDay();
  }

  function init() {
    fillDate();
    if (document.body.dataset.tab !== undefined) buildTabbar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // ---- Android back button (the app shell calls TypoemNav.back()) ----
  // Order: close an open sheet -> the page's own handler (reader -> home) ->
  // not handled (false), and the shell then leaves the app.
  var backHandler = null;
  window.TypoemNav = {
    back: function () {
      if (closeSheets()) return true;
      if (backHandler) return backHandler() !== false;
      return false;
    },
    setBackHandler: function (fn) { backHandler = fn; },
  };

  // ---- Native status bar text colour: 'light' on dark covers, 'dark' on paper ----
  // Does nothing outside the app.
  window.TypoemNative = {
    setStatusBar: function (tone) {
      try {
        var S = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
        // Capacitor: Style.Dark = light text, Style.Light = dark text
        if (S) S.setStyle({ style: tone === 'light' ? 'DARK' : 'LIGHT' });
      } catch (e) { /* not in the app */ }
    },
  };

  window.TypoemUI = {
    esc: esc,
    coverColor: coverColor,
    avatarColor: avatarColor,
    avatar: avatar,
    haptic: haptic,
    anim: anim,
    reduceMotion: reduceMotion,
    formatDay: formatDay,
    formatIsoDay: formatIsoDay,
    getLastRoom: getLastRoom,
    setLastRoom: setLastRoom,
    toast: toast,
    openSheet: openSheet,
    closeSheets: closeSheets,
  };
})();
