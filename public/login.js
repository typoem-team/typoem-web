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
    showError('Please enter your username and password.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in...';

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
      throw await authErrorFromResponse(res, 'Login failed. Please try again.');
    }

    const data = await res.json();
    saveAuth(data.token, data.user);
    window.location.href = '/index.html';

  } catch (err) {
    console.error('Login error:', err);
    showError(authErrorMessage(err));
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log In';
  }
});


function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}