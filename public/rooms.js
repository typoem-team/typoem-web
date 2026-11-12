// public/rooms.js
// 방 탭 — every room I'm in, as cards (room name large; today's poem and the book small).
// The room opened last comes first. A card goes straight to that room's 시 tab.
//
// Data: GET /api/rooms/mine -> [{ id, name, member_count, today_poem_title, book_title, book_progress }]
// Depends on auth.js, ui.js (TypoemUI). The home (index.html) loads this file too.

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

  const list = Array.isArray(rooms) ? rooms : [];   // the server sends them last opened first
  if ($('rooms-count')) $('rooms-count').textContent = list.length ? `${list.length}개` : '';   // the home has no count
  $('empty-state').hidden = list.length > 0;
  $('rooms-list').innerHTML = list.map((r, i) => UI.roomCard(r, i === 0 && !!r.last_opened_at)).join('');
}

loadRooms();
