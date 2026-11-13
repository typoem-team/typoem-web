// public/room.js
// Reading screen — today's poem for one room.
//   - cover-colour band with title / author, date line under it
//   - a floating "메모 N" pill -> sheet with every memo (write · like · edit)
//   - highlights (4 colours) and notes on a word range (marks.js, same as the book):
//     long press / drag across words -> toolbar; a single tap on a marked word -> list
//   - opening today's poem checks me in for the streak (GET /today does it on the
//     server), so there is no "다 읽었어요" button
//
// Data source: GET /api/rooms/:id/today  (poem + memos + poem_marks in one payload; its
// `annotations` are the old line notes, copied into poem_marks and no longer shown)
// A past poem (?date=YYYY-MM-DD) comes from GET /api/rooms/:id/history/:date and
// is read-only: memos are shown, but nothing can be written, edited, deleted or liked.
// Poem marks on a past poem follow their API: shown and listed, no new ones
// (POST is today's poem only), but my own can still be edited / deleted
// (PATCH / DELETE /api/poem-marks/:id have no date rule).
// Depends on auth.js, ui.js (TypoemUI), marks.js (TypoemMarks).
// dict-popup.js handles taps on words.

requireLogin();

const UI = window.TypoemUI;
const esc = UI.esc;
const $ = (id) => document.getElementById(id);
const me = getCurrentUser();

// ---- Read room id from the query string (?id=...) ----
const params = new URLSearchParams(window.location.search);
const ROOM_ID = params.get('id');
// ?date=YYYY-MM-DD -> that day's poem, read-only
const PAST_DATE = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : null;
const READ_ONLY = !!PAST_DATE;

// =====================================================================
//  State
// =====================================================================
let poem = null;              // { id, title, author, lines: [{ id, line_number, text }] }
let poemDate = null;          // the server's date for this poem (YYYY-MM-DD)
let memos = [];               // full-poem memos, newest first
let poemMarks = [];           // highlights + notes on this poem (poem_marks), oldest first

window.TypoemNative.setStatusBar('light');   // light status bar text on the dark band

function setThemeColor(color) {
  const metaEl = document.querySelector('meta[name="theme-color"]');
  if (metaEl) metaEl.setAttribute('content', color);
}

// History (지난 시 · 읽은 책). A past poem goes back there instead of home.
const HISTORY_URL = `/history.html?room=${encodeURIComponent(ROOM_ID || '')}&tab=poem`;
if ($('past-link')) $('past-link').href = HISTORY_URL;

// Android back button: sheets are closed by ui.js first; then back to home
// (or to History when this is a past poem).
window.TypoemNav.setBackHandler(function () {
  if (marks.cancel()) return true;   // a word selection
  window.location.href = PAST_DATE ? HISTORY_URL : '/index.html';
  return true;
});

// =====================================================================
//  Load
// =====================================================================
async function loadToday() {
  const status = $('status');

  if (!ROOM_ID) {
    status.textContent = '방을 찾지 못했어요.';
    return;
  }

  const url = PAST_DATE
    ? `/api/rooms/${encodeURIComponent(ROOM_ID)}/history/${PAST_DATE}`
    : `/api/rooms/${encodeURIComponent(ROOM_ID)}/today`;
  let res;
  try {
    res = await authFetch(url);
  } catch (err) {
    status.textContent = '네트워크 오류가 났어요. 다시 시도해 주세요.';
    return;
  }

  // authFetch already handles 401 (logout + redirect); handle the rest here
  if (!res.ok) {
    status.textContent = loadErrorText(res.status);
    return;
  }

  const data = await res.json();
  if (!PAST_DATE) window.TypoemNative.sendTodayToWidget(data, ROOM_ID);   // home screen widget (after the check-in)
  showPoem(data);
}


function showPoem(data) {
  $('status').textContent = '';

  if (READ_ONLY) setReadOnly();

  poem = data.poem;
  poemDate = data.date;
  memos = data.memos || [];

  $('room-name').textContent = (data.room && data.room.name) || '';
  marks.reset();                 // new text: no selection, no marks until showMarks
  renderPoem();
  showMarks(data.poem_marks);
  renderPill();
  renderMemos();                 // the side panel (1024px+) shows the list straight away
  $('memo-pill').hidden = false;
  UI.anim($('r-body'), [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 520 });
  UI.anim($('memo-pill'), [{ opacity: 0, transform: 'translate(-50%, 14px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 380, delay: 300 })
    .finished.then(runTour);
}

// Coach marks, once (tour.js). Today's poem only: a past poem can't be written on.
function runTour() {
  if (READ_ONLY) return;
  const line = '#poem-body .ln:not(.ln-blank)';
  TypoemTour.run('room', [
    { el: line, text: '단어를 두 번 톡톡 누르면 뜻이 나와요. 마음에 드는 단어는 단어장에 담아요.' },
    { el: line, text: '단어를 길게 누르거나 여러 단어를 끌어서 고르면 형광펜을 칠하거나 주석을 달 수 있어요.' },
    { el: ['#memo-pill', '#r-side'], text: '이 시에 남긴 메모는 여기서 보고, 나도 남겨요.' },
    { el: '#past-link', text: '지난 시는 History에서 다시 볼 수 있어요.' },
  ]);
}

// A past poem: hide everything that writes, and say why where the forms were.
function setReadOnly() {
  document.body.classList.add('read-only');
  $('memo-form').hidden = true;
  const note = document.createElement('p');
  note.className = 's-note read-only-note';
  note.textContent = '지난 시는 읽기만 할 수 있어요.';
  $('memo-form').after(note);
}

// Korean message for a failed load (the API's own messages are English).
function loadErrorText(status) {
  if (status === 403) return '이 방의 멤버가 아니에요.';
  if (READ_ONLY) return status === 404 ? '그날의 시를 찾지 못했어요.' : '지난 시를 불러오지 못했어요.';
  if (status === 404) return '방을 찾지 못했어요.';
  if (status === 503) return '오늘의 시를 가져오지 못했어요. 잠시 뒤에 다시 열어 주세요.';
  return '오늘의 시를 불러오지 못했어요.';
}

// =====================================================================
//  Poem rendering
// =====================================================================
function hasContent(text) {
  return typeof text === 'string' && text.trim().length > 0;
}

function renderPoem() {
  const bodyEl = $('poem-body');
  if (!poem) {
    bodyEl.innerHTML = '';
    $('status').textContent = '시를 불러오지 못했어요.';
    return;
  }

  const color = UI.coverColor(poem.id);
  $('r-head').style.background = color;
  setThemeColor(color);
  $('poem-title').innerHTML = renderMeta(poem.title) || 'Untitled';
  $('poem-title').className = 'c-title' + UI.titleSize(poem.title);
  $('poem-author').innerHTML = renderMeta(poem.author);
  // The API has no publication year, so the line under the band is the date only.
  $('r-meta').textContent = UI.formatIsoDay(poemDate);

  const lines = Array.isArray(poem.lines) ? poem.lines : [];
  bodyEl.innerHTML = lines.map(renderLine).join('');
  // data-w = each word's 0-based position in its line (marks.js; poem_marks
  // start_word / end_word). DOM order = wrapWords' order = lib/poemWords.js.
  bodyEl.querySelectorAll('.ln[data-line-no]').forEach((ln) => {
    ln.querySelectorAll('.word').forEach((w, i) => { w.dataset.w = i; });
  });
}

// One poem line: [ text ]
//   - text          -> dictionary territory (words wrapped for dict-popup.js) and
//                      marks.js's unit (data-line-no = poem_marks start_line / end_line)
// Blank lines render as spacers (no words, so marks skip them).
function renderLine(line) {
  if (!hasContent(line.text)) {
    return '<span class="ln ln-blank" aria-hidden="true"></span>';
  }
  return `
    <span class="ln" data-line-id="${line.id}" data-line-no="${line.line_number}">
      <span class="tx">${wrapWords(line.text)}</span>
    </span>`;
}

// Title/author markup. Same PoetryDB markers as the body (em dash + italics)
// but WITHOUT the dictionary word-tokenising — title/author words aren't
// clickable. innerHTML, so esc runs first.
function renderMeta(text) {
  return esc(text || '')
    .replace(/-{2,}/g, '—')          // em dash (2+ hyphens)
    .replace(/_([^_]+)_/g, '<em>$1</em>'); // italics
}

// Render a poem line into clickable .word spans for the dictionary,
// while translating PoetryDB's plain-text markup:
//   _word_  -> <em>word</em>   (Project Gutenberg italics convention)
//   --      -> —               (em dash)
// Punctuation is split off the dictionary lookup so "And," looks up "and",
// while the line still DISPLAYS the punctuation verbatim.
// The split must stay the same as lib/poemWords.js on the server (poem_marks
// word positions; tests/unit/poemWords.test.js checks it).
function wrapWords(text) {
  let t = text.replace(/-{2,}/g, '—');   // 1) em dash (2+ hyphens), before tokenising

  // 2) Paired emphasis _..._ -> <em>...</em>. A lone/unmatched underscore is
  //    left as a literal character. Inner text is word-wrapped as usual, so
  //    the dictionary still works inside italics (<em><span class="word">…).
  let out = '';
  let last = 0;
  const re = /_([^_]+)_/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    out += wrapInline(t.slice(last, m.index));
    out += '<em>' + wrapInline(m[1]) + '</em>';
    last = re.lastIndex;
  }
  out += wrapInline(t.slice(last));
  return out;
}

// Wrap plain (already em-dash-normalised, no underscores) text. Splits on
// spaces AND em dashes so a word on either side of a dash stays independently
// clickable; the dash itself is rendered but not clickable.
function wrapInline(segment) {
  if (segment === '') return '';
  return segment.split(' ').map(function (spaceTok) {
    if (spaceTok === '') return '';
    return spaceTok.split(/(—)/).map(function (p) {
      if (p === '—') return '—';   // em dash: literal, not a .word
      return wrapWordChunk(p);
    }).join('');
  }).join(' ');
}

// Wrap a single chunk: strip leading/trailing punctuation off the lookup word
// (so the dictionary gets a clean term) but display the chunk verbatim.
// A chunk with no real word (pure punctuation) is emitted as escaped text.
function wrapWordChunk(chunk) {
  if (chunk === '') return '';
  const m = chunk.match(/^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9'’-]*)?([^A-Za-z0-9]*)$/);
  if (!m || !m[2]) return esc(chunk);
  const pre = m[1], core = m[2], post = m[3];
  const lookup = esc(core.toLowerCase());
  return esc(pre)
    + `<span class="word" data-word="${lookup}">${esc(core)}</span>`
    + esc(post);
}

// =====================================================================
//  Highlights + notes (marks.js does selection, toolbar, sheets, drawing)
// =====================================================================
// Units are the poem's lines (.ln with words); a position is [line_number, word].
// The poem id is taken when a selection starts, so a save can't land on another poem.

// failed response -> Error with a message for the toast
function marksError(res, fallback) {
  if (res.status === 403) return new Error('내가 남긴 것만 고칠 수 있어요.');
  // POST on a poem that is no longer today's (the day turned while this was open)
  if (res.status === 404) return new Error('오늘의 시에만 남길 수 있어요.');
  return new Error(fallback);
}

const marks = window.TypoemMarks.attach({
  container: $('poem-body'),
  unitSelector: '.ln[data-line-no]',
  unitKey: (ln) => Number(ln.dataset.lineNo),
  selectable: !READ_ONLY,          // a past poem: no new marks (POST is today's poem only)
  context: () => ({ poemId: poem && poem.id }),
  rangeOf: (m) => ({ start: [m.start_line, m.start_word], end: [m.end_line, m.end_word] }),
  async create(m) {
    const body = {
      kind: m.kind,
      startLine: m.start[0], startWord: m.start[1],
      endLine: m.end[0], endWord: m.end[1],
      quote: m.quote,
    };
    if (m.kind === 'highlight') body.color = m.color;   // required for highlights
    else body.content = m.content;
    const url = `/api/rooms/${encodeURIComponent(ROOM_ID)}/poems/${m.ctx.poemId}/marks`;
    const res = await authFetch(url, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw marksError(res, m.kind === 'note' ? '주석을 저장하지 못했어요.' : '형광펜을 저장하지 못했어요.');
    return res.json();
  },
  async update(row, content) {
    const res = await authFetch(`/api/poem-marks/${row.id}`, { method: 'PATCH', body: JSON.stringify({ content }) });
    if (!res.ok) throw marksError(res, '주석을 고치지 못했어요.');
    return res.json();
  },
  async remove(row) {
    const res = await authFetch(`/api/poem-marks/${row.id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw marksError(res, '지우지 못했어요.');   // 404: already gone
  },
  changed({ type, row }) {
    if (!poem || row.poem_id !== poem.id) return;
    let list = poemMarks.filter((m) => m.id !== row.id);
    if (type !== 'delete') list = list.concat(row);
    list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id));
    showMarks(list);
  },
});

function showMarks(list) {
  poemMarks = Array.isArray(list) ? list : [];
  marks.set(poemMarks);
}


// =====================================================================
//  Memo pill + memo sheet (every memo on this poem)
// =====================================================================
function renderPill() {
  const n = memos.length;
  // people who left something, most recent first, three at most
  const names = [];
  memos.slice()
    .sort(byNewest)
    .forEach((x) => { if (names.indexOf(x.author_nickname) < 0) names.push(x.author_nickname); });
  $('pill-avs').innerHTML = names.slice(0, 3).map(UI.avatar).join('');
  $('pill-label').textContent = n ? `메모 ${n}` : '메모 없음';
}

function byNewest(a, b) {
  return String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id;
}

// The sheet lists full-poem memos, newest first.
function renderMemos() {
  const items = memos.slice().sort(byNewest);

  $('m-count').textContent = items.length ? `${items.length}개` : '';
  $('memo-list').innerHTML = items.length
    ? items.map(memoItem).join('')
    : '<p class="s-note">아직 남긴 메모가 없어요.</p>';
}

function controls(id) {
  if (READ_ONLY) return '';
  return `<span class="note-controls">
      <button type="button" class="link-btn" data-edit data-id="${id}">고치기</button>
      <button type="button" class="link-btn" data-del data-id="${id}">지우기</button>
    </span>`;
}

function memoItem(memo) {
  const mine = me && memo.user_id === me.id;
  return `
    <div class="m-item" data-kind="memo" data-id="${memo.id}">
      ${UI.avatar(memo.author_nickname)}
      <div class="m-main">
        <b>${esc(memo.author_nickname)}<small>${formatDate(memo.created_at)}</small></b>
        <p class="note-content">${esc(memo.content)}</p>
        <div class="m-foot">
          <button type="button" class="like-btn${memo.liked_by_me ? ' liked' : ''}" data-like="${memo.id}"${READ_ONLY ? ' disabled' : ''}
                  aria-pressed="${memo.liked_by_me ? 'true' : 'false'}" aria-label="좋아요">
            <span class="like-heart" aria-hidden="true">${memo.liked_by_me ? '♥' : '♡'}</span>
            <span class="like-count">${memo.like_count || 0}</span>
          </button>
          ${mine ? controls(memo.id) : ''}
        </div>
      </div>
    </div>`;
}

$('memo-pill').addEventListener('click', () => {
  renderMemos();
  $('memo-input').value = '';
  UI.openSheet('sheet-memo');
  UI.haptic();
});

$('memo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('memo-input');
  const content = input.value.trim();
  if (content.length < 1 || content.length > 1000) {
    UI.toast('메모는 1~1000자로 써 주세요');
    return;
  }
  const btn = $('memo-submit');
  btn.disabled = true;
  try {
    const res = await authFetch(`/api/rooms/${encodeURIComponent(ROOM_ID)}/memos`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      UI.toast('메모를 남기지 못했어요');
      return;
    }
    input.value = '';
    await reloadMemos();
    UI.anim($('memo-list').firstElementChild, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 360 });
    UI.haptic();
  } catch (err) {
    UI.toast('네트워크 오류가 났어요. 다시 시도해 주세요');
  } finally {
    btn.disabled = false;
  }
});

// Refresh the memo list (after create/edit/delete).
async function reloadMemos() {
  const res = await authFetch(`/api/rooms/${encodeURIComponent(ROOM_ID)}/memos`);
  if (!res.ok) return;
  memos = await res.json();
  renderMemos();
  renderPill();
}

// Toggle a like. The backend returns the authoritative new state
// ({ liked, like_count }); update just this button rather than reloading the
// list, so the scroll position and any open editors are kept.
async function toggleLike(id) {
  const res = await authFetch(`/api/memos/${id}/like`, { method: 'POST' });
  if (!res.ok) return;
  const data = await res.json();
  const memo = memos.find((m) => m.id === id);
  if (memo) { memo.liked_by_me = data.liked; memo.like_count = data.like_count; }
  const btn = document.querySelector(`[data-like="${id}"]`);
  if (!btn) return;
  btn.classList.toggle('liked', data.liked);
  btn.setAttribute('aria-pressed', data.liked ? 'true' : 'false');
  btn.querySelector('.like-heart').textContent = data.liked ? '♥' : '♡';
  btn.querySelector('.like-count').textContent = data.like_count;
}

// =====================================================================
//  Inline edit / delete (memos)
// =====================================================================
function itemEl(id) {
  return $('memo-list').querySelector(`.m-item[data-id="${id}"]`);
}

function startInlineEdit(id) {
  const item = itemEl(id);
  if (!item) return;
  const contentEl = item.querySelector('.note-content');
  if (!contentEl || item.querySelector('.note-edit')) return;  // already editing
  closeInline(item);

  const editor = document.createElement('div');
  editor.className = 'note-edit';
  editor.innerHTML = `
    <textarea class="note-edit-input field" maxlength="1000" rows="3" aria-label="메모 고치기"></textarea>
    <div class="note-edit-actions">
      <button type="button" class="btn-sm note-edit-save">저장</button>
      <button type="button" class="btn-sm note-edit-cancel">취소</button>
    </div>
  `;
  const textarea = editor.querySelector('.note-edit-input');
  textarea.value = contentEl.textContent;

  contentEl.hidden = true;
  contentEl.insertAdjacentElement('afterend', editor);
  textarea.focus();

  function cancel() {
    editor.remove();
    contentEl.hidden = false;
  }
  editor.querySelector('.note-edit-cancel').addEventListener('click', cancel);

  // Esc cancels (without closing the sheet), Cmd/Ctrl+Enter saves
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      editor.querySelector('.note-edit-save').click();
    }
  });

  editor.querySelector('.note-edit-save').addEventListener('click', async () => {
    const trimmed = textarea.value.trim();
    if (trimmed.length < 1 || trimmed.length > 1000) {
      UI.toast('메모는 1~1000자로 써 주세요');
      return;
    }
    const res = await authFetch(`/api/memos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: trimmed }),
    });
    if (!res.ok) {
      UI.toast('메모를 고치지 못했어요');
      return;
    }
    await reloadMemos();
  });
}

function startInlineDelete(id) {
  const item = itemEl(id);
  if (!item) return;
  const contentEl = item.querySelector('.note-content');
  if (!contentEl || item.querySelector('.note-confirm')) return;  // already confirming
  closeInline(item);

  const box = document.createElement('div');
  box.className = 'note-confirm';
  box.innerHTML = `
    <span class="note-confirm-text">이 메모를 지울까요?</span>
    <span class="note-confirm-actions">
      <button type="button" class="btn-sm btn-danger note-confirm-yes">지우기</button>
      <button type="button" class="btn-sm note-confirm-no">취소</button>
    </span>
  `;
  contentEl.hidden = true;
  contentEl.insertAdjacentElement('afterend', box);

  box.querySelector('.note-confirm-no').addEventListener('click', () => {
    box.remove();
    contentEl.hidden = false;
  });
  box.querySelector('.note-confirm-yes').addEventListener('click', async () => {
    const res = await authFetch(`/api/memos/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      UI.toast('메모를 지우지 못했어요');
      return;
    }
    await reloadMemos();
  });
}

// Close an editor / confirm box that is already open on this item.
function closeInline(item) {
  item.querySelectorAll('.note-edit, .note-confirm').forEach((el) => el.remove());
  const contentEl = item.querySelector('.note-content');
  if (contentEl) contentEl.hidden = false;
}

// One listener for like / edit / delete (items are re-rendered often).
$('memo-list').addEventListener('click', (e) => {
  if (READ_ONLY) return;
  const like = e.target.closest('[data-like]');
  if (like) { toggleLike(Number(like.dataset.like)); return; }
  const edit = e.target.closest('[data-edit]');
  if (edit) { startInlineEdit(Number(edit.dataset.id)); return; }
  const del = e.target.closest('[data-del]');
  if (del) startInlineDelete(Number(del.dataset.id));
});

// =====================================================================
//  Helpers
// =====================================================================
// created_at looks like "2026-05-31 13:16:03" and is stored as UTC;
// mark it as UTC so the browser converts it to the viewer's time zone.
// Shown as "11/10 16:11".
function formatDate(created_at) {
  if (!created_at) return '';
  const d = new Date(created_at.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return esc(created_at.slice(0, 10));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

loadToday();
