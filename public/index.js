// public/index.js
// Room list page — loads the rooms the current user belongs to.

// Guard: redirect to login if there is no token
requireLogin();

// The date line, tab bar and log out live in ui.js.

// ---- Escape user-provided text before inserting into HTML (XSS guard) ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ---- Build one room card ----
function roomCard(room) {
  const desc = room.description
    ? `<p class="room-desc">${escapeHtml(room.description)}</p>`
    : '';
  return `
    <article class="room-card">
      <h2 class="room-name">${escapeHtml(room.name)}</h2>
      ${desc}
      <p class="room-meta">멤버 ${escapeHtml(room.member_count)}명</p>
      <a href="/room.html?id=${encodeURIComponent(room.id)}" class="btn btn-enter">들어가기</a>
    </article>
  `;
}

// ---- Load rooms from the API ----
async function loadRooms() {
  const status = document.getElementById('status');
  const grid = document.getElementById('rooms-grid');
  const empty = document.getElementById('empty-state');

  status.textContent = '방을 불러오는 중이에요…';

  try {
    const res = await authFetch('/api/rooms/mine');

    // authFetch already handles 401 (logout + redirect); handle the rest here
    if (!res.ok) {
      status.textContent = '방을 불러오지 못했어요.';
      return;
    }

    const rooms = await res.json();
    status.textContent = '';

    if (!Array.isArray(rooms) || rooms.length === 0) {
      empty.hidden = false;
      return;
    }

    grid.innerHTML = rooms.map(roomCard).join('');
  } catch (err) {
    console.error(err);
    status.textContent = '네트워크 오류가 났어요. 다시 시도해 주세요.';
  }
}

loadRooms();