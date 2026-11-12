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
// The login and register screens are in English. These turn a failed request into
// a message the user can act on, instead of the browser's "Failed to fetch" or the
// API's raw messages ("Invalid credentials").

// Error for a response that came back but wasn't ok.
async function authErrorFromResponse(res, fallback) {
  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON, e.g. a proxy error page */ }
  let message;
  if (res.status === 401) message = 'Wrong username or password.';
  else if (res.status === 409) message = 'That username is already taken.';
  else if (res.status >= 500) message = 'Something went wrong on our side. Please try again.';
  else if (data.error) message = data.error.charAt(0).toUpperCase() + data.error.slice(1) + '.';
  else message = fallback;
  const err = new Error(message);
  err.isUserMessage = true;
  return err;
}

// Message for anything caught around a login/register request. fetch() only
// rejects with a TypeError when no answer came back at all (offline, server down).
function authErrorMessage(err) {
  if (err && err.isUserMessage) return err.message;
  if (err instanceof TypeError) return "Can't reach the server. Check your connection and try again.";
  return 'Something went wrong. Please try again.';
}


// ============ Logout ============

function logout() {
  clearAuth();
  window.location.href = '/login.html';
}