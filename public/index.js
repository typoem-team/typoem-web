// public/index.js
// Home (안 2, 11/13): this week's streak, then ONE room shown large —
// today's poem and our book as two book covers, and the room's History.
// Which room: ?room=ID (the Rooms tab sends people here after picking one),
// otherwise the room I opened last (the server sorts /rooms/mine that way).
// Other rooms: the ⇄ next to the room name, or the Rooms tab.
//
// Data:
//   GET /api/rooms/mine                 -> rooms (name, today_poem_title, book_title, book_progress)
//   GET /api/rooms/:id/today?checkin=0  -> today's poem + memos (no streak check-in: only reading counts)
//   GET /api/rooms/:id/members          -> avatars
//   GET /api/rooms/:id/history          -> the last past poem + how many
// Depends on auth.js, ui.js (TypoemUI), streak.js (TypoemStreak). invite.js uses #hr-invite.

requireLogin();

(function () {
  'use strict';

  var UI = window.TypoemUI;
  var esc = UI.esc;
  function $(id) { return document.getElementById(id); }
  function enc(v) { return encodeURIComponent(v); }

  window.TypoemNative.setStatusBar('dark');   // dark status bar text on the page background
  TypoemStreak.load();                        // hides itself on 404

  function seoulToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  }

  async function getJson(url) {
    try {
      var res = await authFetch(url);
      return res.ok ? await res.json() : null;
    } catch (e) { return null; }
  }

  // Titles get smaller as they get longer: a first guess by length, then fitTitle()
  // shrinks a little more until no word is cut and it takes at most three lines.
  function sizeClass(title) {
    var n = String(title || '').length;
    return n > 34 ? ' is-xxlong' : n > 24 ? ' is-xlong' : n > 16 ? ' is-long' : n > 10 ? ' is-mid' : '';
  }

  var FIT_MIN = 14;   // px
  var FIT_LINES = 3;
  function fitTitle(el) {
    el.style.fontSize = '';
    if (el.classList.contains('is-empty') || !el.clientWidth) return;
    var size = parseFloat(getComputedStyle(el).fontSize);
    function overflows() {
      var lh = parseFloat(getComputedStyle(el).lineHeight) || size * 1.1;
      return el.scrollWidth > el.clientWidth + 1 || el.offsetHeight > lh * FIT_LINES + 1;
    }
    while (size > FIT_MIN && overflows()) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  }
  function fitTitles() {
    fitTitle($('hr-poem-title'));
    fitTitle($('hr-book-title'));
  }
  window.addEventListener('resize', fitTitles);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitles);

  function avatars(names, max) {
    return names.slice(0, max).map(function (n) { return UI.avatar(n); }).join('');
  }

  function drawPoem(room, today) {
    var poem = today && today.poem;
    var title = (poem && poem.title) || room.today_poem_title;
    $('hr-poem').href = '/room.html?id=' + enc(room.id);
    $('hr-poem-title').innerHTML = title ? UI.poemTitleHtml(title) : '오늘의 시를 열어 보세요';
    $('hr-poem-title').className = 'hr-title' + (title ? sizeClass(title) : ' is-empty');
    $('hr-poem-title').lang = title ? 'en' : 'ko';     // English titles: hyphenate in English

    var memos = (today && today.memos) || [];
    var writers = [];
    memos.forEach(function (m) { if (m.author_nickname && writers.indexOf(m.author_nickname) < 0) writers.push(m.author_nickname); });
    $('hr-poem-meta').innerHTML = memos.length
      ? '<span class="hr-avs-sm">' + avatars(writers, 3) + '</span>' +
        '<span class="hr-count"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-5 4z"/></svg>' + memos.length + '</span>'
      : '<span class="hr-hint">첫 메모 남기기</span>';
    fitTitle($('hr-poem-title'));
    $('hr-poem').setAttribute('aria-label', '오늘의 시 읽기' + (title ? ', ' + title : '') + (memos.length ? ', 메모 ' + memos.length + '개' : ''));
  }

  function drawBook(room) {
    var has = !!room.book_title;
    var p = Math.max(0, Math.min(100, Number(room.book_progress || 0)));
    $('hr-book').href = '/book.html?id=' + enc(room.id);
    $('hr-book-title').textContent = has ? room.book_title : '아직 고른 책이 없어요';
    $('hr-book-title').className = 'hr-title' + (has ? sizeClass(room.book_title) : ' is-empty');
    $('hr-book-title').lang = has ? 'en' : 'ko';
    $('hr-book-bar').hidden = !has;
    $('hr-book-bar').firstElementChild.style.width = p + '%';
    $('hr-book-meta').innerHTML = !has ? '<span class="hr-hint">책 고르기</span>'
      : p >= 100 ? '<b>완독</b>' : '<b>' + p + '%</b><span class="hr-hint">이어 읽기</span>';
    fitTitle($('hr-book-title'));
    $('hr-book').setAttribute('aria-label', has ? '책 이어 읽기, ' + room.book_title + ', ' + p + '%' : '이 방의 책 고르기');
  }

  function drawMembers(members) {
    var names = (members || []).map(function (m) { return m.nickname || m.username || ''; });
    $('hr-avs').innerHTML = avatars(names, 4);
    $('hr-avs').setAttribute('aria-label', '멤버 ' + names.length + '명');
    $('hr-avs').setAttribute('role', 'img');
  }

  function drawHistory(room, history) {
    var id = enc(room.id);
    $('hr-history-poem').href = '/history.html?room=' + id + '&tab=poem';
    $('hr-history-book').href = '/history.html?room=' + id + '&tab=book';
    var today = seoulToday();
    var past = ((history && history.history) || []).filter(function (r) { return r.date !== today; });
    if (!past.length) {
      $('hr-past').innerHTML = '<p class="hr-empty">지난 시는 내일부터 여기에 쌓여요.</p>';
      $('hr-all').hidden = true;
      return;
    }
    var r = past[0];
    var m = /^\d{4}-(\d{2})-(\d{2})/.exec(r.date) || [];
    var dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(r.date + 'T12:00:00Z').getUTCDay()];
    var n = r.contributor_count || 0;
    $('hr-past').innerHTML =
      '<a class="hr-past" href="/room.html?id=' + id + '&date=' + enc(r.date) + '">' +
        '<span class="hr-date">' + Number(m[1]) + '/' + m[2] + '<br>' + dow + '</span>' +
        '<span class="hr-past-main"><i>' + UI.poemTitleHtml(r.title || 'Untitled') + '</i><small>' + UI.poemTitleHtml(r.author || '') + '</small></span>' +
        (n ? '<span class="hr-count" aria-label="' + n + '명 참여"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-5 4z"/></svg>' + n + '</span>' : '') +
      '</a>';
    $('hr-all').href = '/history.html?room=' + id + '&tab=poem';
    $('hr-all').textContent = '전체 보기 · ' + past.length + '편';
    $('hr-all').hidden = false;
  }

  async function load() {
    var status = $('status');
    status.textContent = '방을 불러오는 중이에요…';
    var rooms = await getJson('/api/rooms/mine');
    if (!rooms) { status.textContent = '방을 불러오지 못했어요. 다시 시도해 주세요.'; return; }
    status.textContent = '';

    var list = Array.isArray(rooms) ? rooms : [];
    $('empty-state').hidden = list.length > 0;
    $('home-room').hidden = !list.length;
    if (!list.length) return;

    var want = new URLSearchParams(window.location.search).get('room');
    var room = list.find(function (r) { return String(r.id) === String(want); }) || list[0];

    // what /rooms/mine already has: draw it now, fill in the rest below
    $('hr-name').textContent = room.name;
    $('hr-invite').dataset.inviteRoom = String(room.id);
    drawPoem(room, null);
    drawBook(room);

    var id = enc(room.id);
    var results = await Promise.all([
      getJson('/api/rooms/' + id + '/today?checkin=0'),
      getJson('/api/rooms/' + id + '/members'),
      getJson('/api/rooms/' + id + '/history'),
    ]);
    drawPoem(room, results[0]);
    drawMembers(results[1]);
    drawHistory(room, results[2]);
  }

  load();

  // Back from a room via the back/forward cache: today's poem, memos and progress may have changed.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    window.TypoemNative.setStatusBar('dark');
    TypoemStreak.load();
    load();
  });
})();
