// public/settings.js
// 설정 — change my nickname, privacy policy, log out, delete my account.
//
// Data: PATCH  /api/users/me  { nickname }  -> { id, username, nickname }
//       DELETE /api/users/me  { password }  -> 204 (403: wrong password)
// Depends on auth.js (authFetch, getCurrentUser, saveAuth, getToken, logout, clearAuth), ui.js (TypoemUI).

requireLogin();

const UI = window.TypoemUI;
const $ = (id) => document.getElementById(id);
const me = getCurrentUser() || {};

$('nick-input').value = me.nickname || '';
$('nick-id').textContent = me.username ? `아이디 @${me.username}은 바뀌지 않아요` : '';
$('logout-btn').addEventListener('click', () => logout());

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
