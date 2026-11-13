// public/history.js
// History — this room's past poems (시) and the books it has read (소설).
// history.html?room=ID&tab=poem|book. Reached from the poem screen's "History" link.
//
// Data:
//   GET /api/rooms/mine                 -> this room's name and owner
//   GET /api/rooms/:id/history          -> { history: [{ date, poem_id, title, author, contributors, contributor_count }] }
//   GET /api/rooms/:id/books/history    -> [{ book_id, title, author, is_current, status, progress,
//                                             last_read_at, finished_at, my_mark_count, readers: [{ nickname, progress, finished }] }]
//   PUT /api/rooms/:id/book { gutenbergId }   (이 책으로 다시 읽기, owner only)
// Depends on auth.js, ui.js (TypoemUI).

requireLogin();

(function () {
  'use strict';

  var UI = window.TypoemUI;
  var esc = UI.esc;
  var q = new URLSearchParams(window.location.search);
  var ROOM_ID = q.get('room') || q.get('id');
  var tab = q.get('tab') === 'book' ? 'book' : 'poem';
  var me = getCurrentUser() || {};
  var room = null;                 // { id, name, owner_id }
  var loaded = { poem: false, book: false };
  var books = [];
  var rereadBook = null;

  function $(id) { return document.getElementById(id); }
  function enc(v) { return encodeURIComponent(v); }

  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
    'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  function icon(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
  }
  var ICON_PEOPLE = icon('<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>');
  var ICON_NEXT = icon('<path d="M9 6l6 6-6 6"/>');

  // "YYYY-MM-DD" -> parts, with the weekday in Seoul (noon UTC is the same day there)
  function dayParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    return { y: +m[1], mo: +m[2], d: +m[3], dow: DAYS[d.getUTCDay()] };
  }
  function shortDate(iso) {
    var p = dayParts(iso);
    return p ? p.mo + '/' + String(p.d).padStart(2, '0') : '';
  }

  // ---------- 시 ----------
  function poemRow(r) {
    var p = dayParts(r.date);
    var n = r.contributor_count || 0;
    return '<a class="hist-row" href="/room.html?id=' + enc(ROOM_ID) + '&date=' + enc(r.date) + '">' +
        '<span class="hist-date">' + (p ? p.mo + '/' + String(p.d).padStart(2, '0') + '<br>' + p.dow : '') + '</span>' +
        '<span class="hist-main"><b class="hist-name">' + UI.poemTitleHtml(r.title || 'Untitled') + '</b>' +
          '<small>' + UI.poemTitleHtml(r.author || '') + '</small></span>' +
        '<span class="hist-meta" aria-label="' + (n ? n + '명이 메모를 남겼어요' : '메모 없음') + '">' +
          (n ? ICON_PEOPLE + '<span>' + n + '</span>' : '') + '</span>' +
      '</a>';
  }

  async function loadPoems() {
    var list = $('poem-list');
    list.innerHTML = '<p class="s-note">불러오는 중이에요…</p>';
    var res = null;
    try { res = await authFetch('/api/rooms/' + enc(ROOM_ID) + '/history'); } catch (e) { /* below */ }
    if (!res || !res.ok) {
      list.innerHTML = '<p class="s-note">지난 시를 불러오지 못했어요.</p>';
      return;
    }
    loaded.poem = true;
    // history includes today's poem; "today" is the Korean calendar date (en-CA = YYYY-MM-DD)
    var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    var past = ((await res.json()).history || []).filter(function (r) { return r.date !== today; });
    if (!past.length) {
      list.innerHTML = '<p class="s-note">아직 지난 시가 없어요. 내일부터 여기에 쌓여요.</p>';
      return;
    }
    var html = '', month = '';
    past.forEach(function (r) {
      var p = dayParts(r.date);
      var key = p ? p.y + '-' + p.mo : '';
      if (key !== month) {
        month = key;
        var count = past.filter(function (x) { var q2 = dayParts(x.date); return q2 && q2.y + '-' + q2.mo === key; }).length;
        html += '<h2 class="hist-month"><span>' + (p ? MONTHS[p.mo - 1] : '') + '</span><span>' + count + '편</span></h2>';
      }
      html += poemRow(r);
    });
    list.innerHTML = html;
  }

  // ---------- 소설 ----------
  var STATUS = { reading: '읽는 중', finished: '완독', paused: '' };

  function avatars(readers) {
    return '<span class="hist-avs">' + readers.slice(0, 4).map(function (r) { return UI.avatar(r.nickname); }).join('') + '</span>';
  }

  function bookRow(b, i) {
    var isOwner = room && room.owner_id === me.id;
    var chip = b.status === 'paused'
      ? '<span class="hist-chip is-paused">' + b.progress + '%에서 멈춤</span>'
      : '<span class="hist-chip is-' + b.status + '">' + STATUS[b.status] + '</span>';
    var when = b.status === 'finished' && b.finished_at ? shortDate(b.finished_at) + '에 끝까지 읽음'
      : b.is_current ? '' : (b.last_read_at ? shortDate(b.last_read_at) + '에 마지막으로 읽음' : '아직 안 열어 봤어요');
    var reading = b.readers.filter(function (r) { return !r.finished; }).length;
    var done = b.readers.length - reading;
    var who = b.readers.length
      ? avatars(b.readers) + '<span>' + (done ? done + '명 완독' : '') + (done && reading ? ' · ' : '') + (reading ? reading + (b.is_current ? '명 읽는 중' : '명 읽다 멈춤') : '') + '</span>'
      : '';

    var cover = '<span class="hist-cover" style="background-color:' + UI.coverColor(b.book_id) + '" aria-hidden="true"></span>';
    var body =
      '<span class="hist-main">' +
        '<span class="hist-line"><b class="hist-name">' + esc(b.title) + '</b>' + chip + '</span>' +
        '<small>' + esc(b.author || '') + (when ? ' · ' + esc(when) : '') + '</small>' +
        (b.status !== 'finished'
          ? '<span class="hist-progress"><span class="bar"><i style="width:' + b.progress + '%"></i></span><span>' + b.progress + '%</span></span>'
          : '') +
        (who ? '<span class="hist-who">' + who + '</span>' : '') +
        (b.my_mark_count ? '<small class="hist-marks">내 형광펜 · 주석 ' + b.my_mark_count + '</small>' : '') +
        (!b.is_current && isOwner
          ? '<button type="button" class="btn-sm hist-reread" data-i="' + i + '">이 책으로 다시 읽기</button>'
          : '') +
      '</span>';

    return b.is_current
      ? '<a class="hist-row hist-book" href="/book.html?id=' + enc(ROOM_ID) + '">' + cover + body + '<span class="hist-go">' + ICON_NEXT + '</span></a>'
      : '<article class="hist-row hist-book">' + cover + body + '</article>';
  }

  async function loadBooks() {
    var list = $('book-list');
    list.innerHTML = '<p class="s-note">불러오는 중이에요…</p>';
    var res = null;
    try { res = await authFetch('/api/rooms/' + enc(ROOM_ID) + '/books/history'); } catch (e) { /* below */ }
    if (!res || !res.ok) {
      list.innerHTML = '<p class="s-note">읽은 책을 불러오지 못했어요.</p>';
      return;
    }
    loaded.book = true;
    books = await res.json();
    if (!Array.isArray(books) || !books.length) {
      list.innerHTML = '<p class="s-note">아직 이 방에서 고른 책이 없어요.</p>';
      return;
    }
    renderBooks();
  }

  function renderBooks() {
    $('book-list').innerHTML = '<h2 class="hist-month is-ko"><span>이 방에서 읽은 책</span><span>' + books.length + '권</span></h2>' +
      books.map(bookRow).join('');
  }

  // 이 책으로 다시 읽기
  $('book-list').addEventListener('click', function (e) {
    var btn = e.target.closest('.hist-reread');
    if (!btn) return;
    rereadBook = books[+btn.dataset.i];
    if (!rereadBook) return;
    var cur = books.find(function (b) { return b.is_current; });
    $('reread-title').textContent = rereadBook.title + '으로 다시 읽을까요?';
    $('reread-note').textContent = '방 전체가 이 책으로 바뀌어요. 각자 읽던 데서 이어 읽어요.' +
      (cur ? ' 지금 읽던 ' + cur.title + '도 위치가 그대로 남아요.' : '');
    UI.openSheet('sheet-reread', { anchor: btn });
  });
  $('reread-cancel').addEventListener('click', function () { UI.closeSheets(); });
  $('reread-ok').addEventListener('click', async function () {
    if (!rereadBook) return;
    var ok = $('reread-ok');
    ok.disabled = true;
    var res = null;
    try {
      res = await authFetch('/api/rooms/' + enc(ROOM_ID) + '/book', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gutenbergId: rereadBook.book_id }),
      });
    } catch (e) { /* below */ }
    ok.disabled = false;
    if (!res || !res.ok) {
      UI.toast(res && res.status === 403 ? '책은 방장만 바꿀 수 있어요.' : '책을 바꾸지 못했어요. 다시 시도해 주세요.');
      return;
    }
    window.location.href = '/book.html?id=' + enc(ROOM_ID);
  });

  // ---------- 탭 ----------
  function show(next) {
    tab = next;
    document.querySelectorAll('.hist-tabs button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    });
    $('poem-list').hidden = tab !== 'poem';
    $('book-list').hidden = tab !== 'book';
    var u = new URL(window.location.href);
    u.searchParams.set('tab', tab);
    history.replaceState(null, '', u);
    if (tab === 'poem' && !loaded.poem) loadPoems();
    if (tab === 'book' && !loaded.book) loadBooks();
  }
  document.querySelectorAll('.hist-tabs button').forEach(function (b) {
    b.addEventListener('click', function () { if (b.dataset.tab !== tab) { UI.haptic(); show(b.dataset.tab); } });
  });

  // ---------- 시작 ----------
  async function loadRoom() {
    var res = null;
    try { res = await authFetch('/api/rooms/mine'); } catch (e) { return; }
    if (!res || !res.ok) return;
    var rooms = await res.json();
    room = (Array.isArray(rooms) ? rooms : []).find(function (r) { return String(r.id) === String(ROOM_ID); }) || null;
    if (room) $('hist-room').textContent = room.name;
    if (loaded.book && books.length) renderBooks();   // the 다시 읽기 button needs the owner
  }

  if (!ROOM_ID) {
    $('status').textContent = '방을 찾지 못했어요.';
    return;
  }
  $('hist-back').href = '/room.html?id=' + enc(ROOM_ID);
  window.TypoemNav && window.TypoemNav.setBackHandler && window.TypoemNav.setBackHandler(function () {
    window.location.href = '/room.html?id=' + enc(ROOM_ID);
    return true;
  });
  loadRoom();
  show(tab);
})();
