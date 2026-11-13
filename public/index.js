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
//   GET /api/rooms/:id/history          -> the last past poem + how many (History box, 시)
//   GET /api/rooms/:id/books/history    -> the room's books (History box, 소설)
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

    // memos + note marks, like the badges count them (models/badgesModel.js). Highlights don't
    // count, and old line notes (annotations) are not added: they are copied into poem_marks.
    var notes = ((today && today.poem_marks) || []).filter(function (m) { return m.kind === 'note'; });
    var items = ((today && today.memos) || []).concat(notes);
    // newest first, so the avatars show who wrote most recently
    items.sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
    var writers = [];
    items.forEach(function (m) { if (m.author_nickname && writers.indexOf(m.author_nickname) < 0) writers.push(m.author_nickname); });
    var count = items.length;
    $('hr-poem-meta').innerHTML = count
      ? '<span class="hr-avs-sm">' + avatars(writers, 3) + '</span>' +
        '<span class="hr-count"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-5 4z"/></svg>' + count + '</span>'
      : '<span class="hr-hint">첫 메모 남기기</span>';
    fitTitle($('hr-poem-title'));
    $('hr-poem').setAttribute('aria-label', '오늘의 시 읽기' + (title ? ', ' + title : '') + (count ? ', 메모 ' + count + '개' : ''));
  }

  function drawBook(room) {
    var has = !!room.book_title;
    var p = Math.max(0, Math.min(100, Number(room.book_progress || 0)));
    $('hr-book').href = '/book.html?id=' + enc(room.id);
    $('hr-book-title').textContent = has ? room.book_title : '아직 고른 책이 없어요';
    $('hr-book-title').className = 'hr-title' + (has ? sizeClass(room.book_title) : ' is-empty');
    $('hr-book-title').lang = has ? 'en' : 'ko';
    $('hr-book-bar').style.visibility = has ? '' : 'hidden';   // keep its space: the divider stays in the same place
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

  // History box: 시 | 소설 switch in place; the title and '전체 보기' open the History screen.
  var hist = { roomId: null, kind: 'poem', poems: null, books: null };
  var COUNT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-5 4z"/></svg>';

  function historyUrl() {
    return '/history.html?room=' + enc(hist.roomId) + '&tab=' + hist.kind;
  }

  function poemRow(r) {
    var m = /^\d{4}-(\d{2})-(\d{2})/.exec(r.date) || [];
    var dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(r.date + 'T12:00:00Z').getUTCDay()];
    var n = r.contributor_count || 0;
    return '<a class="hr-past" href="/room.html?id=' + enc(hist.roomId) + '&date=' + enc(r.date) + '">' +
        '<span class="hr-date">' + Number(m[1]) + '/' + m[2] + '<br>' + dow + '</span>' +
        '<span class="hr-past-main"><i>' + UI.poemTitleHtml(r.title || 'Untitled') + '</i><small>' + UI.poemTitleHtml(r.author || '') + '</small></span>' +
        (n ? '<span class="hr-count" aria-label="' + n + '명 참여">' + COUNT_ICON + n + '</span>' : '') +
      '</a>';
  }

  function bookRow(b) {
    var status = b.status === 'finished' ? '완독' : b.status === 'reading' ? '읽는 중' : b.progress + '%에서 멈춤';
    return '<a class="hr-past" href="' + (b.is_current ? '/book.html?id=' + enc(hist.roomId) : historyUrl()) + '">' +
        '<span class="hr-mini-cover" style="background-color:' + UI.coverColor(b.book_id) + '" aria-hidden="true"></span>' +
        '<span class="hr-past-main"><i>' + esc(b.title) + '</i><small>' + esc(status) + (b.status !== 'finished' ? ' · ' + b.progress + '%' : '') + '</small></span>' +
      '</a>';
  }

  function drawHistoryBox() {
    var isPoem = hist.kind === 'poem';
    document.querySelectorAll('.hr-history-tabs button').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.kind === hist.kind));
    });
    $('hr-history-link').href = historyUrl();

    var list = isPoem ? hist.poems : hist.books;
    if (list === null) {                       // still loading
      $('hr-past').innerHTML = '<p class="hr-empty">불러오는 중이에요…</p>';
      $('hr-all').hidden = true;
      return;
    }
    if (!list.length) {
      $('hr-past').innerHTML = '<p class="hr-empty">' + (isPoem ? '지난 시는 내일부터 여기에 쌓여요.' : '아직 이 방에서 고른 책이 없어요.') + '</p>';
      $('hr-all').hidden = true;
      return;
    }
    $('hr-past').innerHTML = isPoem ? poemRow(list[0]) : bookRow(list[0]);
    $('hr-all').href = historyUrl();
    $('hr-all').textContent = '전체 보기 · ' + list.length + (isPoem ? '편' : '권');
    $('hr-all').hidden = false;
  }

  document.querySelectorAll('.hr-history-tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.dataset.kind === hist.kind) return;
      UI.haptic();
      hist.kind = btn.dataset.kind;
      drawHistoryBox();
    });
  });

  function setHistory(room, poemsRes, booksRes) {
    var today = seoulToday();
    hist.roomId = room.id;
    hist.poems = poemsRes ? ((poemsRes.history || []).filter(function (r) { return r.date !== today; })) : [];
    hist.books = Array.isArray(booksRes) ? booksRes : [];
    drawHistoryBox();
  }

  async function load() {
    var status = $('status');
    status.textContent = '방을 불러오는 중이에요…';
    var rooms = await getJson('/api/rooms/mine');
    if (!rooms) { status.textContent = '방을 불러오지 못했어요. 다시 시도해 주세요.'; return; }
    status.textContent = '';

    var list = Array.isArray(rooms) ? rooms : [];
    window.TypoemHomeRooms = list;   // invite.js ('+') reads the room's code and owner from here
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
    hist.roomId = room.id;
    hist.poems = hist.books = null;
    drawHistoryBox();
    var results = await Promise.all([
      getJson('/api/rooms/' + id + '/today?checkin=0'),
      getJson('/api/rooms/' + id + '/members'),
      getJson('/api/rooms/' + id + '/history'),
      getJson('/api/rooms/' + id + '/books/history'),
    ]);
    drawPoem(room, results[0]);
    window.TypoemNative.sendTodayToWidget(results[0], room.id);   // home screen widget
    drawMembers(results[1]);
    setHistory(room, results[2], results[3]);
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
