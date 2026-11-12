// public/auth.js
// Shared authentication helpers for all Typoem pages.

// ============ Storage keys ============
const TOKEN_KEY = 'typoem_token';
const USER_KEY = 'typoem_user';


// ============ Token storage ============

// Save JWT and user info after successful login
function saveAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// Get current JWT token, or null if not logged in
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

// Get current user object, or null
function getCurrentUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// Clear all auth state (logout)
function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}


// ============ Auth guards ============

// Returns true if a token is present
function isLoggedIn() {
  if (getToken()) {
    return true;
  }
  return false;
}

// Redirect to login if not authenticated.
// Call at the top of every protected page (room list, room detail, etc).
function requireLogin() {
  if (!isLoggedIn()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

// If already logged in, redirect to home.
// Call on login.html and register.html.
function redirectIfLoggedIn() {
  if (isLoggedIn()) {
    window.location.href = '/index.html';
  }
}


// ============ Authenticated fetch ============

// fetch() wrapper that automatically adds the Authorization header.
// On 401, clears auth state and redirects to login.
async function authFetch(url, options) {
  const token = getToken();

  // Build headers with Authorization
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // Merge in any custom headers from caller
  if (options && options.headers) {
    for (const key in options.headers) {
      headers[key] = options.headers[key];
    }
  }

  // Build final options
  const finalOptions = {
    method: 'GET',
    headers: headers
  };
  if (options) {
    if (options.method) finalOptions.method = options.method;
    if (options.body) finalOptions.body = options.body;
  }

  const response = await fetch(url, finalOptions);

  // Token expired or invalid → log out and redirect
  if (response.status === 401) {
    clearAuth();
    window.location.href = '/login.html';
    return response;
  }

  return response;
}


// ============ Login / register error messages ============
// These turn a failed login/register request into a Korean message the user can
// act on, instead of the browser's "Failed to fetch" or the API's English
// messages ("Invalid credentials"). The forms check the input rules themselves
// first, so the API's own 400 text is never needed here.

// Error for a response that came back but wasn't ok.
async function authErrorFromResponse(res, fallback) {
  // Only the status matters; the body may not even be JSON (a proxy error page).
  let message;
  if (res.status === 401) message = '아이디 또는 비밀번호가 맞지 않아요.';
  else if (res.status === 409) message = '이미 쓰고 있는 아이디예요.';
  else if (res.status >= 500) message = '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
  else message = fallback;
  const err = new Error(message);
  err.isUserMessage = true;
  return err;
}

// Message for anything caught around a login/register request. fetch() only
// rejects with a TypeError when no answer came back at all (offline, server down).
function authErrorMessage(err) {
  if (err && err.isUserMessage) return err.message;
  if (err instanceof TypeError) return '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  return '문제가 생겼어요. 다시 시도해 주세요.';
}


// ============ Logout ============

function logout() {
  clearAuth();
  window.location.href = '/login.html';
}