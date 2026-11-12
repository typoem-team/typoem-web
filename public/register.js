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
    showError('Please fill in all fields.');
    return;
  }

  if (username.length < 3 || username.length > 20) {
    showError('Username must be 3-20 characters.');
    return;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showError('Username can only contain letters, numbers, and underscores.');
    return;
  }

  if (nickname.length < 2 || nickname.length > 20) {
    showError('Nickname must be 2-20 characters.');
    return;
  }

  if (/\s/.test(nickname)) {
    showError('Nickname cannot contain spaces.');
    return;
  }

  if (password.length < 8 || password.length > 100) {
    showError('Password must be 8-100 characters.');
    return;
  }

  if (/\s/.test(password)) {
    showError('Password cannot contain spaces.');
    return;
  }

  if (password !== confirmPassword) {
    showError('Passwords do not match.');
    return;
  }

  // ============ API call ============
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account...';

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
      throw await authErrorFromResponse(registerRes, 'Registration failed. Please try again.');
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
    submitBtn.textContent = 'Create Account';
  }
});


function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}