// public/book.js
// Book reader (v1.1, temporary UI) — one room's book, paged with CSS columns.
//
// Data:
//   GET /api/rooms/:id/book             overview: book, chapters, my progress
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
//  Load
// =====================================================================
async function init() {
  if (!ROOM) {
    showMessage('어느 방의 책인지 알 수 없어요.', false);
    return;
  }
  el('book-back').href = `/room.html?id=${encodeURIComponent(ROOM)}`;

  let res;
  try {
    res = await authFetch(`/api/rooms/${encodeURIComponent(ROOM)}/book`);
  } catch (err) {
    showMessage('서버에 연결할 수 없어요. 새로고침해 주세요.', true);
    return;
  }
  if (res.status === 401) return;   // authFetch is redirecting to login
  if (res.status === 403) {
    showMessage('이 방의 멤버가 아니에요.', true);
    return;
  }
  if (res.status === 404) {
    showMessage('이 방에는 아직 책이 없어요.', true);
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showMessage(data.error || '책을 불러오지 못했어요.', true);
    return;
  }

  const data = await res.json();
  book = data.book;
  chapters = data.chapters || [];
  targetEndDate = data.progress.targetEndDate || null;
  savedIdx = data.progress.paragraphIdx;
  anchorIdx = Math.min(data.progress.paragraphIdx, Math.max(0, book.totalParagraphs - 1));

  document.title = `${book.title} · Typoem`;
  el('book-title').textContent = book.title;
  el('book-room').textContent = data.room && data.room.name ? data.room.name : '';
  el('book-goal-input').value = targetEndDate || '';
  renderToc();
  el('book-toc-btn').disabled = false;
  el('book-goal-btn').disabled = false;

  if (chapters.length === 0) {
    showMessage('이 책에는 읽을 장이 없어요.', true);
    return;
  }

  el('book-message').hidden = true;
  el('book-stage').hidden = false;
  el('book-foot').hidden = false;

  await openChapter(chapterOfIdx(anchorIdx), { anchor: anchorIdx });

  // Web fonts change line breaks; re-flow once they are in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(relayoutKeepingAnchor);
  }
}

function showMessage(text, withBackLink) {
  const box = el('book-message');
  box.innerHTML = `<p class="book-note">${escapeHtml(text)}</p>` + (withBackLink && ROOM
    ? `<a class="book-btn book-btn-pri" href="/room.html?id=${encodeURIComponent(ROOM)}">방으로 돌아가기</a>`
    : '<a class="book-btn book-btn-pri" href="/index.html">내 방 목록으로</a>');
  box.hidden = false;
  el('book-stage').hidden = true;
  el('book-foot').hidden = true;
}

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
  if (!book || !flow.firstElementChild) return;
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
    pace.textContent = '목표일을 정하지 않았어요';
    return;
  }
  const remaining = total - read;
  const days = daysLeftIncludingToday(targetEndDate);
  if (remaining <= 0) {
    pace.textContent = '다 읽었어요!';
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
    pace.title = `오늘을 포함해 ${days}일 남았어요`;
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

async function saveGoal(value) {
  const status = el('book-goal-status');
  status.textContent = '저장하는 중…';
  clearTimeout(saveTimer);
  const idx = anchorIdx;
  try {
    const res = await authFetch(`/api/rooms/${encodeURIComponent(ROOM)}/book/progress`, {
      method: 'PUT',
      body: JSON.stringify({ paragraphIdx: idx, targetEndDate: value || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status.textContent = data.error || '목표일을 저장하지 못했어요.';
      return;
    }
    savedIdx = idx;
    targetEndDate = data.targetEndDate || null;
    status.textContent = targetEndDate ? '목표일을 저장했어요.' : '목표일을 지웠어요.';
    updateStats();
  } catch (err) {
    status.textContent = '서버에 연결할 수 없어요.';
  }
}

// =====================================================================
//  Contents + goal panels
// =====================================================================
// Label for a chapter: its heading, or "N장" for books without headings.
function chapterLabel(c) {
  return c.title || `${c.idx + 1}장`;
}

function renderToc() {
  el('book-toc-count').textContent = `${chapters.length}장`;
  el('book-toc-list').innerHTML = chapters.map((c) => `
    <li><button type="button" class="book-btn book-toc-item" data-ch="${c.idx}">
      <span>${escapeHtml(chapterLabel(c))}</span>
      <span class="book-toc-here" lang="ko" hidden>읽는 중</span>
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

// Bottom sheets (contents, goal): one at a time, over a scrim.
const SHEETS = { 'book-toc': 'book-toc-btn', 'book-goal': 'book-goal-btn' };

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
  if (id === 'book-toc') {
    const cur = el(id).querySelector('.book-toc-item.is-current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  } else {
    el('book-goal-status').textContent = '';
  }
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
  if (!book || e.altKey || e.ctrlKey || e.metaKey) return;
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
el('book-goal-btn').addEventListener('click', () => toggleSheet('book-goal'));
el('book-goal-close').addEventListener('click', closeSheets);
el('book-scrim').addEventListener('click', closeSheets);
el('book-goal-input').addEventListener('change', (e) => saveGoal(e.target.value));
el('book-goal-clear').addEventListener('click', () => {
  el('book-goal-input').value = '';
  saveGoal('');
});

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
