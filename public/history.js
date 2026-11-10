// public/history.js
// Poem history — every daily poem this room has read, newest first.
// Data source: GET /api/rooms/:id/history  ({ room, history: [...] })
// Each history row: { date, poem_id, title, author, contributor_count, contributors }
//   contributors is a comma-separated nickname string (or null if no one
//   left a memo or annotation on that poem).

// ---- Guard: redirect to login if there is no token ----
requireLogin();

// ---- Read room id from the query string (?id=...) ----
const params = new URLSearchParams(window.location.search);
const ROOM_ID = params.get('id');

// The date line, tab bar and log out live in ui.js.

// "Back to room" returns to this room's poem screen (same id).
if (ROOM_ID) {
  document.getElementById('back-to-room').href = `/room.html?id=${ROOM_ID}`;
}

// ---- Escape user-provided text before inserting into HTML (XSS guard) ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// =====================================================================
//  Initial load
// =====================================================================
async function loadHistory() {
  const status = document.getElementById('status');

  if (!ROOM_ID) {
    status.textContent = '방을 찾지 못했어요.';
    return;
  }

  status.textContent = '지난 시를 불러오는 중이에요\u2026';

  const res = await authFetch(`/api/rooms/${ROOM_ID}/history`);

  // authFetch already handles 401 (logout + redirect); handle the rest here
  if (!res.ok) {
    status.textContent = res.status === 403 ? '이 방의 멤버가 아니에요.' : '지난 시를 불러오지 못했어요.';
    return;
  }

  const data = await res.json();
  status.textContent = '';

  // Room name in the headline
  if (data.room && data.room.name) {
    document.getElementById('room-name').textContent = data.room.name;
  }

  renderHistory(data.history || []);
}

// =====================================================================
//  Rendering
// =====================================================================
function renderHistory(rows) {
  const listEl = document.getElementById('history-list');
  const emptyEl = document.getElementById('history-empty');

  if (!Array.isArray(rows) || rows.length === 0) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = rows.map(historyRow).join('');
}

// One day's poem as a single-line card: [ date ] [ title / author ] [ contributors ]
function historyRow(row) {
  // row.date is 'YYYY-MM-DD' -> "11/10 Tue"
  const date = escapeHtml(TypoemUI.formatIsoDay(row.date || ''));
  // PoetryDB writes an em dash as "--" (same rule as room.js)
  const title = escapeHtml(row.title || 'Untitled').replace(/-{2,}/g, '\u2014');
  const author = escapeHtml(row.author || '');
  return `
    <article class="history-row">
      <span class="history-date">${date}</span>
      <span class="history-poem">
        <span class="history-title">${title}</span>
        <span class="history-author">${author}</span>
      </span>
      <span class="history-contrib">${contributorLabel(row)}</span>
    </article>
  `;
}

// Contributors: list every nickname, then the count.
//   "소연, 경윤, 시현 · 3명 참여"
//   "메모 없음"                  (no memos or annotations on this poem)
function contributorLabel(row) {
  const count = row.contributor_count || 0;
  if (count === 0 || !row.contributors) {
    return '<span class="history-none">메모 없음</span>';
  }
  // contributors is a comma-separated nickname string from the backend.
  const names = row.contributors
    .split(',')
    .map((n) => escapeHtml(n.trim()))
    .join(', ');
  return `<span class="history-names">${names}</span> &middot; ${count}명 참여`;
}

// =====================================================================
//  Wiring
// =====================================================================
loadHistory();