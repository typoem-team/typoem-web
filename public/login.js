// public/login.js
// Handles the login form.

// If already logged in, skip this page
redirectIfLoggedIn();

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('errorBox');
const submitBtn = document.getElementById('submitBtn');

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  hideError();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showError('아이디와 비밀번호를 입력해 주세요.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '로그인하는 중…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username,
        password: password
      })
    });

    if (!res.ok) {
      throw await authErrorFromResponse(res, '로그인하지 못했어요. 다시 시도해 주세요.');
    }

    const data = await res.json();
    saveAuth(data.token, data.user);
    window.location.href = '/index.html';

  } catch (err) {
    console.error('Login error:', err);
    showError(authErrorMessage(err));
    submitBtn.disabled = false;
    submitBtn.textContent = '로그인';
  }
});


function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}