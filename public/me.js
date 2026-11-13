// public/me.js
// 나 탭 — my streak (streak.js; its look is step 8), my friends' streaks and book progress per room,
// my badges, and a link to 설정 (settings.html).
//
// Data: GET /api/rooms/mine              -> [{ id, name, ... }]
//       GET /api/rooms/:id/streaks       -> { date, members: [{ id, username, nickname, current, longest, checkedInToday }] }
//       GET /api/rooms/:id/books/history -> [{ title, is_current, readers: [{ id, progress, finished }] }]
//       GET /api/users/me/badges         -> { badges, earned_count }
// Depends on auth.js, ui.js (TypoemUI), streak.js (TypoemStreak).

requireLogin();

const UI = window.TypoemUI;
const esc = UI.esc;
const $ = (id) => document.getElementById(id);
const me = getCurrentUser();

// textContent: nickname / username are user input
function drawName() {
  const user = getCurrentUser();   // read again: 설정 may have changed the nickname
  $('me-nick').textContent = (user && user.nickname) || '나';
  $('me-username').textContent = user && user.username ? '@' + user.username : '';
}
drawName();

// book = the room's current book, or null when it has none
//        { title, progress: Map(user id -> { progress, finished }) }
function bookLine(m, book) {
  if (!book) return '';
  const p = book.progress.get(m.id) || { progress: 0, finished: false };
  const label = p.finished ? '다 읽음' : `${p.progress}%`;
  return `<div class="mf-book${p.finished ? ' is-done' : ''}" aria-label="책 ${label}">
      <div class="mf-bar"><div style="width:${p.progress}%"></div></div><b>${label}</b>
    </div>`;
}

function friendRow(m, book) {
  const name = m.nickname || m.username || '';
  const tags = [m.current > 0 ? `${m.current}일 연속` : '아직 기록 없음'];
  if (m.checkedInToday) tags.push('오늘 읽음');
  if (me && m.id === me.id) tags.unshift('나');
  return `<div class="mem-row">${UI.avatar(name)}<p class="mf-name">${esc(name)}</p>
      <div class="mf-side"><span>${tags.join(' · ')}</span>${bookLine(m, book)}</div>
    </div>`;
}

// /books/history -> the current book with each reader's progress (read-only: no check-in, no room order)
function currentBook(list) {
  const cur = Array.isArray(list) ? list.find((b) => b.is_current) : null;
  if (!cur) return null;
  return {
    title: cur.title,
    progress: new Map(cur.readers.map((r) => [r.id, { progress: r.progress, finished: r.finished }])),
  };
}

const getJson = (url) => authFetch(url)
  .then((res) => (res.ok ? res.json() : null))
  .catch(() => null);

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
  // shortcut: two requests per room; add a single "all my rooms" endpoint if people join many rooms
  const lists = await Promise.all(rooms.map((r) => {
    const base = `/api/rooms/${encodeURIComponent(r.id)}`;
    return Promise.all([getJson(`${base}/streaks`), getJson(`${base}/books/history`)]);
  }));
  status.textContent = '';
  $('friends').innerHTML = rooms.map((r, i) => {
    const [streaks, books] = lists[i];
    const members = streaks ? streaks.members : null;
    const book = currentBook(books);   // books failing only drops the book line
    return `<section class="me-box" aria-label="${esc(r.name)}">
        <p class="me-room">${esc(r.name)}</p>
        ${book ? `<p class="mf-title">같이 읽는 책 <b>${esc(book.title)}</b></p>` : ''}
        ${members ? members.map((m) => friendRow(m, book)).join('') : '<p class="s-note">이 방의 기록을 불러오지 못했어요.</p>'}
      </section>`;
  }).join('');
}

// ---- 배지: GET /api/users/me/badges -> { badges: [{ id, name, description, earned, progress, goal }], earned_count }
const BADGE_ICONS = {
  // flame: streaks
  streak: '<path d="M12 3c.5 3.2 4.5 5.4 4.5 10a4.5 4.5 0 0 1-9 0c0-2 1-3.4 2-4.4.2 1.6 1 2.6 2 2.9C11 9.3 11 6 12 3z"/>',
  // pen: memos
  memo: '<path d="M15.5 4.5l4 4L9 19H5v-4z"/><path d="M13 7l4 4"/>',
  // open book: finished a book
  book: '<path d="M12 6.5C10.3 5.2 7.8 4.6 4 4.6v13c3.8 0 6.3.6 8 1.9 1.7-1.3 4.2-1.9 8-1.9v-13c-3.8 0-6.3.6-8 1.9z"/><path d="M12 6.5v13"/>',
};

// "first" badges lead, then by how soon you can reach them; ids the server adds later go last
const BADGE_ORDER = ['first_memo', 'first_book', 'streak_3', 'streak_7', 'memo_10', 'streak_30'];
const badgeRank = (id) => {
  const i = BADGE_ORDER.indexOf(id);
  return i === -1 ? BADGE_ORDER.length : i;
};

function badgeKind(id) {
  if (id.startsWith('streak_')) return 'streak';
  if (id.startsWith('memo') || id === 'first_memo') return 'memo';
  return 'book';
}

function badgeItem(b) {
  const svg = `<svg viewBox="0 0 24 24" aria-hidden="true">${BADGE_ICONS[badgeKind(b.id)]}</svg>`;
  // earned: the look says it, so the words are for screen readers only
  const state = b.earned
    ? '<span class="badge-sr">받았어요</span>'
    : `<span class="badge-state">${b.progress} / ${b.goal}</span>`;
  return `<li class="badge${b.earned ? ' is-earned' : ''}">
      <span class="badge-ic">${svg}</span>
      <b class="badge-name">${esc(b.name)}</b>
      <span class="badge-desc">${esc(b.description)}</span>
      ${state}
    </li>`;
}

async function loadBadges() {
  try {
    const res = await authFetch('/api/users/me/badges');
    if (!res.ok) return;   // keep the section hidden
    const data = await res.json();
    const badges = [...data.badges].sort((a, b) => badgeRank(a.id) - badgeRank(b.id));
    $('badges').innerHTML = badges.map(badgeItem).join('');
    $('badges-count').textContent = `${data.earned_count} / ${data.badges.length}`;
    $('badges-box').hidden = false;
  } catch (err) {
    // network error: leave the section hidden
  }
}

TypoemStreak.load();   // hides itself on 404
loadFriends();
loadBadges();

// Back via the back/forward cache (e.g. from a room or 설정): streak, friends, badges and
// the nickname may have changed. Same as the home (index.js).
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  drawName();
  TypoemStreak.load();
  loadFriends();
  loadBadges();
});
