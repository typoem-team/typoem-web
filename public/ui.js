// public/ui.js
// Shared app chrome for the logged-in screens:
//   - date line (11/10 Tue, Asia/Seoul)
//   - bottom tab bar: 홈 · 방 · 단어장 · 나
//   - bottom sheets + toast
//   - room cards (rooms.html, and the home screen next)
//
//   - small helpers shared by the screens (escape, cover / avatar colours, haptic)
//   - window.TypoemNav.back() and window.TypoemNative for the Android app shell
//
// Load after auth.js. A page picks its active tab with <body data-tab="...">
// (today | rooms | vocab).

(function () {
  'use strict';


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

  // ---- Korean dictionary meanings (dictionary popup + vocab notebook) ----
  // A meaning can hold several ' / '-separated parts: one line each, at most 5.
  function koSenses(entry) {
    return ((entry && entry.ko) || [])
      .reduce(function (all, g) { return all.concat(String(g).split(' / ')); }, [])
      .map(function (t) { return t.replace(/\s*;\s*/g, ', ').trim(); })   // ";" looks like a glitch: show ","
      .filter(Boolean)
      .slice(0, 5);
  }

  // Escaped HTML of one meaning; (..) hints such as "(식사 등을) 하다" get a lighter colour
  // so the meaning itself stands out.
  function koHtml(text) {
    return esc(text).replace(/\((?:[^()]|\([^()]*\))*\)/g, function (g) {
      return '<span class="d-hint">' + g + '</span>';
    });
  }

  // ---- Colours ----
  // The colours live in styles.css (:root tokens), so a palette change or dark
  // mode only touches the stylesheet. These read the token at call time; the hex
  // values are only a fallback for a page without styles.css. They return a real
  // colour (not var(...)) because the reading screen also puts it in <meta theme-color>.
  function token(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  // One cover colour per poem, picked by id so a poem always gets the same one.
  var COVERS = ['#2e3d35', '#5a2b33', '#2a3444', '#7a5f36', '#3b3a36', '#4a5a46', '#4b3b4f']; // --cover-1..7
  function coverColor(id) {
    var n = Math.abs(parseInt(id, 10)) || 0;
    var k = n % COVERS.length;
    return token('--cover-' + (k + 1), COVERS[k]);
  }

  // Avatar colour from the nickname (the history API only gives nicknames).
  var AVATARS = [
    ['--accent', '#6e2f3a'], ['--cover-3', '#2a3444'], ['--cover-4', '#7a5f36'],
    ['--ink', '#1f1b16'], ['--cover-6', '#4a5a46'], ['--cover-7', '#4b3b4f'],
  ];
  function avatarColor(name) {
    var s = String(name || ''), h = 7;
    for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i) * (i + 1)) % 65521;
    var a = AVATARS[h % AVATARS.length];
    return token(a[0], a[1]);
  }

  // <i> avatar with the first letter of the nickname
  function avatar(name) {
    var first = Array.from(String(name || '?'))[0] || '?';
    return '<i style="background:' + avatarColor(name) + '">' + esc(first) + '</i>';
  }

  // Long titles step down in size so they fit a cover / the reader band.
  // Returns an extra class for a .c-title element ('' for short titles).
  function titleSize(title) {
    var n = String(title || '').length;
    if (n > 44) return ' c-title-xs';
    if (n > 24) return ' c-title-sm';
    if (n > 12) return ' c-title-md';
    return '';
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

  // ---- Room cards (rows from GET /api/rooms/mine) ----
  // The server already sends my rooms in order: last opened first (on any device), then newest.

  // PoetryDB titles: "--" is an em dash, _word_ is italics (same rules as the reader)
  function poemTitleHtml(t) {
    return esc(t).replace(/-{2,}/g, '—').replace(/_([^_]+)_/g, '<em>$1</em>');
  }

  // One room: its name large; today's poem and the book's progress small.
  // A link straight into the room's 시 tab (no overview in between).
  function roomCard(r, isLast) {
    var poem = r.today_poem_title
      ? '<i class="rc-poem">' + poemTitleHtml(r.today_poem_title) + '</i>'
      : '<span class="rc-none">오늘의 시를 열어 보세요</span>';
    var book = r.book_title
      ? '<i class="rc-book">' + esc(r.book_title) + '</i>' +
        '<span class="rc-bar" aria-hidden="true"><span style="width:' + Number(r.book_progress || 0) + '%"></span></span>' +
        '<span class="rc-num">' + (r.book_progress >= 100 ? '완독' : Number(r.book_progress || 0) + '%') + '</span>'
      : '<span class="rc-none">아직 고른 책이 없어요</span>';
    return '<a class="room-card" href="/room.html?id=' + encodeURIComponent(r.id) + '" data-room-id="' + esc(r.id) + '">' +
        '<span class="rc-top"><b class="rc-name">' + esc(r.name) + '</b>' +
          (isLast ? '<span class="rc-tag">최근</span>' : '') + '</span>' +
        '<span class="rc-line"><span class="rc-label">TODAY</span>' + poem + '</span>' +
        '<span class="rc-line"><span class="rc-label">BOOK</span>' + book + '</span>' +
        '<span class="rc-meta">멤버 ' + esc(r.member_count) + '명</span>' +
      '</a>';
  }

  // ---- Room header: back · room name · 시 | 책 (room.html and book.html) ----
  // A room is the unit; 시 and 책 are its two tabs. Both pages take ?id= (book.html also
  // still reads the old ?room=). Drawn as soon as ui.js runs, so room.js / book.js
  // find #room-name right away. The room name opens the invite sheet (invite.js).
  function roomId() {
    var q = new URLSearchParams(window.location.search);
    return q.get('id') || q.get('room');
  }

  function drawRoomBar() {
    var bar = document.querySelector('[data-room-bar]');
    if (!bar) return;
    var tab = bar.dataset.roomBar;       // 'poem' | 'book'
    var id = encodeURIComponent(roomId() || '');
    // a past poem (room.html?date=) goes back to History, everything else to home
    var back = new URLSearchParams(window.location.search).get('date')
      ? '/history.html?room=' + id + '&tab=poem' : '/index.html';
    function tabLink(key, href, label) {
      return '<a href="' + href + '"' + (key === tab ? ' aria-current="page"' : '') + '>' + label + '</a>';
    }
    bar.innerHTML =
      '<a href="' + back + '" class="r-back" aria-label="뒤로">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></a>' +
      '<button type="button" class="r-room" aria-haspopup="dialog" aria-label="멤버 · 초대">' +
        '<span id="room-name"></span>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c1-3.3 3.3-5 6-5s5 1.7 6 5"/><path d="M19 8v6M16 11h6"/></svg>' +
      '</button>' +
      '<nav class="r-tabs" aria-label="시와 책">' +
        tabLink('poem', '/room.html?id=' + id, '시') +
        tabLink('book', '/book.html?id=' + id, '책') +
      '</nav>';
  }
  drawRoomBar();

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

  // ---- Sheets ----
  // One piece of markup (<section class="sheet">), three looks, chosen by width:
  //   under 600px      bottom sheet
  //   600px and up     centred dialog
  //   1024px and up    whatever the element asks for with data-wide:
  //     (none)             centred dialog
  //     data-wide="inline"   always visible in the page (a card / side panel); never "opened"
  //     data-wide="popover"  a small panel next to the element that opened it, no scrim
  // CSS does the looks; this code only decides scrim / position / focus.
  var wideMQ = window.matchMedia('(min-width: 1024px)');
  function isWide() { return wideMQ.matches; }
  function modeOf(el) {
    return isWide() ? (el.dataset.wide || 'dialog') : 'sheet';
  }

  var scrim = null;
  var lastFocus = null;       // what to focus again when the open sheet closes
  var popAnchor = null;       // element an open popover is attached to

  function ensureScrim() {
    if (scrim) return;
    scrim = document.createElement('div');
    scrim.className = 'scrim';
    document.body.appendChild(scrim);
    scrim.addEventListener('click', closeSheets);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openSheetEl()) {
      e.preventDefault();
      closeSheets();
    }
  });

  function openSheetEl() {
    return document.querySelector('.sheet.show');
  }

  // Something that can take focus back later (a poem word is a plain span).
  function focusable(el) {
    if (!el || el === document.body) return null;
    if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    return el;
  }

  // Put a popover next to its anchor: below it, or above when there is no room
  // below; kept inside the viewport sideways. Works for absolute and fixed.
  function placePopover(el) {
    if (!popAnchor || !el.classList.contains('show') || modeOf(el) !== 'popover') return;
    var fixed = getComputedStyle(el).position === 'fixed';
    var parent = el.offsetParent || document.body;
    var pr = fixed ? { left: 0, top: 0 } : parent.getBoundingClientRect();
    var ar = popAnchor.getBoundingClientRect();
    var gap = 8, edge = 12;
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    el.style.maxHeight = '';
    var w = el.offsetWidth, h = el.offsetHeight;

    var left = el.dataset.align === 'end' ? ar.right - w : ar.left;
    left = Math.max(edge, Math.min(left, vw - w - edge));
    // below the anchor; above it when it fits better there. If it fits on
    // neither side, it takes the roomier side and scrolls inside.
    var below = vh - ar.bottom - gap - edge, above = ar.top - gap - edge;
    var goAbove = h > below && above > below;
    var room = Math.max(160, goAbove ? above : below);
    if (h > room) { el.style.maxHeight = room + 'px'; h = room; }
    var top = goAbove ? ar.top - h - gap : ar.bottom + gap;
    if (fixed) top = Math.max(edge, Math.min(top, vh - h - edge));

    el.style.left = (left - pr.left) + 'px';
    el.style.top = (top - pr.top) + 'px';
    el.dataset.side = top < ar.top ? 'above' : 'below';
  }

  // opts.anchor: for a popover, the element it belongs to (default: the focused element)
  function openSheet(el, opts) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    opts = opts || {};
    var mode = modeOf(el);
    if (mode === 'inline') return;          // already on the page

    var wasOpen = el.classList.contains('show');
    document.querySelectorAll('.sheet.show').forEach(function (s) {
      if (s !== el) {
        s.classList.remove('show');
        s.dispatchEvent(new CustomEvent('sheet:close'));
      }
    });
    var opener = opts.anchor || document.activeElement;
    if (!wasOpen || mode === 'popover') lastFocus = focusable(opener) || lastFocus;

    if (mode === 'popover') {
      if (scrim) scrim.classList.remove('show');
      popAnchor = opts.anchor || opener;
      el.style.left = el.style.top = el.style.maxHeight = '';
      el.classList.add('show');
      placePopover(el);
    } else {
      ensureScrim();
      popAnchor = null;
      el.style.left = el.style.top = el.style.maxHeight = '';
      scrim.classList.add('show');
      el.classList.add('show');
    }
    el.scrollTop = 0;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });     // move focus inside
  }

  // Returns true if something was open (the app's back button relies on this).
  function closeSheets() {
    var open = document.querySelectorAll('.sheet.show');
    if (scrim) scrim.classList.remove('show');
    open.forEach(function (s) { s.classList.remove('show'); });
    // give focus back to whatever opened it
    if (open.length && lastFocus && lastFocus.isConnected && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
    popAnchor = null;
    open.forEach(function (s) { s.dispatchEvent(new CustomEvent('sheet:close')); });
    return open.length > 0;
  }

  // The grab handle and any [data-close] button close the sheet they are in.
  // A click outside an open popover closes it (bubble phase, so the page's own
  // handlers see it as still open while they run).
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('.sheet .handle, .sheet [data-close]') : null;
    if (t) { closeSheets(); return; }
    var open = openSheetEl();
    if (!open || modeOf(open) !== 'popover') return;
    if (open.contains(e.target)) return;
    if (popAnchor && popAnchor.contains(e.target)) return;
    closeSheets();
  });

  window.addEventListener('resize', function () {
    var open = openSheetEl();
    if (open) placePopover(open);
  });

  // Crossing 1024px changes what a sheet is, so close whatever is open and let
  // the screens rearrange themselves.
  var wideListeners = [];
  function onWideChange(fn) { wideListeners.push(fn); }
  function wideChanged() {
    closeSheets();
    wideListeners.forEach(function (fn) { fn(isWide()); });
  }
  if (wideMQ.addEventListener) wideMQ.addEventListener('change', wideChanged);
  else if (wideMQ.addListener) wideMQ.addListener(wideChanged);

  // ---- Navigation: bottom tab bar, or the top bar at 1024px+ ----
  // Same element both ways (CSS moves it). It is the first thing in <body>, so
  // the Tab key reaches it first: Typoem · 홈 · 방 · 단어장 · nickname.
  var ICONS = {
    today: '<path d="M4 10l8-6 8 6v10H4z"/><path d="M9 20v-6h6v6"/>',
    rooms: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c1-3.3 3.3-5 6-5s5 1.7 6 5"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17 14.2c2 .6 3.4 2.2 4 4.8"/>',
    vocab: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    me: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5"/>',
  };

  function icon(key) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[key] + '</svg>';
  }

  function buildTabbar() {
    if (document.getElementById('tabbar')) return;
    var active = document.body.dataset.tab || '';

    var nav = document.createElement('nav');
    nav.className = 'tabbar';
    nav.id = 'tabbar';
    nav.setAttribute('aria-label', '메뉴');
    nav.innerHTML =
      '<a class="nav-brand" href="/index.html">Typoem</a>' +
      '<div class="tabs-main">' +
        '<a class="tab" data-tab="today" href="/index.html">' + icon('today') + '홈</a>' +
        '<a class="tab" data-tab="rooms" href="/rooms.html">' + icon('rooms') + '방</a>' +
        '<a class="tab" data-tab="vocab" href="/vocab.html">' + icon('vocab') + '단어장</a>' +
      '</div>' +
      '<a class="tab tab-me" data-tab="me" href="/me.html">' + icon('me') +
        '<span class="tab-me-label">나</span><span class="tab-me-nick"></span></a>';
    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    // textContent: the nickname is user input
    nav.querySelector('.tab-me-nick').textContent = (user && user.nickname) || '나';
    nav.querySelectorAll('.tab').forEach(function (t) {
      if (t.dataset.tab === active) t.setAttribute('aria-current', 'page');
    });
    document.body.insertBefore(nav, document.body.firstChild);
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
    koSenses: koSenses,
    koHtml: koHtml,
    coverColor: coverColor,
    avatarColor: avatarColor,
    avatar: avatar,
    titleSize: titleSize,
    haptic: haptic,
    anim: anim,
    reduceMotion: reduceMotion,
    formatDay: formatDay,
    formatIsoDay: formatIsoDay,
    roomCard: roomCard,
    poemTitleHtml: poemTitleHtml,
    toast: toast,
    openSheet: openSheet,
    closeSheets: closeSheets,
    placePopover: placePopover,
    isWide: isWide,
    onWideChange: onWideChange,
  };
})();
