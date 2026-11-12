// public/past.js
// "지난 시" at the bottom of the poem screen: a sheet with this room's past poems.
// A row opens that day's poem read-only (room.html?id=X&date=YYYY-MM-DD).
// shortcut: a stand-in until the History screen (history.html?room=X&tab=poem, step 9) exists;
// then make #past-link a link there and delete this file and #sheet-history.
//
// Data: GET /api/rooms/:id/history -> { history: [{ date, poem_id, title, author, contributors, contributor_count }] }
// Depends on auth.js (authFetch), ui.js (TypoemUI).

(function () {
  'use strict';

  var UI = window.TypoemUI;
  var esc = UI.esc;
  var roomId = new URLSearchParams(window.location.search).get('id');
  var link = document.getElementById('past-link');
  var list = document.getElementById('h-list');
  if (!roomId || !link) return;

  function row(r) {
    var names = r.contributors
      ? r.contributors.split(',').map(function (n) { return esc(n.trim()); }).join(', ')
      : '';
    var n = r.contributor_count || 0;
    return '<a class="h-row" href="/room.html?id=' + encodeURIComponent(roomId) + '&date=' + encodeURIComponent(r.date) + '">' +
        '<span class="sw" style="background:' + UI.coverColor(r.poem_id) + '"></span>' +
        '<span class="h-text"><b>' + UI.poemTitleHtml(r.title || 'Untitled') + '</b>' +
          '<small>' + UI.poemTitleHtml(r.author) + '</small>' +
          (names ? '<small class="h-names">' + names + '</small>' : '') + '</span>' +
        '<em>' + esc(UI.formatIsoDay(r.date)) + '<br>' + (n > 0 ? n + '명 참여' : '메모 없음') + '</em>' +
      '</a>';
  }

  link.addEventListener('click', async function () {
    UI.openSheet('sheet-history', { anchor: link });
    UI.haptic();
    document.getElementById('h-count').textContent = '';
    list.innerHTML = '<p class="s-note">불러오는 중이에요…</p>';

    var res = null;
    try { res = await authFetch('/api/rooms/' + encodeURIComponent(roomId) + '/history'); } catch (e) { /* below */ }
    if (!res || !res.ok) {
      list.innerHTML = '<p class="s-note">지난 시를 불러오지 못했어요.</p>';
      return;
    }
    // history includes today's poem; "today" is the Korean calendar date (en-CA = YYYY-MM-DD)
    var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    var past = ((await res.json()).history || []).filter(function (r) { return r.date !== today; });
    document.getElementById('h-count').textContent = past.length ? past.length + '편' : '';
    list.innerHTML = past.length ? past.map(row).join('') : '<p class="s-note">아직 지난 시가 없어요.</p>';
  });
})();
