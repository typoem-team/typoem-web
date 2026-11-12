// public/me.js
// 나 탭 — my streak (streak.js; its look is step 8), my friends' streaks per room,
// a place for badges (step 16), and the account links (privacy policy, log out).
//
// Data: GET /api/rooms/mine              -> [{ id, name, ... }]
//       GET /api/rooms/:id/streaks       -> { date, members: [{ id, username, nickname, current, longest, checkedInToday }] }
// Depends on auth.js, ui.js (TypoemUI), streak.js (TypoemStreak).

requireLogin();

const UI = window.TypoemUI;
const esc = UI.esc;
const $ = (id) => document.getElementById(id);
const me = getCurrentUser();

// textContent: nickname / username are user input
$('me-nick').textContent = (me && me.nickname) || '나';
$('me-username').textContent = me && me.username ? '@' + me.username : '';
$('logout-btn').addEventListener('click', () => logout());

function friendRow(m) {
  const name = m.nickname || m.username || '';
  const tags = [m.current > 0 ? `${m.current}일 연속` : '아직 기록 없음'];
  if (m.checkedInToday) tags.push('오늘 읽음');
  if (me && m.id === me.id) tags.unshift('나');
  return `<div class="mem-row">${UI.avatar(name)}${esc(name)}<span>${tags.join(' · ')}</span></div>`;
}

async function loadFriends() {
  const status = $('status');
  status.textContent = '친구 기록을 불러오는 중이에요…';
  let rooms;
  try {
    const res = await authFetch('/api/rooms/mine');
    if (!res.ok) { status.textContent = '친구 기록을 불러오지 못했어요.'; return; }
    // only rooms with someone besides me
    rooms = (await res.json()).filter((r) => r.member_count > 1);
  } catch (err) {
    status.textContent = '네트워크 오류가 났어요. 다시 시도해 주세요.';
    return;
  }
  if (!rooms.length) {
    status.textContent = '친구와 같은 방에 들어가면 서로의 기록이 여기 보여요.';
    return;
  }
  // shortcut: one request per room; add a single "all my rooms" endpoint if people join many rooms
  const lists = await Promise.all(rooms.map((r) =>
    authFetch(`/api/rooms/${encodeURIComponent(r.id)}/streaks`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)));
  status.textContent = '';
  $('friends').innerHTML = rooms.map((r, i) => {
    const members = lists[i] ? lists[i].members : null;
    return `<section class="me-box" aria-label="${esc(r.name)}">
        <p class="me-room">${esc(r.name)}</p>
        ${members ? members.map(friendRow).join('') : '<p class="s-note">이 방의 기록을 불러오지 못했어요.</p>'}
      </section>`;
  }).join('');
}

TypoemStreak.load();   // hides itself on 404
loadFriends();
