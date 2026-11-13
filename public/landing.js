// public/landing.js
// Public landing (served at / by app.js). Logged-out visitors see one short poem;
// logged-in visitors are sent straight to their rooms list.

const statusEl = document.querySelector('#status');
const sheetEl = document.querySelector('.landing-poem');
const titleEl = document.querySelector('#poem-title');
const authorEl = document.querySelector('#poem-author');
const bodyEl = document.querySelector('#poem-body');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Translate PoetryDB's plain-text markup the same way P13 (room.js) does,
// minus the dictionary word-wrapping (the landing preview has no popup).
// Used for the poem body AND the title/author (markers can appear in either):
//   --      -> —  (em dash)
//   _word_  -> <em>word</em>  (Project Gutenberg italics)
// Text is escaped first so the markup can't inject HTML.
function formatLine(text) {
  let t = escapeHtml(text).replace(/-{2,}/g, '\u2014');   // em dash (2+ hyphens)
  t = t.replace(/_([^_]+)_/g, '<em>$1</em>');          // paired _italics_
  return t;
}

function renderLine(line) {
  const text = typeof line === 'string' ? line : '';
  if (text.trim().length === 0) {
    return '<div class="poem-line poem-line-blank"><span class="line-text">&nbsp;</span></div>';
  }
  return `<div class="poem-line"><span class="line-text">${formatLine(text)}</span></div>`;
}

async function loadPoem() {
  const res = await fetch('/api/public/poem');

  if (res.ok) {
    const data = await res.json();
    const poem = data.poem;
    const lines = Array.isArray(poem.lines) ? poem.lines : [];

    titleEl.innerHTML = formatLine(poem.title || '');
    authorEl.innerHTML = formatLine(poem.author || '');
    bodyEl.innerHTML = lines.map(renderLine).join('');

    statusEl.hidden = true;
    sheetEl.hidden = false;
  } else {
    statusEl.textContent = '오늘의 시를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}

function init() {
  if (isLoggedIn()) {
    window.location.replace('/index.html');   // existing rooms page (no rename)
    return;
  }
  document.body.hidden = false;   // confirmed logged out → reveal page
  loadPoem();
}

init();
