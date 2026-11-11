// public/book.js
// Book tab (v1.1) — one room's book, paged with CSS columns; a 10-book shelf
// when the room has no book yet (the owner picks one, members wait).
//
// Data:
//   GET /api/rooms/mine                 am I the owner? (also: member or not)
//   GET /api/books/shelf, GET /api/books   the shelf (10 recommended + other stored books)
//   GET /api/books/search?q=            the empty slot's search (책 추가)
//   PUT /api/rooms/:id/book             owner picks / changes the book
//   GET /api/rooms/:id/book             overview: book, chapters, my progress, readers
//   GET /api/rooms/:id/book?chapter=N   one chapter's paragraphs (cached in memory)
//   PUT /api/rooms/:id/book/progress    { paragraphIdx, targetEndDate? }
//
// Paging: #book-flow is one viewport wide and one viewport tall, with
// column-width = its width, so the chapter overflows sideways into columns that
// are each exactly one page. A page turn is translateX(-page * step).
//
// Position: anchorIdx is the book-wide idx of the first paragraph that starts on
// the current page (or, if none starts there, the paragraph that runs through it).
// It is what we save, and on resize / reload we go to the page where it starts.

// ---- Guard: redirect to login if there is no token ----
requireLogin();

const ROOM = new URLSearchParams(window.location.search).get('room');

// =====================================================================
//  Word wrapping for the dictionary — copied from room.js.
//  3단계에서 공용화 예정 (to be moved to a shared file in stage 3).
//  Keep in sync with room.js until then.
// =====================================================================

// ---- Escape text before inserting into HTML (XSS guard) ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Render a line into clickable .word spans for the dictionary (P12),
// while translating Gutenberg plain-text markup:
//   _word_  -> <em>word</em>
//   --      -> — (em dash)
function wrapWords(text) {
  let t = text.replace(/-{2,}/g, '—');   // 1) em dash (2+ hyphens), before tokenising

  // 2) Paired emphasis _..._ -> <em>...</em>. A lone/unmatched underscore is
  //    left as a literal character.
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

// Wrap plain text. Splits on spaces AND em dashes so a word on either side of a
// dash stays independently clickable; the dash itself is not clickable.
function wrapInline(segment) {
  if (segment === '') return '';
  return segment.split(' ').map(function (spaceTok) {
    if (spaceTok === '') return '';
    return spaceTok.split(/(—)/).map(function (p) {
      if (p === '—') return '—';
      return wrapWordChunk(p);
    }).join('');
  }).join(' ');
}

// Wrap a single chunk: strip leading/trailing punctuation off the lookup word
// but display the chunk verbatim.
function wrapWordChunk(chunk) {
  if (chunk === '') return '';
  const m = chunk.match(/^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9'’-]*)?([^A-Za-z0-9]*)$/);
  if (!m || !m[2]) return escapeHtml(chunk);
  const pre = m[1], core = m[2], post = m[3];
  const lookup = escapeHtml(core.toLowerCase());
  return escapeHtml(pre)
    + `<span class="word" data-word="${lookup}">${escapeHtml(core)}</span>`
    + escapeHtml(post);
}

// =====================================================================
//  State
// =====================================================================
const SAVE_DEBOUNCE_MS = 1500;

let book = null;            // overview.book
let chapters = [];          // overview.chapters
let readers = [];           // overview.readers [{ userId, nickname, chapterIdx, isMe }]
let targetEndDate = null;   // 'YYYY-MM-DD' or null
const chapterCache = new Map();   // chapter idx -> paragraphs [{ id, idx, text }]

let curChapter = 0;
let curPage = 0;
let pageCount = 1;
let step = 0;               // px per page (= viewport width)
let anchorIdx = 0;          // see header comment
let savedIdx = null;        // last paragraphIdx the server has
let saveTimer = null;
let navBusy = false;        // a chapter is loading

const el = (id) => document.getElementById(id);
const viewport = el('book-viewport');
const flow = el('book-flow');

// =====================================================================
//  Load: the room has a book -> reader; no book yet (404) -> shelf
// =====================================================================
const UI = window.TypoemUI;
const BOOK_PUT_TIMEOUT_MS = 75000;   // a first-time import can take ~70 s on the server

let isOwner = false;        // owner of this room (only the owner picks the book)
let view = 'loading';       // 'loading' | 'message' | 'reader' | 'shelf'

function roomUrl() {
  return `/room.html?id=${encodeURIComponent(ROOM)}`;
}

async function init() {
  if (!ROOM) {
    showMessage('어느 방의 책인지 알 수 없어요.', false);
    return;
  }
  el('tab-poem').href = roomUrl();
  el('tab-book').href = `/book.html?room=${encodeURIComponent(ROOM)}`;

  let res;
  let roomsRes;
  try {
    [res, roomsRes] = await Promise.all([
      authFetch(`/api/rooms/${encodeURIComponent(ROOM)}/book`),
      authFetch('/api/rooms/mine').catch(() => null),
    ]);
  } catch (err) {
    showMessage('서버에 연결할 수 없어요. 새로고침해 주세요.', true);
    return;
  }
  if (res.status === 401) return;   // authFetch is redirecting to login

  // Owner / membership come from my room list. GET /book answers 404 both for
  // "no such room" and "no book yet"; the list tells the two apart.
  let room = null;
  let roomsKnown = false;
  if (roomsRes && roomsRes.ok) {
    const rooms = await roomsRes.json().catch(() => null);
    if (Array.isArray(rooms)) {
      roomsKnown = true;
      room = rooms.find((r) => String(r.id) === String(ROOM)) || null;
    }
  }
  const me = getCurrentUser();
  isOwner = !!(room && me && room.owner_id === me.id);
  if (room) el('room-name').textContent = room.name || '';

  if (res.status === 403 || (res.status === 404 && roomsKnown && !room)) {
    showMessage('이 방의 멤버가 아니거나 없는 방이에요.', false);
    return;
  }
  if (res.status === 404) {
    UI.setLastRoom(ROOM);
    openShelf();
    return;
  }
  if (!res.ok) {
    showMessage('책을 불러오지 못했어요.', true);
    return;
  }

  UI.setLastRoom(ROOM);
  await showReader(await res.json());
}

// One of the four screens below the top bar.
function setView(v) {
  const changed = v !== view;
  view = v;
  document.body.classList.toggle('is-shelf', v === 'shelf');
  // Content comes in the way the poem does on room.html (fade + rise); the top
  // bar stays put. Paging measures relative positions, so a transform is safe.
  if (changed && v === 'reader') {
    UI.anim(el('book-stage'), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 460 });
  } else if (changed && v === 'shelf') {
    UI.anim(document.querySelector('.book-shelf-wrap'), [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 520 });
  }
  el('book-shelf-view').hidden = v !== 'shelf';
  el('book-bar').hidden = v !== 'reader';
  el('book-stage').hidden = v !== 'reader';
  el('book-foot').hidden = v !== 'reader';
  el('book-message').hidden = v !== 'message' && v !== 'loading';
  // light status bar text over the shelf's dark band, dark text on paper
  window.TypoemNative.setStatusBar(v === 'shelf' ? 'light' : 'dark');
}

// data: GET /api/rooms/:id/book overview
async function showReader(data) {
  if (book && book.id !== data.book.id) chapterCache.clear();   // 책 바꾸기
  book = data.book;
  chapters = data.chapters || [];
  readers = data.readers || [];
  targetEndDate = data.progress.targetEndDate || null;
  savedIdx = data.progress.paragraphIdx;
  anchorIdx = Math.min(data.progress.paragraphIdx, Math.max(0, book.totalParagraphs - 1));

  document.title = `${book.title} · Typoem`;
  el('book-title').textContent = book.title;
  if (data.room && data.room.name) el('room-name').textContent = data.room.name;
  el('book-goal-input').value = targetEndDate || '';
  renderToc();
  el('book-toc-btn').disabled = false;
  el('book-pace').disabled = false;
  el('book-toc-foot').hidden = !isOwner;

  if (chapters.length === 0) {
    showMessage('이 책에는 읽을 장이 없어요.', true);
    return;
  }

  setView('reader');
  await openChapter(chapterOfIdx(anchorIdx), { anchor: anchorIdx });

  // Web fonts change line breaks; re-flow once they are in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(relayoutKeepingAnchor);
  }
}

function showMessage(text, withBackLink) {
  setView('message');
  const box = el('book-message');
  box.innerHTML = `<p class="book-note">${escapeHtml(text)}</p>` + (withBackLink && ROOM
    ? `<a class="book-btn book-btn-pri" href="${roomUrl()}">방으로 돌아가기</a>`
    : '<a class="book-btn book-btn-pri" href="/index.html">내 방 목록으로</a>');
}

// =====================================================================
//  Shelf: 10 recommended books + other books already on the server.
//  Everything happens inside the shelf (no sheets): a book's row opens to
//  "이 책으로 정하기"; the owner's empty slot at the end opens to a search,
//  and a found book is put on the shelf in front of the slot.
// =====================================================================
let shelfBooks = null;      // [{ gutenbergId, title, author, imported, cover? }]; also planted ones (until reload)
let openCell = null;        // the <li> whose panel is open (one at a time)
let assignBusy = false;     // a PUT is in flight (its row stays open)
let searchSeq = 0;
let searchResults = [];

// Opened when the room has no book, or by the owner's 책 바꾸기 in the reader.
function openShelf() {
  closeSheets();                     // the reader's contents / goal sheets
  const changing = !!book;
  if (changing) saveNow();           // keep the reading position before leaving
  setView('shelf');
  window.scrollTo(0, 0);
  document.title = `${changing ? '책 바꾸기' : '이 방의 책'} · Typoem`;

  el('book-shelf-title').textContent = changing ? '책 바꾸기' : '이 방의 책';
  el('book-shelf-lead').textContent = !isOwner
    ? '방장이 책을 고르면 여기에 표시돼요'
    : changing
      ? '바꾸면 방 전체에 적용돼요'
      : '이 방에서 읽을 책을 고르세요';
  el('book-shelf-foot').hidden = !(isOwner && changing);

  if (shelfBooks) renderShelf();
  else loadShelf();
}

function backToReader() {
  if (!book) return;
  collapseCell();
  setView('reader');
  document.title = `${book.title} · Typoem`;
  lastSize = '';
  relayoutKeepingAnchor();
}

// "Austen, Jane" (Gutenberg order) -> "Jane Austen"; several authors stay "; "-separated.
function displayAuthor(name) {
  if (!name) return '';
  return String(name).split('; ').map((n) => {
    const m = /^([^,]+),\s*(.+)$/.exec(n);
    return m ? `${m[2]} ${m[1]}` : n;
  }).join('; ');
}

// shelf = GET /api/books/shelf, then GET /api/books minus those 10
async function loadShelf() {
  const status = el('book-shelf-status');
  status.textContent = '책장을 불러오는 중이에요…';
  el('book-shelf').innerHTML = '';
  const [shelfRes, booksRes] = await Promise.all([
    authFetch('/api/books/shelf').catch(() => null),
    authFetch('/api/books').catch(() => null),
  ]);
  if (!shelfRes || !shelfRes.ok) {
    status.innerHTML = '책장을 불러오지 못했어요. <button type="button" class="link-btn" id="book-shelf-retry">다시 시도</button>';
    el('book-shelf-retry').addEventListener('click', loadShelf);
    return;
  }
  const picks = await shelfRes.json();
  let others = [];
  if (booksRes && booksRes.ok) {
    const stored = await booksRes.json().catch(() => []);
    const onShelf = new Set(picks.map((b) => b.gutenbergId));
    others = stored
      .filter((b) => !onShelf.has(b.gutenbergId))
      .map((b) => ({ gutenbergId: b.gutenbergId, title: b.title, author: displayAuthor(b.author), imported: true }));
  }
  shelfBooks = picks.concat(others);
  status.textContent = '';
  renderShelf();
}

function renderShelf() {
  openCell = null;
  el('book-shelf').innerHTML = shelfBooks.map(cellHtml).join('') + (isOwner ? slotHtml() : '');
}

// The owner gets a button per book (it opens the row); members and the current
// book get a plain row.
function cellHtml(b) {
  const current = !!book && book.id === b.gutenbergId;
  const inner = bookRowHtml(b) + (current ? '<span class="book-tag book-tag-current">읽는 중</span>' : '');
  if (!isOwner || current) {
    return `<li class="book-shelf-cell" data-gid="${b.gutenbergId}"><div class="book-shelf-item">${inner}</div></li>`;
  }
  return `<li class="book-shelf-cell" data-gid="${b.gutenbergId}">
      <button type="button" class="book-shelf-item" data-act="open-pick" aria-expanded="false">${inner}</button>
      <div class="book-shelf-panel" hidden></div>
    </li>`;
}

// the owner's empty place at the end of the shelf
function slotHtml() {
  return `<li class="book-shelf-cell book-shelf-slot">
      <button type="button" class="book-shelf-item" data-act="open-search" aria-expanded="false">
        <span class="book-slot-cover" aria-hidden="true"></span>
        <span class="book-shelf-text">
          <span class="book-slot-label">책 추가</span>
          <span class="book-slot-hint">제목 또는 구텐베르크 번호로 검색</span>
        </span>
      </button>
      <div class="book-shelf-panel" hidden></div>
    </li>`;
}

// Cover colour 1-7: shelf books by shelf position (so neighbours differ),
// anything else by id. A planted book keeps the colour it had in the results.
function coverOf(b) {
  if (b.cover) return b.cover;
  const i = shelfBooks ? shelfBooks.findIndex((s) => s.gutenbergId === b.gutenbergId) : -1;
  return (i >= 0 ? i : b.gutenbergId) % 7 + 1;
}

function bookRowHtml(b) {
  return `
    <span class="book-cover book-cover-${coverOf(b)}" aria-hidden="true"></span>
    <span class="book-shelf-text">
      <span class="book-shelf-title" lang="en">${escapeHtml(b.title)}</span>
      ${b.author
        ? `<span class="book-shelf-author" lang="en">${escapeHtml(b.author)}</span>`
        : '<span class="book-shelf-author">작가 미상</span>'}
    </span>`;
}

function bookOfCell(cell) {
  const gid = Number(cell.dataset.gid);
  return shelfBooks.find((b) => b.gutenbergId === gid);
}

// ---- open / close a row ----
function openPanel(cell, html) {
  if (!collapseCell()) return null;          // another row is busy
  const btn = cell.querySelector(':scope > button');
  const panel = cell.querySelector('.book-shelf-panel');
  panel.innerHTML = html;
  panel.hidden = false;
  cell.classList.add('is-open');
  btn.setAttribute('aria-expanded', 'true');
  openCell = cell;
  return panel;
}

// Returns false while a PUT is running (that row stays open).
function collapseCell() {
  if (!openCell) return true;
  if (assignBusy) return false;
  const cell = openCell;
  openCell = null;
  searchSeq++;                               // drop a search still in flight
  cell.classList.remove('is-open');
  const panel = cell.querySelector('.book-shelf-panel');
  panel.hidden = true;
  panel.innerHTML = '';
  cell.querySelector(':scope > button').setAttribute('aria-expanded', 'false');
  return true;
}

// ---- pick: the row opens to "이 책으로 정하기" ----
function openPick(cell) {
  const b = bookOfCell(cell);
  if (!b) return;
  const panel = openPanel(cell, `
    <p class="book-note book-shelf-note">${book
      ? '방 전체가 이 책으로 바뀌어요. 읽던 위치는 책마다 저장돼요.'
      : '방 전체가 이 책을 읽게 돼요.'}</p>
    <div class="book-shelf-status" role="status"></div>
    <div class="book-shelf-actions">
      <button type="button" class="sec" data-act="cancel">취소</button>
      <button type="button" class="pri" data-act="assign">이 책으로 정하기</button>
    </div>`);
  if (!panel) return;
  panel.querySelector('[data-act="assign"]').focus({ preventScroll: true });
  // the popover floats below the book: keep it on screen near the bottom edge
  panel.scrollIntoView({ block: 'nearest', behavior: UI.reduceMotion ? 'auto' : 'smooth' });
}

// authFetch takes no abort signal, so the client limit is a race. The server
// may still finish the import afterwards, in which case a retry is instant.
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function assignCell(cell) {
  const b = bookOfCell(cell);
  if (!b || assignBusy) return;
  const panel = cell.querySelector('.book-shelf-panel');
  const status = panel.querySelector('.book-shelf-status');
  const yes = panel.querySelector('[data-act="assign"]');
  const no = panel.querySelector('[data-act="cancel"]');
  assignBusy = true;
  yes.disabled = true;
  no.disabled = true;
  status.innerHTML = `<p class="book-loading">${b.imported
    ? '여는 중…'
    : '책을 가져오는 중이에요. 처음에만 시간이 걸려요.'}</p>`;

  let res = null;
  let failure = null;
  let retryable = false;
  try {
    res = await withTimeout(authFetch(`/api/rooms/${encodeURIComponent(ROOM)}/book`, {
      method: 'PUT',
      body: JSON.stringify({ gutenbergId: b.gutenbergId }),
    }), BOOK_PUT_TIMEOUT_MS);
  } catch (err) {
    failure = err && err.message === 'timeout'
      ? '시간이 오래 걸려 멈췄어요. 다시 시도해 주세요.'
      : '서버에 연결할 수 없어요.';
    retryable = true;
  }

  if (res && res.ok) {
    b.imported = true;
    let overview = null;
    try {
      const r = await authFetch(`/api/rooms/${encodeURIComponent(ROOM)}/book`);
      if (r.ok) overview = await r.json();
    } catch (err) { /* reload below */ }
    assignBusy = false;
    if (!overview) {
      window.location.reload();
      return;
    }
    collapseCell();
    UI.toast('읽을 책을 정했어요');
    await showReader(overview);
    return;
  }

  if (res) {
    if (res.status === 401) return;   // authFetch is redirecting to login
    if (res.status === 502 || res.status === 503) {
      failure = '구텐베르크가 응답하지 않아요. 잠시 후 다시 시도해 주세요.';
      retryable = true;
    } else if (res.status === 403) {
      failure = '방장만 책을 고를 수 있어요.';
    } else if (res.status === 404) {
      failure = '구텐베르크에서 이 책을 찾지 못했어요.';
    } else if (res.status === 422) {
      failure = '이 책은 가져올 수 없어요. 다른 책을 골라 주세요.';
    } else {
      failure = '책을 고르지 못했어요.';
    }
  }

  assignBusy = false;
  status.innerHTML = `<p class="book-error">${escapeHtml(failure)}</p>`;
  no.disabled = false;
  yes.disabled = false;
  yes.hidden = !retryable;
  yes.textContent = '다시 시도';
}

// ---- empty slot: the row opens to a search ----
function openSearch(cell) {
  const panel = openPanel(cell, `
    <form class="m-write book-shelf-search" novalidate>
      <input type="search" class="field" maxlength="100" placeholder="예: Emma, 1342"
             aria-label="책 제목 또는 구텐베르크 번호" autocomplete="off">
      <button type="submit" class="pri">찾기</button>
    </form>
    <p class="status book-shelf-search-status" role="status"></p>
    <ol class="book-shelf-results" aria-label="찾은 책"></ol>`);
  if (panel) panel.querySelector('input').focus({ preventScroll: true });
}

async function runSearch(panel) {
  const q = panel.querySelector('input').value.trim();
  const status = panel.querySelector('.book-shelf-search-status');
  const list = panel.querySelector('.book-shelf-results');
  if (!q) {
    status.textContent = '책 제목이나 번호를 적어 주세요.';
    return;
  }
  const seq = ++searchSeq;
  status.textContent = '찾는 중이에요…';
  list.innerHTML = '';

  let res = null;
  try {
    res = await authFetch(`/api/books/search?q=${encodeURIComponent(q)}`);
  } catch (err) {
    res = null;
  }
  if (seq !== searchSeq) return;     // closed, or a newer search is running
  if (!res || !res.ok) {
    if (res && res.status === 401) return;
    status.textContent = res && res.status === 400
      ? '100자 안으로 적어 주세요.'
      : '지금은 제목 검색을 쓸 수 없어요. 번호로 검색해 보세요. 예: 1342';
    return;
  }
  const results = await res.json();
  if (seq !== searchSeq) return;
  if (results.length === 0) {
    status.textContent = '검색 결과가 없어요.';
    return;
  }
  status.textContent = '';
  searchResults = results.map((r) => ({
    gutenbergId: r.gutenbergId,
    title: r.title,
    author: displayAuthor((r.authors || []).map((a) => a.name).join('; ')),
    imported: !!r.alreadyImported,
  }));
  list.innerHTML = searchResults.map((b, i) => {
    const onShelf = shelfBooks.some((s) => s.gutenbergId === b.gutenbergId);
    return `<li><button type="button" class="book-shelf-item" data-act="plant" data-i="${i}">
        ${bookRowHtml(b)}${onShelf ? '<span class="book-tag">책장에 있음</span>' : ''}
      </button></li>`;
  }).join('');
}

// A found book goes on the shelf right in front of the empty slot (or, if it
// is already there, that book is shown). Then it is picked like any other.
function plant(b) {
  collapseCell();
  const list = el('book-shelf');
  let cell = list.querySelector(`.book-shelf-cell[data-gid="${b.gutenbergId}"]`);
  if (!cell) {
    b.cover = coverOf(b);                    // keep the colour it had in the results
    shelfBooks.push(b);
    const tpl = document.createElement('template');
    tpl.innerHTML = cellHtml(b).trim();
    cell = tpl.content.firstElementChild;
    list.insertBefore(cell, list.querySelector('.book-shelf-slot'));
  }
  cell.classList.remove('is-planted');
  void cell.offsetWidth;                     // restart the animation
  cell.classList.add('is-planted');
  cell.addEventListener('animationend', () => cell.classList.remove('is-planted'), { once: true });
  cell.scrollIntoView({ block: 'nearest', behavior: UI.reduceMotion ? 'auto' : 'smooth' });
  const btn = cell.querySelector(':scope > button');
  if (btn) btn.focus({ preventScroll: true });
}

// ---- wiring (the list element stays; its rows are re-rendered) ----
el('book-shelf').addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const cell = t.closest('.book-shelf-cell');
  switch (t.dataset.act) {
    case 'open-pick':
      if (openCell === cell) collapseCell(); else openPick(cell);
      break;
    case 'open-search':
      if (openCell === cell) collapseCell(); else openSearch(cell);
      break;
    case 'cancel':
      collapseCell();
      cell.querySelector(':scope > button').focus({ preventScroll: true });
      break;
    case 'assign':
      assignCell(cell);
      break;
    case 'plant':
      plant(searchResults[Number(t.dataset.i)]);
      break;
  }
});

el('book-shelf').addEventListener('submit', (e) => {
  if (!e.target.classList.contains('book-shelf-search')) return;
  e.preventDefault();
  runSearch(e.target.closest('.book-shelf-panel'));
});

// A click outside the open row, or Esc, folds it back.
document.addEventListener('click', (e) => {
  if (openCell && view === 'shelf' && !openCell.contains(e.target) && e.target.isConnected) collapseCell();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !openCell || view !== 'shelf') return;
  const btn = openCell.querySelector(':scope > button');
  if (collapseCell()) btn.focus({ preventScroll: true });
});

el('book-change-btn').addEventListener('click', openShelf);
el('book-shelf-back').addEventListener('click', backToReader);

// Android back: the reader's own sheets, then an open shelf row, then
// shelf -> reader (when changing books), then home.
window.TypoemNav.setBackHandler(function () {
  if (sheetOpen()) { closeSheets(); return true; }
  if (view === 'shelf' && openCell) { collapseCell(); return true; }
  if (view === 'shelf' && book) { backToReader(); return true; }
  window.location.href = '/index.html';
  return true;
});

function chapterOfIdx(idx) {
  for (const c of chapters) {
    if (idx >= c.startParagraph && idx < c.startParagraph + c.paragraphCount) return c.idx;
  }
  return chapters.length ? chapters[0].idx : 0;
}

async function fetchChapter(c) {
  if (chapterCache.has(c)) return chapterCache.get(c);
  const res = await authFetch(`/api/rooms/${encodeURIComponent(ROOM)}/book?chapter=${c}`);
  if (!res.ok) throw new Error(`chapter ${c}: ${res.status}`);
  const data = await res.json();
  chapterCache.set(c, data.paragraphs || []);
  return chapterCache.get(c);
}

// Open chapter c. where: { anchor: idx } | { page: 'first' | 'last' }
async function openChapter(c, where) {
  if (navBusy) return;
  navBusy = true;
  el('book-page-num').textContent = '불러오는 중…';
  let paragraphs;
  try {
    paragraphs = await fetchChapter(c);
  } catch (err) {
    console.error(err);
    el('book-page-num').textContent = '이 장을 불러오지 못했어요. 다시 시도해 주세요.';
    navBusy = false;
    return;
  }
  navBusy = false;

  curChapter = c;
  renderChapter(paragraphs);
  layout();

  if (where.anchor != null) {
    showPage(pageOfIdx(where.anchor));
    anchorIdx = where.anchor;
    updateStats();
  } else {
    goToPage(where.page === 'last' ? pageCount - 1 : 0);
  }

  // Warm the cache for the neighbours so chapter turns feel instant.
  const n = chapters.findIndex((ch) => ch.idx === c);
  if (chapters[n + 1]) fetchChapter(chapters[n + 1].idx).catch(() => {});
  if (chapters[n - 1]) fetchChapter(chapters[n - 1].idx).catch(() => {});
}

function renderChapter(paragraphs) {
  const ch = chapters.find((x) => x.idx === curChapter);
  // Show the chapter title as a heading unless the first paragraph already is it.
  const first = paragraphs[0] ? paragraphs[0].text.trim() : '';
  const title = ch && ch.title && ch.title.trim() !== first
    ? `<h2 class="book-chapter-title">${escapeHtml(ch.title)}</h2>`
    : '';
  flow.innerHTML = title + paragraphs.map((p) => {
    const heading = ch && ch.title && p.text.trim() === ch.title.trim();
    return `<p class="book-para${heading ? ' book-para-heading' : ''}" data-idx="${p.idx}">${wrapWords(p.text)}</p>`;
  }).join('');
  el('book-chapter-name').textContent = chapterLabel(ch || { idx: curChapter, title: null });
  markTocCurrent();
}

// =====================================================================
//  Paging
// =====================================================================
// Size the flow so each column is exactly one viewport, then count pages.
function layout() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  const padX = w < 600 ? 22 : 40;
  const padY = w < 600 ? 18 : 28;
  const colW = w - padX * 2;

  step = w;
  flow.style.width = `${colW}px`;
  flow.style.height = `${Math.max(100, h - padY * 2)}px`;
  flow.style.margin = `${padY}px ${padX}px`;
  flow.style.columnWidth = `${colW}px`;
  flow.style.columnGap = `${padX * 2}px`;
  flow.style.transform = 'translateX(0px)';

  const last = flow.lastElementChild;
  if (!last) {
    pageCount = 1;
    return;
  }
  const rects = last.getClientRects();
  const r = rects[rects.length - 1];
  pageCount = Math.max(1, pageOfX(r.left) + 1);
}

// Page index of a client x coordinate inside the (untransformed or transformed) flow.
function pageOfX(x) {
  const rel = x - flow.getBoundingClientRect().left;
  return Math.max(0, Math.floor((rel + 2) / step));
}

function startPageOf(p) {
  const rects = p.getClientRects();
  return rects.length ? pageOfX(rects[0].left) : 0;
}

function pageOfIdx(idx) {
  const p = flow.querySelector(`.book-para[data-idx="${idx}"]`);
  if (!p) return 0;
  return Math.min(pageCount - 1, startPageOf(p));
}

// First paragraph starting on page n, else the one running through it.
function anchorForPage(n) {
  let covering = null;
  for (const p of flow.querySelectorAll('.book-para')) {
    const start = startPageOf(p);
    if (start === n) return Number(p.dataset.idx);
    if (start > n) break;
    covering = Number(p.dataset.idx);
  }
  if (covering != null) return covering;
  const first = flow.querySelector('.book-para');
  return first ? Number(first.dataset.idx) : anchorIdx;
}

// Show page n without changing the anchor (used for restore / resize).
function showPage(n) {
  curPage = Math.max(0, Math.min(pageCount - 1, n));
  flow.style.transform = `translateX(${-curPage * step}px)`;
  el('book-page-num').textContent = `${curPage + 1} / ${pageCount}쪽 (이 장)`;
}

// A real page turn: move, take the new anchor, save soon.
function goToPage(n) {
  showPage(n);
  anchorIdx = anchorForPage(curPage);
  updateStats();
  scheduleSave();
}

function chapterPos() {
  return chapters.findIndex((c) => c.idx === curChapter);
}

function nextPage() {
  if (navBusy) return;
  if (curPage < pageCount - 1) {
    goToPage(curPage + 1);
  } else if (chapters[chapterPos() + 1]) {
    openChapter(chapters[chapterPos() + 1].idx, { page: 'first' });
  }
}

function prevPage() {
  if (navBusy) return;
  if (curPage > 0) {
    goToPage(curPage - 1);
  } else if (chapters[chapterPos() - 1]) {
    openChapter(chapters[chapterPos() - 1].idx, { page: 'last' });
  }
}

function relayoutKeepingAnchor() {
  if (!book || view !== 'reader' || !flow.firstElementChild) return;
  layout();
  showPage(pageOfIdx(anchorIdx));
  updateStats();
}

// =====================================================================
//  Progress + pace
// =====================================================================
function countWords(text) {
  const m = String(text).match(/\S+/g);
  return m ? m.length : 0;
}

// Words before the anchor: whole earlier chapters (server counts) plus the
// share of this chapter before the anchor paragraph.
function wordsRead() {
  if (!book) return 0;
  const pos = chapterPos();
  const atVeryEnd = pos === chapters.length - 1 && curPage === pageCount - 1;
  if (atVeryEnd) return book.totalWords;

  let words = 0;
  for (const c of chapters) {
    if (c.idx === curChapter) break;
    words += c.wordCount;
  }
  const ch = chapters[pos];
  const paras = chapterCache.get(curChapter) || [];
  let before = 0;
  let all = 0;
  for (const p of paras) {
    const n = countWords(p.text);
    all += n;
    if (p.idx < anchorIdx) before += n;
  }
  if (ch && all > 0) words += Math.round(ch.wordCount * before / all);
  return Math.min(words, book.totalWords);
}

// Whole days from today to the goal date, counting today (device local date).
function daysLeftIncludingToday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const goal = new Date(y, m - 1, d);
  return Math.round((goal - today) / 86400000) + 1;
}

function updateStats() {
  const total = book.totalWords || 0;
  const read = wordsRead();
  const pct = total ? Math.floor((read / total) * 100) : 0;
  el('book-progress-text').textContent =
    `${read.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')}단어 · ${pct}%`;
  el('book-progress-fill').style.width = `${total ? (read / total) * 100 : 0}%`;

  const pace = el('book-pace');
  pace.classList.remove('is-late');
  pace.title = '';
  if (!targetEndDate) {
    pace.textContent = '목표일 정하기';
    return;
  }
  pace.title = `목표일 ${targetEndDate.slice(5).replace('-', '/')} · 눌러서 바꾸기`;
  const remaining = total - read;
  const days = daysLeftIncludingToday(targetEndDate);
  if (remaining <= 0) {
    pace.textContent = '완독';
  } else if (days < 1) {
    pace.textContent = '목표일이 지났어요';
    pace.classList.add('is-late');
  } else {
    const perDay = Math.ceil(remaining / days);
    // Pages use this chapter's average words per page at the current screen size.
    const ch = chapters[chapterPos()];
    const perPage = ch && pageCount ? ch.wordCount / pageCount : 0;
    const pages = perPage > 0 ? Math.max(1, Math.round(perDay / perPage)) : null;
    pace.textContent = pages
      ? `오늘 약 ${pages}쪽 (${perDay.toLocaleString('ko-KR')}단어)`
      : `오늘 약 ${perDay.toLocaleString('ko-KR')}단어`;
    pace.title += ` · 오늘 포함 ${days}일 남음`;
  }
}

// =====================================================================
//  Saving
// =====================================================================
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const idx = anchorIdx;
  if (idx === savedIdx) return;
  try {
    const res = await authFetch(`/api/rooms/${encodeURIComponent(ROOM)}/book/progress`, {
      method: 'PUT',
      body: JSON.stringify({ paragraphIdx: idx }),
    });
    if (res.ok) savedIdx = idx;
  } catch (err) {
    console.error(err);   // next page turn or leaving the page tries again
  }
}

// When the page is being hidden/closed: keepalive fetch so the request survives
// unload (authFetch cannot pass keepalive).
function saveOnLeave() {
  if (!book || anchorIdx === savedIdx) return;
  clearTimeout(saveTimer);
  const token = getToken();
  if (!token) return;
  const idx = anchorIdx;
  try {
    fetch(`/api/rooms/${encodeURIComponent(ROOM)}/book/progress`, {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ paragraphIdx: idx }),
    }).then((res) => { if (res.ok) savedIdx = idx; }).catch(() => {});
  } catch (err) {
    // ignore: best effort
  }
}

// The pace line opens the browser's date picker on a hidden date input; picking
// a date saves it, clearing it in the picker removes the goal.
function openGoalPicker() {
  const input = el('book-goal-input');
  input.value = targetEndDate || '';
  try {
    if (typeof input.showPicker === 'function') { input.showPicker(); return; }
  } catch (err) { /* not allowed here: fall through */ }
  input.focus();
  input.click();
}

async function saveGoal(value) {
  if ((value || null) === targetEndDate) return;
  clearTimeout(saveTimer);
  const idx = anchorIdx;
  try {
    const res = await authFetch(`/api/rooms/${encodeURIComponent(ROOM)}/book/progress`, {
      method: 'PUT',
      body: JSON.stringify({ paragraphIdx: idx, targetEndDate: value || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      UI.toast('목표일을 저장하지 못했어요.');
      return;
    }
    savedIdx = idx;
    targetEndDate = data.targetEndDate || null;
    UI.toast(targetEndDate ? '목표일을 저장했어요' : '목표일을 지웠어요');
    updateStats();
  } catch (err) {
    UI.toast('서버에 연결할 수 없어요.');
  }
}

// =====================================================================
//  Contents + goal panels
// =====================================================================
// Label for a chapter: its heading, or "N장" for books without headings.
function chapterLabel(c) {
  return c.title || `${c.idx + 1}장`;
}

// Other members reading chapter idx: up to 3 avatars, then "+N". I'm left out
// (the "읽는 중" tag already marks where I am).
const TOC_MAX_READERS = 3;
function tocReadersHtml(idx) {
  const here = readers.filter((r) => !r.isMe && r.chapterIdx === idx);
  if (here.length === 0) return '';
  const names = here.map((r) => r.nickname).join(', ');
  const more = here.length - TOC_MAX_READERS;
  return `<span class="book-toc-readers" title="${escapeHtml(names)}" aria-label="${escapeHtml(names)} 읽는 중">`
    + here.slice(0, TOC_MAX_READERS).map((r) => UI.avatar(r.nickname)).join('')
    + (more > 0 ? `<em>+${more}</em>` : '')
    + '</span>';
}

function renderToc() {
  el('book-toc-count').textContent = `${chapters.length}장`;
  el('book-toc-list').innerHTML = chapters.map((c) => `
    <li><button type="button" class="book-btn book-toc-item" data-ch="${c.idx}">
      <span>${escapeHtml(chapterLabel(c))}</span>
      <span class="book-toc-side">
        ${tocReadersHtml(c.idx)}
        <span class="book-toc-here" lang="ko" hidden>읽는 중</span>
      </span>
    </button></li>`).join('');
  el('book-toc-list').querySelectorAll('.book-toc-item').forEach((b) => {
    b.addEventListener('click', async () => {
      closeSheets();
      await openChapter(Number(b.dataset.ch), { page: 'first' });
    });
  });
}

function markTocCurrent() {
  el('book-toc-list').querySelectorAll('.book-toc-item').forEach((b) => {
    const cur = Number(b.dataset.ch) === curChapter;
    b.classList.toggle('is-current', cur);
    b.querySelector('.book-toc-here').hidden = !cur;
  });
}

// Bottom sheet (contents), over a scrim.
const SHEETS = { 'book-toc': 'book-toc-btn' };

function sheetOpen() {
  return !el('book-scrim').hidden;
}

function closeSheets() {
  for (const id in SHEETS) {
    el(id).hidden = true;
    el(SHEETS[id]).setAttribute('aria-expanded', 'false');
  }
  el('book-scrim').hidden = true;
}

function toggleSheet(id) {
  const show = el(id).hidden;
  closeSheets();
  if (!show) return;
  el(id).hidden = false;
  el(SHEETS[id]).setAttribute('aria-expanded', 'true');
  el('book-scrim').hidden = false;
  const cur = el(id).querySelector('.book-toc-item.is-current');
  if (cur) cur.scrollIntoView({ block: 'center' });
}

// =====================================================================
//  Input wiring
// =====================================================================
function dictPopupOpen() {
  const p = document.querySelector('.dict-popup');
  return !!p && !p.hidden;
}

// Edge zones: the first tap while the dictionary is open only closes it
// (dict-popup.js closes it on any outside click).
el('book-edge-prev').addEventListener('click', () => { if (!dictPopupOpen()) prevPage(); });
el('book-edge-next').addEventListener('click', () => { if (!dictPopupOpen()) nextPage(); });
el('book-prev').addEventListener('click', prevPage);
el('book-next').addEventListener('click', nextPage);

document.addEventListener('keydown', (e) => {
  if (!book || view !== 'reader' || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'Escape') { closeSheets(); return; }
  if (sheetOpen()) return;   // arrows don't turn pages behind an open sheet
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'ArrowRight') { e.preventDefault(); nextPage(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prevPage(); }
});

// Swipe: a mostly-horizontal drag of 50px+ turns the page.
let touchStart = null;
el('book-stage').addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) { touchStart = null; return; }
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
el('book-stage').addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  if (dx < 0) nextPage(); else prevPage();
}, { passive: true });

el('book-toc-btn').addEventListener('click', () => toggleSheet('book-toc'));
el('book-scrim').addEventListener('click', closeSheets);
el('book-pace').addEventListener('click', openGoalPicker);
el('book-goal-input').addEventListener('change', (e) => saveGoal(e.target.value));

// Resize / rotation (or the bar wrapping onto more lines): re-flow and return to
// the anchor paragraph. Only re-flow when the viewport size really changed.
let resizeTimer = null;
let lastSize = '';
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const size = `${viewport.clientWidth}x${viewport.clientHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    relayoutKeepingAnchor();
  }, 150);
}
if (window.ResizeObserver) new ResizeObserver(onResize).observe(viewport);
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// Save when leaving the page or switching apps.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveOnLeave();
});
window.addEventListener('pagehide', saveOnLeave);

init();
