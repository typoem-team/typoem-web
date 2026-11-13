// public/rooms.js
// 방 탭 (Rooms) — every room I'm in, as cards (room name large; today's poem and the book small).
// The room opened last comes first (= the room the home shows, marked '지금 방').
// Tapping a card picks that room for the home (POST /api/rooms/:id/open) and goes home (안 2, 11/13).
//
// Data: GET /api/rooms/mine -> [{ id, name, member_count, today_poem_title, book_title, book_progress }]
// Depends on auth.js, ui.js (TypoemUI).

requireLogin();

const UI = window.TypoemUI;
const $ = (id) => document.getElementById(id);

async function loadRooms() {
  const status = $('status');
  status.textContent = '방을 불러오는 중이에요…';

  let res;
  try {
    res = await authFetch('/api/rooms/mine');
  } catch (err) {
    status.textContent = '네트워크 오류가 났어요. 다시 시도해 주세요.';
    return;
  }
  // authFetch already handles 401 (logout + redirect)
  if (!res.ok) {
    status.textContent = '방을 불러오지 못했어요.';
    return;
  }
  const rooms = await res.json();
  status.textContent = '';

  // The server sends them last opened first: the first one is the room the home shows.
  // The 방 tab keeps them in the order they were made (room id) and marks that room instead,
  // so picking a room doesn't shuffle the list.
  const all = Array.isArray(rooms) ? rooms : [];
  const homeId = all.length ? all[0].id : null;   // the home shows the first one
  const list = all.slice().sort((a, b) => a.id - b.id);
  $('rooms-count').textContent = list.length ? `${list.length}개` : '';
  $('empty-state').hidden = list.length > 0;
  $('rooms-list').innerHTML = list.map((r) => UI.roomCard(r, r.id === homeId)).join('');
}

loadRooms();

// A card picks the home's room. The link (room.html) stays as the fallback without JS.
$('rooms-list').addEventListener('click', async (e) => {
  const card = e.target.closest('.room-card[data-room-id]');
  if (!card || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const id = card.dataset.roomId;
  UI.haptic();
  card.setAttribute('aria-busy', 'true');
  try {
    await authFetch(`/api/rooms/${encodeURIComponent(id)}/open`, { method: 'POST' });
  } catch (err) { /* the home still opens this room from ?room= */ }
  window.location.href = `/index.html?room=${encodeURIComponent(id)}`;
});
