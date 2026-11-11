// public/room.js
// Reading screen — today's poem for one room.
//   - cover-colour band with title / author, date line under it
//   - a floating "메모 N" pill -> sheet with every memo (write · like · edit)
//   - lines that have notes: dotted underline + a count on the right;
//     the count or the left margin of a line opens that line's sheet
//   - highlighter marks, kept on this device only (localStorage)
//   - "다 읽었어요" (only when the streak API exists)
//
// Data source: GET /api/rooms/:id/today  (poem + memos + annotations in one payload)
// Depends on auth.js, ui.js (TypoemUI), streak.js (TypoemStreak).
// dict-popup.js handles taps on words.

requireLogin();

const UI = window.TypoemUI;
const esc = UI.esc;
const $ = (id) => document.getElementById(id);
const me = getCurrentUser();

// The book section at the bottom of this file (feat/books) calls the helper by
// its old name.
function escapeHtml(str) {
  return esc(str);
}

// ---- Read room id from the query string (?id=...) ----
const params = new URLSearchParams(window.location.search);
const ROOM_ID = params.get('id');

// =====================================================================
//  State
// =====================================================================
let poem = null;              // { id, title, author, lines: [{ id, line_number, text }] }
let poemDate = null;          // the server's date for this poem (YYYY-MM-DD)
let memos = [];               // full-poem memos, newest first
let annotationsByLine = {};   // { line_id: [annotation, ...] }
let currentLineId = null;     // line whose sheet is open, or null
let marks = new Set();        // highlighted line ids (this device only)
let lineOpener = null;        // the button that opened the line view (focus goes back to it)

// =====================================================================
//  Opening: the home screen's cover has just grown into this band
// =====================================================================
// index.js leaves the tapped cover's colour and text in sessionStorage, so the
// band can be painted before the poem arrives and the two pages join up.
(function paintFromCover() {
  let hint = null;
  try {
    hint = JSON.parse(sessionStorage.getItem('typoem:open') || 'null');
    sessionStorage.removeItem('typoem:open');
  } catch (err) { /* no hint */ }

  if (hint && String(hint.roomId) === String(ROOM_ID)) {
    $('r-head').style.background = hint.color;
    $('poem-title').innerHTML = renderMeta(hint.title);
    $('poem-title').className = 'c-title' + UI.titleSize(hint.title);
    $('poem-author').innerHTML = renderMeta(hint.author);
    $('room-name').textContent = hint.roomName || '';
    setThemeColor(hint.color);
    UI.anim($('poem-title'), [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 80 });
  }
  window.TypoemNative.setStatusBar('light');   // light status bar text on the dark band
})();

function setThemeColor(color) {
  const metaEl = document.querySelector('meta[name="theme-color"]');
  if (metaEl) metaEl.setAttribute('content', color);
}

// Android back button: sheets are closed by ui.js first; then back to home.
window.TypoemNav.setBackHandler(function () {
  if (closeLineView()) return true;
  window.location.href = '/index.html';
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

  let res;
  try {
    res = await authFetch(`/api/rooms/${encodeURIComponent(ROOM_ID)}/today`);
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
  status.textContent = '';

  // Remember this room: the home screen opens the room you read in last.
  UI.setLastRoom(ROOM_ID);

  poem = data.poem;
  poemDate = data.date;
  memos = data.memos || [];
  indexAnnotations(data.annotations || []);
  loadMarks();

  $('room-name').textContent = (data.room && data.room.name) || '';
  renderPoem();
  renderPill();
  renderMemos();                 // the side panel (1024px+) shows the list straight away
  $('memo-pill').hidden = false;
  UI.anim($('r-body'), [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 520 });
  UI.anim($('memo-pill'), [{ opacity: 0, transform: 'translate(-50%, 14px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 380, delay: 300 });

  loadFinish();
}

// Korean message for a failed /today load (the API's own messages are English).
function loadErrorText(status) {
  if (status === 403) return '이 방의 멤버가 아니에요.';
  if (status === 404) return '방을 찾지 못했어요.';
  if (status === 503) return '오늘의 시를 가져오지 못했어요. 잠시 뒤에 다시 열어 주세요.';
  return '오늘의 시를 불러오지 못했어요.';
}

// Group the flat annotations array by line_id.
function indexAnnotations(list) {
  annotationsByLine = {};
  for (const a of list) {
    if (!annotationsByLine[a.line_id]) annotationsByLine[a.line_id] = [];
    annotationsByLine[a.line_id].push(a);
  }
}

function allAnnotations() {
  return Object.keys(annotationsByLine).reduce((out, k) => out.concat(annotationsByLine[k]), []);
}

function lineText(lineId) {
  const line = poem && poem.lines.find((l) => l.id === lineId);
  return line ? line.text.replace(/-{2,}/g, '—').replace(/_([^_]+)_/g, '$1').trim() : '';
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
  lines.forEach((l) => { if (hasContent(l.text)) updateLine(l.id); });
}

// One poem line: [ margin button ] [ text ] [ note count ]
//   - margin button -> this line's sheet (notes · highlighter)
//   - text          -> dictionary territory (words wrapped for dict-popup.js)
//   - count         -> added by updateLine() when the line has notes
// Blank lines render as spacers.
function renderLine(line) {
  if (!hasContent(line.text)) {
    return '<span class="ln ln-blank" aria-hidden="true"></span>';
  }
  return `
    <span class="ln" data-line-id="${line.id}">
      <button type="button" class="mark" aria-label="이 줄에 밑줄 · 메모"></button>
      <span class="tx">${wrapWords(line.text)}</span>
    </span>`;
}

// Keep one line's indicators in sync: dotted underline, count, highlighter.
function updateLine(lineId) {
  const ln = document.querySelector(`.ln[data-line-id="${lineId}"]`);
  if (!ln) return;
  const n = (annotationsByLine[lineId] || []).length;
  ln.classList.toggle('has-cm', n > 0);
  ln.classList.toggle('marked', marks.has(lineId));

  let cm = ln.querySelector('.cm');
  if (n === 0) {
    if (cm) cm.remove();
    return;
  }
  if (!cm) {
    cm = document.createElement('button');
    cm.type = 'button';
    cm.className = 'cm';
    cm.innerHTML = '<b></b>';
    ln.appendChild(cm);
  }
  cm.firstChild.textContent = n;
  cm.setAttribute('aria-label', `이 줄의 메모 ${n}개 보기`);
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

// The margin button or the count opens that line's sheet.
// (Words are handled by dict-popup.js.)
$('poem-body').addEventListener('click', (e) => {
  const btn = e.target.closest('.mark, .cm');
  if (!btn) return;
  openLine(Number(btn.parentNode.dataset.lineId), btn);
});

// =====================================================================
//  Highlighter — this device only
// =====================================================================
function marksKey() {
  return `typoem:marks:${ROOM_ID}:${poem.id}`;
}

function loadMarks() {
  marks = new Set();
  if (!poem) return;
  try {
    const saved = JSON.parse(localStorage.getItem(marksKey()) || '[]');
    if (Array.isArray(saved)) saved.forEach((id) => marks.add(Number(id)));
  } catch (err) { /* nothing saved */ }
}

function saveMarks() {
  try {
    if (marks.size) localStorage.setItem(marksKey(), JSON.stringify(Array.from(marks)));
    else localStorage.removeItem(marksKey());
  } catch (err) { /* storage full or unavailable: the mark just won't survive a reload */ }
}

$('l-mark').addEventListener('click', () => {
  if (currentLineId == null) return;
  if (marks.has(currentLineId)) marks.delete(currentLineId);
  else marks.add(currentLineId);
  saveMarks();
  updateLine(currentLineId);
  $('l-mark').textContent = marks.has(currentLineId) ? '밑줄 지우기' : '밑줄 긋기';
  UI.haptic();
});

// =====================================================================
//  Memo pill + memo sheet (every memo on this poem)
// =====================================================================
function noteCount() {
  return memos.length + allAnnotations().length;
}

function renderPill() {
  const n = noteCount();
  // people who left something, most recent first, three at most
  const names = [];
  memos.concat(allAnnotations())
    .sort(byNewest)
    .forEach((x) => { if (names.indexOf(x.author_nickname) < 0) names.push(x.author_nickname); });
  $('pill-avs').innerHTML = names.slice(0, 3).map(UI.avatar).join('');
  $('pill-label').textContent = n ? `메모 ${n}` : '메모 없음';
}

function byNewest(a, b) {
  return String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id;
}

// The sheet lists full-poem memos and line notes together, newest first.
// A line note shows the line it belongs to underneath.
function renderMemos() {
  const items = memos.map((m) => ({ kind: 'memo', x: m }))
    .concat(allAnnotations().map((a) => ({ kind: 'anno', x: a })))
    .sort((p, q) => byNewest(p.x, q.x));

  $('m-count').textContent = items.length ? `${items.length}개` : '';
  $('memo-list').innerHTML = items.length
    ? items.map((it) => (it.kind === 'memo' ? memoItem(it.x) : annotationItem(it.x, true))).join('')
    : '<p class="s-note">아직 남긴 메모가 없어요.</p>';
}

// A line note is edited with the sheet's "내 메모 고치기" button, so its own
// row only needs "지우기".
function controls(kind, id) {
  const edit = kind === 'memo'
    ? `<button type="button" class="link-btn" data-edit="${kind}" data-id="${id}">고치기</button>`
    : '';
  return `<span class="note-controls">
      ${edit}
      <button type="button" class="link-btn" data-del="${kind}" data-id="${id}">지우기</button>
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
          <button type="button" class="like-btn${memo.liked_by_me ? ' liked' : ''}" data-like="${memo.id}"
                  aria-pressed="${memo.liked_by_me ? 'true' : 'false'}" aria-label="좋아요">
            <span class="like-heart" aria-hidden="true">${memo.liked_by_me ? '♥' : '♡'}</span>
            <span class="like-count">${memo.like_count || 0}</span>
          </button>
          ${mine ? controls('memo', memo.id) : ''}
        </div>
      </div>
    </div>`;
}

// withQuote: in the memo sheet a line note carries its line; in the line
// sheet the line is already shown at the top, and the note can be edited.
function annotationItem(a, withQuote) {
  const mine = me && a.user_id === me.id;
  return `
    <div class="m-item" data-kind="anno" data-id="${a.id}">
      ${UI.avatar(a.author_nickname)}
      <div class="m-main">
        <b>${esc(a.author_nickname)}<small>${formatDate(a.created_at)}</small></b>
        <p class="note-content">${esc(a.content)}</p>
        ${withQuote ? `<q>${esc(lineText(a.line_id))}</q>` : ''}
        ${!withQuote && mine ? `<div class="m-foot">${controls('anno', a.id)}</div>` : ''}
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
//  Line sheet (one line's notes · highlighter)
// =====================================================================
function myAnnotation(lineId) {
  return (annotationsByLine[lineId] || []).find((a) => me && a.user_id === me.id) || null;
}

// Narrow screens: a sheet / dialog. 1024px+: the side panel switches from
// "all memos" to "this line", and "전체 메모로" (or Esc) switches it back.
function openLine(lineId, opener) {
  currentLineId = lineId;
  $('drawer-line').textContent = lineText(lineId);
  $('annotation-input').value = '';
  $('l-mark').textContent = marks.has(lineId) ? '밑줄 지우기' : '밑줄 긋기';
  renderAnnotations();
  UI.haptic();

  if (!UI.isWide()) {
    UI.openSheet('sheet-line');
    return;
  }
  UI.closeSheets();                         // e.g. an open dictionary popover
  lineOpener = opener || document.activeElement;
  document.querySelectorAll('.ln-open').forEach((el) => el.classList.remove('ln-open'));
  const ln = lineEl(lineId);
  if (ln) ln.classList.add('ln-open');
  $('r-side').classList.add('line-mode');
  const panel = $('sheet-line');
  panel.setAttribute('tabindex', '-1');
  panel.scrollTop = 0;
  panel.focus({ preventScroll: true });     // move focus into the panel
}

function lineEl(lineId) {
  return document.querySelector(`.ln[data-line-id="${lineId}"]`);
}

function lineViewOpen() {
  return $('r-side').classList.contains('line-mode');
}

// Back to all memos; focus returns to the button that opened the line view
// (or the line's margin button, if the count it came from is gone).
function closeLineView() {
  if (!lineViewOpen()) return false;
  const ln = lineEl(currentLineId);
  $('r-side').classList.remove('line-mode');
  document.querySelectorAll('.ln-open').forEach((el) => el.classList.remove('ln-open'));
  const back = (lineOpener && lineOpener.isConnected) ? lineOpener : (ln && ln.querySelector('.mark'));
  if (back) back.focus({ preventScroll: true });
  lineOpener = null;
  return true;
}

$('l-back').addEventListener('click', closeLineView);

// Esc closes the line view (an open popover or inline editor handles its own Esc first).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (document.querySelector('.sheet.show')) return;
  if (closeLineView()) e.preventDefault();
});

// Crossing 1024px: the panel and the sheets are the same elements, so reset the view.
UI.onWideChange(() => {
  $('r-side').classList.remove('line-mode');
  document.querySelectorAll('.ln-open').forEach((el) => el.classList.remove('ln-open'));
  lineOpener = null;
});

function renderAnnotations() {
  const list = annotationsByLine[currentLineId] || [];
  $('l-count').textContent = list.length ? `${list.length}개` : '';
  $('annotation-list').innerHTML = list.length
    ? list.map((a) => annotationItem(a, false)).join('')
    : '<p class="s-note">아직 이 줄에 남긴 메모가 없어요.</p>';

  // One note per person per line (UNIQUE(line_id, room_id, user_id)):
  // if mine exists, offer "edit my note" instead of a new one.
  const mine = myAnnotation(currentLineId);
  $('annotation-form').hidden = !!mine;
  $('l-edit-mine').hidden = !mine;
}

$('l-edit-mine').addEventListener('click', () => {
  const mine = myAnnotation(currentLineId);
  if (mine) startInlineEdit('anno', mine.id);
});

$('annotation-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (currentLineId == null) return;
  const lineId = currentLineId;
  const input = $('annotation-input');
  const content = input.value.trim();
  if (content.length < 1 || content.length > 1000) {
    UI.toast('메모는 1~1000자로 써 주세요');
    return;
  }
  const btn = $('annotation-submit');
  btn.disabled = true;
  try {
    const res = await authFetch(
      `/api/rooms/${encodeURIComponent(ROOM_ID)}/lines/${lineId}/annotations`,
      { method: 'POST', body: JSON.stringify({ content }) }
    );
    if (!res.ok) {
      // 409 = already annotated this line (written on another device, say)
      UI.toast(res.status === 409 ? '이 줄에는 이미 메모를 남겼어요' : '메모를 남기지 못했어요');
      if (res.status === 409) await reloadAnnotations(lineId);
      return;
    }
    input.value = '';
    await reloadAnnotations(lineId);
    UI.haptic();
  } catch (err) {
    UI.toast('네트워크 오류가 났어요. 다시 시도해 주세요');
  } finally {
    btn.disabled = false;
  }
});

// Refresh one line's notes from the server, then the sheet, the line and the pill.
async function reloadAnnotations(lineId) {
  if (lineId == null) return;
  const res = await authFetch(`/api/rooms/${encodeURIComponent(ROOM_ID)}/lines/${lineId}/annotations`);
  if (!res.ok) return;
  annotationsByLine[lineId] = await res.json();
  if (currentLineId === lineId) renderAnnotations();
  updateLine(lineId);
  renderPill();
  renderMemos();                 // line notes are listed with the memos too
}

// =====================================================================
//  Inline edit / delete (memos and line notes share these)
// =====================================================================
const KIND = {
  memo: { apiPath: '/api/memos', reload: () => reloadMemos() },
  anno: { apiPath: '/api/annotations', reload: () => reloadAnnotations(currentLineId) },
};

function itemEl(kind, id) {
  // the visible one: a line note can also sit (read-only) in the memo sheet
  const scope = UI.isWide()
    ? (lineViewOpen() ? '#sheet-line' : '#sheet-memo')
    : '.sheet.show';
  return document.querySelector(`${scope} .m-item[data-kind="${kind}"][data-id="${id}"]`);
}

function startInlineEdit(kind, id) {
  const item = itemEl(kind, id);
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
    const res = await authFetch(`${KIND[kind].apiPath}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: trimmed }),
    });
    if (!res.ok) {
      UI.toast('메모를 고치지 못했어요');
      return;
    }
    await KIND[kind].reload();
  });
}

function startInlineDelete(kind, id) {
  const item = itemEl(kind, id);
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
    const res = await authFetch(`${KIND[kind].apiPath}/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      UI.toast('메모를 지우지 못했어요');
      return;
    }
    await KIND[kind].reload();
  });
}

// Close an editor / confirm box that is already open on this item.
function closeInline(item) {
  item.querySelectorAll('.note-edit, .note-confirm').forEach((el) => el.remove());
  const contentEl = item.querySelector('.note-content');
  if (contentEl) contentEl.hidden = false;
}

// One listener per sheet for like / edit / delete (items are re-rendered often).
function wireList(listEl) {
  listEl.addEventListener('click', (e) => {
    const like = e.target.closest('[data-like]');
    if (like) { toggleLike(Number(like.dataset.like)); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { startInlineEdit(edit.dataset.edit, Number(edit.dataset.id)); return; }
    const del = e.target.closest('[data-del]');
    if (del) startInlineDelete(del.dataset.del, Number(del.dataset.id));
  });
}
wireList($('memo-list'));
wireList($('annotation-list'));

// =====================================================================
//  "다 읽었어요" — streak check-in (hidden until the API exists)
// =====================================================================
async function loadFinish() {
  const state = await TypoemStreak.load();     // null on 404 -> stays hidden
  if (!state) return;
  $('r-end').hidden = false;
  if (state.checkedInToday) setFinished();
}

function setFinished() {
  const btn = $('finish');
  btn.classList.add('done');
  btn.textContent = '오늘의 시를 읽었어요';
  btn.disabled = true;
}

$('finish').addEventListener('click', async () => {
  const btn = $('finish');
  btn.disabled = true;
  const state = await TypoemStreak.checkin();
  if (!state) {
    btn.disabled = false;
    UI.toast('기록하지 못했어요. 다시 눌러 주세요');
    return;
  }
  setFinished();
  UI.haptic();
  UI.toast(`${state.current}일째 이어서 읽고 있어요`);
  setTimeout(() => { window.location.href = '/index.html'; }, 1200);
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

// =====================================================================
//  This room's book (v1.1, temporary UI)
// =====================================================================
// Entry area for the book reader: shows the room's book + my progress with a
// "Read" link, or lets the owner pick a book. Self-contained: it does not call
// or change any of the poem functions above (only the shared escapeHtml helper).
// Endpoints: GET/PUT /api/rooms/:id/book, GET /api/books/search?q=

const BOOK_PUT_TIMEOUT_MS = 75000;   // a first-time import can take ~70 s on the server

let bookIsOwner = false;     // owner of this room? (own lookup; isOwner above is set asynchronously)
let bookCurrent = null;      // the room's book ({ id, title, ... }) or null
let bookBusy = false;        // a PUT is in flight

async function bookEntryLoad() {
  if (!ROOM_ID) return;
  const section = document.getElementById('book-entry');
  const body = document.getElementById('book-entry-body');

  const [bookRes, roomsRes] = await Promise.all([
    authFetch(`/api/rooms/${ROOM_ID}/book`),
    authFetch('/api/rooms/mine'),
  ]);

  if (roomsRes.ok && me) {
    const rooms = await roomsRes.json();
    const room = rooms.find((r) => String(r.id) === String(ROOM_ID));
    bookIsOwner = !!room && room.owner_id === me.id;
  }

  if (bookRes.ok) {
    const data = await bookRes.json();
    bookCurrent = data.book;
    const pct = bookProgressPercent(data);
    const started = data.progress && data.progress.startedAt;
    body.innerHTML = `
      <div class="book-entry-card">
        <span class="book-cover book-cover-${(data.book.id % 7) + 1}" aria-hidden="true"></span>
        <div class="book-entry-info">
          <p class="book-entry-title" lang="en">${escapeHtml(data.book.title)}</p>
          <p class="book-entry-author" lang="en">${escapeHtml(data.book.author || '')}</p>
          <p class="book-entry-progress">${started ? `약 ${pct}% 읽었어요` : '아직 읽기 시작하지 않았어요'}</p>
          <div class="book-entry-meter" aria-hidden="true"><div class="book-entry-meter-fill" style="width:${started ? pct : 0}%"></div></div>
          <div class="book-entry-actions">
            <a class="book-btn book-btn-pri" href="/book.html?room=${encodeURIComponent(ROOM_ID)}">${started ? '이어 읽기' : '읽기'}</a>
            ${bookIsOwner ? '<button type="button" class="book-btn book-btn-text" id="book-change-btn">책 바꾸기</button>' : ''}
          </div>
        </div>
      </div>`;
  } else if (bookRes.status === 404) {
    bookCurrent = null;
    body.innerHTML = bookIsOwner
      ? `<div class="book-empty">
           <p class="book-note">아직 책이 없어요. 방 멤버들과 함께 읽을 책을 골라 주세요.</p>
           <button type="button" class="book-btn book-btn-pri" id="book-change-btn">책 고르기</button>
         </div>`
      : `<div class="book-empty">
           <p class="book-note">아직 책이 없어요. 방장이 책을 고르면 여기에 나와요.</p>
         </div>`;
  } else {
    // 403 / other errors: the poem area above already reports room problems
    return;
  }

  const changeBtn = document.getElementById('book-change-btn');
  if (changeBtn) changeBtn.addEventListener('click', bookOpenPicker);
  section.hidden = false;
}

// Approximate % read from the overview: words in earlier chapters + the read
// share of the current chapter (paragraph texts are not in the overview).
function bookProgressPercent(data) {
  const total = data.book.totalWords || 0;
  const idx = data.progress ? data.progress.paragraphIdx : 0;
  if (!total) return 0;
  let words = 0;
  for (const c of data.chapters || []) {
    if (idx >= c.startParagraph + c.paragraphCount) {
      words += c.wordCount;
    } else if (idx >= c.startParagraph && c.paragraphCount > 0) {
      words += c.wordCount * (idx - c.startParagraph) / c.paragraphCount;
    }
  }
  return Math.min(100, Math.round((words / total) * 100));
}

// ---- Book picker (owner only) ----
function bookOpenPicker() {
  const picker = document.getElementById('book-picker');
  picker.innerHTML = `
    <form id="book-search-form" class="book-search-row">
      <input type="search" id="book-search-input" class="book-field" maxlength="100"
             placeholder="제목, 작가, 구텐베르크 번호" autocomplete="off" aria-label="책 검색">
      <button type="submit" class="book-btn book-btn-pri" id="book-search-btn">검색</button>
      <button type="button" class="book-btn book-btn-sec" id="book-picker-close">닫기</button>
    </form>
    <div id="book-picker-status" class="book-picker-status" role="status"></div>
    <ul id="book-results" class="book-results"></ul>`;
  picker.hidden = false;

  document.getElementById('book-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    bookSearch();
  });
  document.getElementById('book-picker-close').addEventListener('click', () => {
    if (bookBusy) return;
    picker.hidden = true;
    picker.innerHTML = '';
  });
  document.getElementById('book-search-input').focus();
}

async function bookSearch() {
  const input = document.getElementById('book-search-input');
  const status = document.getElementById('book-picker-status');
  const list = document.getElementById('book-results');
  const q = input.value.trim();
  if (!q || bookBusy) return;

  status.innerHTML = '<p class="book-loading">찾는 중이에요&hellip;</p>';
  list.innerHTML = '';
  let res;
  try {
    res = await authFetch(`/api/books/search?q=${encodeURIComponent(q)}`);
  } catch (err) {
    status.innerHTML = '<p class="book-error">서버에 연결할 수 없어요. 다시 시도해 주세요.</p>';
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    status.innerHTML = `<p class="book-error">${res.status === 502
      ? '지금은 책 목록을 불러올 수 없어요. 잠시 후 다시 시도해 주세요.'
      : escapeHtml(data.error || '검색하지 못했어요.')}</p>`;
    return;
  }
  const results = await res.json();
  if (results.length === 0) {
    status.innerHTML = '<p class="book-note">찾는 책이 없어요. 다른 제목이나 번호로 찾아보세요.</p>';
    return;
  }
  status.innerHTML = '';
  list.innerHTML = results.map((b) => {
    const authors = (b.authors || []).map((a) => a.name).join('; ');
    const current = bookCurrent && bookCurrent.id === b.gutenbergId;
    return `
      <li class="book-result">
        <div class="book-result-text">
          <span class="book-result-title" lang="en">${escapeHtml(b.title)}</span>
          <span class="book-result-author">${authors ? `<span lang="en">${escapeHtml(authors)}</span>` : '작가 미상'} &middot; #${b.gutenbergId}</span>
          ${b.alreadyImported ? '<span class="book-tag">바로 읽을 수 있어요</span>' : ''}
        </div>
        ${current
          ? '<span class="book-tag book-tag-current">지금 읽는 책</span>'
          : `<button type="button" class="book-btn book-btn-sec book-choose-btn" data-gid="${b.gutenbergId}">고르기</button>`}
      </li>`;
  }).join('');

  list.querySelectorAll('.book-choose-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = results.find((r) => r.gutenbergId === Number(btn.dataset.gid));
      bookChoose(b);
    });
  });
}

// Replacing an existing book asks first (inline, same note-confirm pattern).
function bookChoose(b) {
  if (bookBusy) return;
  if (!bookCurrent) {
    bookAssign(b);
    return;
  }
  const status = document.getElementById('book-picker-status');
  status.innerHTML = `
    <div class="book-confirm" role="alertdialog" aria-label="책 바꾸기">
      <p class="book-note">지금 읽는 <i lang="en">${escapeHtml(bookCurrent.title)}</i> 대신
        <i lang="en">${escapeHtml(b.title)}</i>${' '}책으로 바꿀까요?</p>
      <p class="book-note">멤버마다 읽던 진도는 책별로 남아 있어서, 다시 돌아오면 이어 읽을 수 있어요.</p>
      <div class="book-confirm-actions">
        <button type="button" class="book-btn book-btn-sec" id="book-replace-no">취소</button>
        <button type="button" class="book-btn book-btn-pri" id="book-replace-yes">바꾸기</button>
      </div>
    </div>`;
  document.getElementById('book-replace-no').addEventListener('click', () => { status.innerHTML = ''; });
  document.getElementById('book-replace-yes').addEventListener('click', () => bookAssign(b));
}

// authFetch takes no abort signal, so the 75 s client limit is a race. The server
// may still finish the import afterwards, in which case a retry is instant.
function bookWithTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function bookSetPickerDisabled(disabled) {
  document.querySelectorAll('#book-picker button, #book-picker input, #book-change-btn')
    .forEach((el) => { el.disabled = disabled; });
}

async function bookAssign(b) {
  const status = document.getElementById('book-picker-status');
  bookBusy = true;
  bookSetPickerDisabled(true);
  status.innerHTML = `
    <p class="book-loading"><span><i lang="en">${escapeHtml(b.title)}</i>${' '}책을 준비하고 있어요&hellip;</span></p>
    ${b.alreadyImported ? '' : '<p class="book-note">처음 가져오는 책은 1분 정도 걸릴 수 있어요.</p>'}`;

  let res = null;
  let failure = null;
  try {
    res = await bookWithTimeout(authFetch(`/api/rooms/${ROOM_ID}/book`, {
      method: 'PUT',
      body: JSON.stringify({ gutenbergId: b.gutenbergId }),
    }), BOOK_PUT_TIMEOUT_MS);
  } catch (err) {
    failure = err && err.message === 'timeout'
      ? '시간이 너무 오래 걸리고 있어요.'
      : '서버에 연결할 수 없어요.';
  }

  bookBusy = false;
  bookSetPickerDisabled(false);

  if (res && res.ok) {
    const picker = document.getElementById('book-picker');
    picker.hidden = true;
    picker.innerHTML = '';
    await bookEntryLoad();
    return;
  }

  let retryable = !!failure;
  if (res) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 502 || res.status === 503) {
      failure = '책을 가져오는 곳이 바쁘거나 잠시 멈췄어요.';
      retryable = true;
    } else {
      failure = data.error || '책을 정하지 못했어요.';   // 422 etc.: the server's message as is
    }
  }

  status.innerHTML = `<p class="book-error">${escapeHtml(failure)}</p>`;
  if (retryable) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'book-btn book-btn-sec';
    retry.textContent = '잠시 후 다시 시도';
    retry.addEventListener('click', () => bookAssign(b));
    status.appendChild(retry);
  }
}

bookEntryLoad();
