// public/settings.js
// 설정 — my profile (top), change my nickname, privacy policy, log out, delete my account.
//
// Data: GET    /api/users/me  -> { id, username, nickname, created_at }   (profile: 함께한 날)
//       GET    /api/rooms/mine -> [{ id, name, ... }]                      (profile: 참여한 방)
//       PATCH  /api/users/me  { nickname }  -> { id, username, nickname }
//       DELETE /api/users/me  { password }  -> 204 (403: wrong password)
// Depends on auth.js (authFetch, getCurrentUser, saveAuth, getToken, logout, clearAuth), ui.js (TypoemUI).

requireLogin();

const UI = window.TypoemUI;
const $ = (id) => document.getElementById(id);
const me = getCurrentUser() || {};

$('nick-input').value = me.nickname || '';
$('nick-id').textContent = me.username ? `아이디(@${me.username})는 바꿀 수 없어요` : '';
$('logout-btn').addEventListener('click', () => logout());
$('tour-reset').addEventListener('click', () => {
  TypoemTour.reset();
  UI.toast('화면을 다시 열면 안내가 나와요');
});

// ---- Profile card: avatar · nickname · 함께한 날 · 참여한 방 ----
function showProfileName(nickname) {
  const name = nickname || me.username || '';
  $('prof-av').innerHTML = UI.avatar(name);   // UI.avatar escapes
  $('prof-nick').textContent = name;
}

// 'YYYY-MM-DD' of a moment in Korea (Typoem's calendar day, like lib/dates.js)
const seoulFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// created_at (UTC 'YYYY-MM-DD HH:MM:SS') -> "N일째": the sign-up day is day 1
function daysTogether(createdAt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(createdAt || '');
  if (!m) return null;
  const joined = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  const n = dayNumber(seoulFmt.format(new Date())) - dayNumber(seoulFmt.format(joined)) + 1;
  return Math.max(1, n);
}

async function loadProfile() {
  const getJson = (url) => authFetch(url).then((res) => (res.ok ? res.json() : null)).catch(() => null);
  const [user, rooms] = await Promise.all([getJson('/api/users/me'), getJson('/api/rooms/mine')]);
  if (user) {
    showProfileName(user.nickname);
    const days = daysTogether(user.created_at);
    if (days) $('prof-days').textContent = `${days}일째`;
  }
  if (Array.isArray(rooms)) $('prof-rooms').textContent = `${rooms.length}개`;
}

showProfileName(me.nickname);
loadProfile();

// ---- Nickname (same rules as the server: 2-20 characters, no whitespace) ----
$('nick-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nickname = $('nick-input').value.trim();
  if (/\s/.test(nickname)) { UI.toast('닉네임에는 띄어쓰기를 쓸 수 없어요'); return; }
  if (nickname.length < 2 || nickname.length > 20) { UI.toast('닉네임은 2–20자로 써 주세요'); return; }
  if (nickname === me.nickname) return;

  const btn = $('nick-save');
  btn.disabled = true;
  try {
    const res = await authFetch('/api/users/me', { method: 'PATCH', body: JSON.stringify({ nickname }) });
    if (!res.ok) { UI.toast('닉네임을 바꾸지 못했어요'); return; }
    const user = await res.json();
    // the tab bar and the 나 page read the nickname from the saved user
    saveAuth(getToken(), Object.assign({}, me, user));
    me.nickname = user.nickname;
    const nick = document.querySelector('.tab-me-nick');
    if (nick) nick.textContent = user.nickname;
    showProfileName(user.nickname);
    UI.toast('닉네임을 바꿨어요');
  } catch (err) {
    UI.toast('네트워크 오류가 났어요. 다시 시도해 주세요');
  } finally {
    btn.disabled = false;
  }
});

// ---- Delete my account ----
$('delete-open').addEventListener('click', () => {
  const form = $('delete-form');
  form.hidden = !form.hidden;
  $('delete-open').setAttribute('aria-expanded', String(!form.hidden));
  if (!form.hidden) $('delete-password').focus();
});

$('delete-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('delete-password').value;
  if (!password) { UI.toast('비밀번호를 입력해 주세요'); return; }

  const btn = $('delete-btn');
  btn.disabled = true;
  try {
    const res = await authFetch('/api/users/me', { method: 'DELETE', body: JSON.stringify({ password }) });
    if (res.status === 204) {
      clearAuth();
      window.location.href = '/landing.html';
      return;
    }
    UI.toast(res.status === 403 ? '비밀번호가 맞지 않아요' : '계정을 지우지 못했어요');
  } catch (err) {
    UI.toast('네트워크 오류가 났어요. 다시 시도해 주세요');
  } finally {
    btn.disabled = false;
  }
});
