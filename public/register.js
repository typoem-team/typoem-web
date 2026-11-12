// public/register.js
// Handles the registration form: client-side validation + API call.

// If already logged in, skip this page
redirectIfLoggedIn();

const form = document.getElementById('registerForm');
const errorBox = document.getElementById('errorBox');
const submitBtn = document.getElementById('submitBtn');

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  hideError();

  const username = document.getElementById('username').value.trim();
  const nickname = document.getElementById('nickname').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  // ============ Client-side validation ============
  // Mirrors the server-side rules in authController.js

  if (!username || !nickname || !password || !confirmPassword) {
    showError('모든 칸을 채워 주세요.');
    return;
  }

  if (username.length < 3 || username.length > 20) {
    showError('아이디는 3~20자로 정해 주세요.');
    return;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showError('아이디에는 영문, 숫자, 밑줄(_)만 쓸 수 있어요.');
    return;
  }

  if (nickname.length < 2 || nickname.length > 20) {
    showError('닉네임은 2~20자로 정해 주세요.');
    return;
  }

  if (/\s/.test(nickname)) {
    showError('닉네임에는 띄어쓰기를 쓸 수 없어요.');
    return;
  }

  if (password.length < 8 || password.length > 100) {
    showError('비밀번호는 8~100자로 정해 주세요.');
    return;
  }

  if (/\s/.test(password)) {
    showError('비밀번호에는 띄어쓰기를 쓸 수 없어요.');
    return;
  }

  if (password !== confirmPassword) {
    showError('비밀번호가 서로 달라요.');
    return;
  }

  // ============ API call ============
  submitBtn.disabled = true;
  submitBtn.textContent = '가입하는 중…';

  try {
    // Step 1: register
    const registerRes = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username,
        nickname: nickname,
        password: password
      })
    });

    if (!registerRes.ok) {
      throw await authErrorFromResponse(registerRes, '가입하지 못했어요. 다시 시도해 주세요.');
    }

    // Step 2: auto-login to get token (register API does not return one)
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username,
        password: password
      })
    });

    if (!loginRes.ok) {
      // Edge case: account created but auto-login failed.
      // Send the user to the login page to try manually.
      window.location.href = '/login.html';
      return;
    }

    const data = await loginRes.json();
    saveAuth(data.token, data.user);
    window.location.href = '/index.html';

  } catch (err) {
    console.error('Register error:', err);
    showError(authErrorMessage(err));
    submitBtn.disabled = false;
    submitBtn.textContent = '가입하기';
  }
});


function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}