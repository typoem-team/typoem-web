// public/room.js
// Poem screen — today's poem + memos + line-level annotations for one room.
// Data source: GET /api/rooms/:id/today  (poem + memos + annotations in one payload)

// ---- Guard: redirect to login if there is no token ----
requireLogin();

// ---- Read room id from the query string (?id=...) ----
const params = new URLSearchParams(window.location.search);
const ROOM_ID = params.get('id');

// The date line, tab bar and log out live in ui.js.
const me = getCurrentUser();

// Point the "Poem history" link at this room's history page.
if (ROOM_ID) {
  document.getElementById('history-link').href = `/history.html?id=${ROOM_ID}`;
}

// ---- Escape user-provided text before inserting into HTML (XSS guard) ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ---- A line is "real" content if it has non-whitespace text ----
function hasContent(text) {
  return typeof text === 'string' && text.trim().length > 0;
}

// =====================================================================
//  State
// =====================================================================
// Annotations are grouped by line_id so the drawer can show one line's notes.
let annotationsByLine = {};   // { line_id: [annotation, ...] }
let currentLineId = null;     // line whose drawer is open, or null
let isOwner = false;          // is the current user this room's owner?

// =====================================================================
//  Initial load
// =====================================================================
async function loadToday() {
  const status = document.getElementById('status');

  if (!ROOM_ID) {
    status.textContent = '방을 찾지 못했어요.';
    return;
  }

  status.textContent = '오늘의 시를 펼치는 중이에요\u2026';

  const res = await authFetch(`/api/rooms/${ROOM_ID}/today`);

  // authFetch already handles 401 (logout + redirect); handle the rest here
  if (!res.ok) {
    status.textContent = loadErrorText(res.status);
    return;
  }

  const data = await res.json();
  status.textContent = '';

  // Remember this room: the 오늘 tab opens the last room you read in.
  TypoemUI.setLastRoom(ROOM_ID);

  // Room name in the sub-nav
  if (data.room && data.room.name) {
    document.getElementById('room-name').textContent = data.room.name;
  }

  // Build the annotation index, then render everything
  indexAnnotations(data.annotations || []);
  renderPoem(data.poem);
  renderMemos(data.memos || []);
  loadInviteCode();
  loadMembers();
}

// Korean message for a failed /today load (the API's own messages are English).
function loadErrorText(status) {
  if (status === 403) return '이 방의 멤버가 아니에요.';
  if (status === 404) return '방을 찾지 못했어요.';
  if (status === 503) return '오늘의 시를 가져오지 못했어요. 잠시 뒤에 다시 열어 주세요.';
  return '오늘의 시를 불러오지 못했어요.';
}

// The invite code isn't in the /today payload, but /api/rooms/mine returns it
// for each of the user's rooms — pull this room's code from there.
async function loadInviteCode() {
  const res = await authFetch('/api/rooms/mine');
  if (!res.ok) return;
  const rooms = await res.json();

  // find this room in the list
  let room = null;
  for (const r of rooms) {
    if (String(r.id) === String(ROOM_ID)) {
      room = r;
    }
  }
  if (!room || !room.invite_code) return;

  document.getElementById('invite-code').textContent = room.invite_code;
  document.getElementById('invite-share').hidden = false;
  wireCopyButton(room.invite_code);
  renderRoomActions(room);
}

// Owner sees a Delete button (removes the room + all its content); a non-owner
// member sees a Leave button. Both confirm inline before calling the backend.
function renderRoomActions(room) {
  if (!me) return;
  isOwner = room.owner_id === me.id;

  const wrap = document.getElementById('room-actions');
  drawRoomActionButton();
  wrap.hidden = false;
}

// (Re)draw the single action button for the current user's role. Split out so
// the inline-confirm Cancel path can restore the button without re-fetching.
function drawRoomActionButton() {
  const row = document.getElementById('room-actions-row');

  row.innerHTML = isOwner
    ? '<button type="button" id="delete-room-btn" class="btn-sm btn-danger">이 방 삭제하기</button>'
    : '<button type="button" id="leave-room-btn" class="btn-sm btn-danger">이 방 나가기</button>';

  if (isOwner) {
    document.getElementById('delete-room-btn')
      .addEventListener('click', () => confirmRoomAction({
        verb: 'delete',
        prompt: '이 방을 삭제할까요? 모두의 메모가 함께 사라지고 되돌릴 수 없어요.',
        apiPath: `/api/rooms/${ROOM_ID}`,
      }));
  } else {
    document.getElementById('leave-room-btn')
      .addEventListener('click', () => confirmRoomAction({
        verb: 'leave',
        prompt: '이 방에서 나갈까요?',
        apiPath: `/api/rooms/${ROOM_ID}/leave`,
      }));
  }
}

// Inline confirm box for leave/delete (same note-confirm pattern as memos).
// On success the backend returns 204; we send the user back to My Rooms.
function confirmRoomAction(cfg) {
  const row = document.getElementById('room-actions-row');
  if (row.querySelector('.note-confirm')) return;  // already confirming

  const err = document.getElementById('room-action-error');
  err.textContent = '';

  const box = document.createElement('div');
  box.className = 'note-confirm';
  box.innerHTML = `
    <span class="note-confirm-text">${cfg.prompt}</span>
    <span class="note-confirm-actions">
      <button type="button" class="btn-sm btn-danger room-confirm-yes">${cfg.verb === 'delete' ? '삭제' : '나가기'}</button>
      <button type="button" class="btn-sm room-confirm-no">취소</button>
    </span>
  `;
  row.innerHTML = '';
  row.appendChild(box);

  box.querySelector('.room-confirm-no')
    .addEventListener('click', drawRoomActionButton);

  box.querySelector('.room-confirm-yes').addEventListener('click', async () => {
    const res = await authFetch(cfg.apiPath, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      showError(err, cfg.verb === 'delete' ? '방을 삭제하지 못했어요.' : '방에서 나가지 못했어요.');
      drawRoomActionButton();
      return;
    }
    window.location.href = '/index.html';
  });
}

// Member list — GET /api/rooms/:id/members returns members in join order
// (id, username, nickname, role). Backend already exists (P3); just render.
async function loadMembers() {
  const res = await authFetch(`/api/rooms/${ROOM_ID}/members`);
  if (!res.ok) return;
  const members = await res.json();

  const ul = document.getElementById('member-list');
  ul.innerHTML = members.map((m) => {
    const name = escapeHtml(m.nickname || m.username || '');
    const owner = m.role === 'owner'
      ? ' <span class="member-badge">방장</span>'
      : '';
    return `<li class="member-item">${name}${owner}</li>`;
  }).join('');
}

// Copy the invite code to the clipboard (same fallback pattern as create-room.js).
function wireCopyButton(code) {
  const btn = document.getElementById('copy-code-btn');
  const feedback = document.getElementById('copy-feedback');
  const codeEl = document.getElementById('invite-code');

  btn.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(code);
    } catch (err) {
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      sel.removeAllRanges();
    }
    btn.textContent = '복사했어요';
    feedback.hidden = false;
    setTimeout(function () {
      btn.textContent = '복사';
      feedback.hidden = true;
    }, 5000);
  });
}

// Group the flat annotations array by line_id.
function indexAnnotations(list) {
  annotationsByLine = {};
  for (const a of list) {
    if (!annotationsByLine[a.line_id]) annotationsByLine[a.line_id] = [];
    annotationsByLine[a.line_id].push(a);
  }
}

// =====================================================================
//  Poem rendering
// =====================================================================
// Each content line becomes a tappable row. Words within a line are wrapped in
// <span class="word" data-word="..."> so the dictionary popup (P12) can hook in.
function renderPoem(poem) {
  const titleEl = document.getElementById('poem-title');
  const authorEl = document.getElementById('poem-author');
  const bodyEl = document.getElementById('poem-body');

  if (!poem) {
    bodyEl.innerHTML = '<p class="status">시를 불러오지 못했어요.</p>';
    return;
  }

  titleEl.innerHTML = renderMeta(poem.title) || 'Untitled';
  authorEl.innerHTML = renderMeta(poem.author);

  const lines = Array.isArray(poem.lines) ? poem.lines : [];
  bodyEl.innerHTML = lines.map(renderLine).join('');

  // The left gutter handle opens the annotation drawer.
  // The poem text itself stays free for the dictionary popup (P12) — clicking a
  // word does NOT open the drawer, so the two actions never overlap.
  bodyEl.querySelectorAll('.line-gutter[data-line-id]').forEach((el) => {
    el.addEventListener('click', () => openDrawer(Number(el.dataset.lineId)));
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openDrawer(Number(el.dataset.lineId));
      }
    });
  });
}

// One poem line. Blank lines render as spacers (no gutter, no annotations).
// Layout: [ gutter handle ] [ poem text ] [ note count ]
//   - gutter  → tap target for the annotation drawer
//   - text    → dictionary territory (words wrapped for P12); gets a sepia
//               highlight when the line has notes
//   - count   → faint number at the end of the line
function renderLine(line) {
  if (!hasContent(line.text)) {
    return '<div class="poem-line poem-line-blank"><span class="line-text">&nbsp;</span></div>';
  }

  const count = (annotationsByLine[line.id] || []).length;
  const noted = count > 0 ? ' has-notes' : '';
  const hl = count > 0 ? ' noted' : '';
  const tally = count > 0 ? `<span class="line-tally">${count}</span>` : '';

  return `
    <div class="poem-line" data-line-id="${line.id}">
      <span class="line-gutter${noted}" data-line-id="${line.id}"
            role="button" tabindex="0"
            aria-label="이 줄의 메모">
        <span class="gutter-bar"></span>
      </span>
      <span class="line-text${hl}">${wrapWords(line.text)}</span>
      ${tally}
    </div>
  `;
}

// Title/author markup. Same PoetryDB markers as the body (em dash + italics)
// but WITHOUT the dictionary word-tokenising — title/author words aren't
// clickable. innerHTML, so escapeHtml runs first.
function renderMeta(text) {
  return escapeHtml(text || '')
    .replace(/-{2,}/g, '\u2014')          // em dash (2+ hyphens)
    .replace(/_([^_]+)_/g, '<em>$1</em>'); // italics
}

// Render a poem line into clickable .word spans for the dictionary (P12),
// while translating PoetryDB's plain-text markup:
//   _word_  -> <em>word</em>   (Project Gutenberg italics convention)
//   --      -> —               (em dash)
// Punctuation is split off the dictionary lookup so "And," looks up "and",
// while the line still DISPLAYS the punctuation verbatim.
function wrapWords(text) {
  let t = text.replace(/-{2,}/g, '\u2014');   // 1) em dash (2+ hyphens), before tokenising

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
    return spaceTok.split(/(\u2014)/).map(function (p) {
      if (p === '\u2014') return '\u2014';   // em dash: literal, not a .word
      return wrapWordChunk(p);
    }).join('');
  }).join(' ');
}

// Wrap a single chunk: strip leading/trailing punctuation off the lookup word
// (so the dictionary gets a clean term) but display the chunk verbatim.
// A chunk with no real word (pure punctuation) is emitted as escaped text.
function wrapWordChunk(chunk) {
  if (chunk === '') return '';
  const m = chunk.match(/^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9'\u2019-]*)?([^A-Za-z0-9]*)$/);
  if (!m || !m[2]) return escapeHtml(chunk);
  const pre = m[1], core = m[2], post = m[3];
  const lookup = escapeHtml(core.toLowerCase());
  return escapeHtml(pre)
    + `<span class="word" data-word="${lookup}">${escapeHtml(core)}</span>`
    + escapeHtml(post);
}

// =====================================================================
//  Memos (full-poem notes)
// =====================================================================
function renderMemos(memos) {
  const listEl = document.getElementById('memo-list');
  const emptyEl = document.getElementById('memo-empty');

  if (!Array.isArray(memos) || memos.length === 0) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = memos.map(memoItem).join('');

  // Owner-only edit/delete controls
  listEl.querySelectorAll('[data-memo-edit]').forEach((b) =>
    b.addEventListener('click', () => editMemo(Number(b.dataset.memoEdit))));
  listEl.querySelectorAll('[data-memo-del]').forEach((b) =>
    b.addEventListener('click', () => deleteMemo(Number(b.dataset.memoDel))));
  listEl.querySelectorAll('[data-memo-like]').forEach((b) =>
    b.addEventListener('click', () => toggleLike(Number(b.dataset.memoLike))));
}

// Toggle a like on a memo. The backend returns the authoritative new state
// ({ liked, like_count }); update just this button rather than reloading the
// whole list, so the user's scroll position and any open editors are kept.
async function toggleLike(id) {
  const res = await authFetch(`/api/memos/${id}/like`, { method: 'POST' });
  if (!res.ok) return;
  const data = await res.json();
  const btn = document.querySelector(`[data-memo-like="${id}"]`);
  if (!btn) return;
  btn.classList.toggle('liked', data.liked);
  btn.setAttribute('aria-pressed', data.liked ? 'true' : 'false');
  btn.querySelector('.like-heart').textContent = data.liked ? '\u2665' : '\u2661';
  btn.querySelector('.like-count').textContent = data.like_count;
}

function memoItem(memo) {
  const mine = me && memo.user_id === me.id;
  const liked = memo.liked_by_me ? ' liked' : '';
  const controls = mine
    ? `<span class="note-controls">
         <button type="button" class="link-btn" data-memo-edit="${memo.id}">고치기</button>
         <button type="button" class="link-btn" data-memo-del="${memo.id}">지우기</button>
       </span>`
    : '';
  return `
    <article class="note-card" data-memo-id="${memo.id}">
      <p class="note-content">${escapeHtml(memo.content)}</p>
      <p class="note-meta">
        <span class="note-author">${escapeHtml(memo.author_nickname)}</span>
        <span class="note-date">${formatDate(memo.created_at)}</span>
        <button type="button" class="like-btn${liked}" data-memo-like="${memo.id}"
                aria-pressed="${memo.liked_by_me ? 'true' : 'false'}" aria-label="좋아요">
          <span class="like-heart" aria-hidden="true">${memo.liked_by_me ? '\u2665' : '\u2661'}</span>
          <span class="like-count">${memo.like_count || 0}</span>
        </button>
        ${controls}
      </p>
    </article>
  `;
}

async function submitMemo() {
  const input = document.getElementById('memo-input');
  const err = document.getElementById('memo-error');
  const content = input.value.trim();
  err.textContent = '';

  if (content.length < 1 || content.length > 1000) {
    showError(err, '메모는 1~1000자로 써 주세요.');
    return;
  }

  const res = await authFetch(`/api/rooms/${ROOM_ID}/memos`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    showError(err, '메모를 남기지 못했어요.');
    return;
  }
  input.value = '';
  await reloadMemos();
}

// ---- Shared inline edit/delete helpers for memo & annotation cards ----
// cfg: { id, selector, apiPath, reload }
//   selector -> attribute that identifies the card (e.g. 'data-memo-id')
//   apiPath  -> resource path (e.g. '/api/memos')
//   reload   -> function to refresh the list after a change
function startInlineEdit(cfg) {
  const card = document.querySelector(`.note-card[${cfg.selector}="${cfg.id}"]`);
  if (!card) return;
  const contentEl = card.querySelector('.note-content');
  if (!contentEl || card.querySelector('.note-edit')) return;  // already editing

  const current = contentEl.textContent;

  const editor = document.createElement('div');
  editor.className = 'note-edit';
  editor.innerHTML = `
    <textarea class="note-edit-input" maxlength="1000" rows="3" aria-label="메모 고치기"></textarea>
    <p class="note-edit-error"></p>
    <div class="note-edit-actions">
      <button type="button" class="btn-sm note-edit-save">저장</button>
      <button type="button" class="btn-sm note-edit-cancel">취소</button>
    </div>
  `;
  const textarea = editor.querySelector('.note-edit-input');
  const errEl = editor.querySelector('.note-edit-error');
  textarea.value = current;

  contentEl.hidden = true;
  contentEl.insertAdjacentElement('afterend', editor);
  textarea.focus();

  function cancel() {
    editor.remove();
    contentEl.hidden = false;
  }

  editor.querySelector('.note-edit-cancel').addEventListener('click', cancel);

  // Esc cancels, Cmd/Ctrl+Enter saves
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      editor.querySelector('.note-edit-save').click();
    }
  });

  editor.querySelector('.note-edit-save').addEventListener('click', async () => {
    const trimmed = textarea.value.trim();
    if (trimmed.length < 1 || trimmed.length > 1000) {
      errEl.textContent = '메모는 1~1000자로 써 주세요.';
      return;
    }
    const res = await authFetch(`${cfg.apiPath}/${cfg.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: trimmed }),
    });
    if (!res.ok) {
      errEl.textContent = '메모를 고치지 못했어요.';
      return;
    }
    await cfg.reload();
  });
}

function startInlineDelete(cfg) {
  const card = document.querySelector(`.note-card[${cfg.selector}="${cfg.id}"]`);
  if (!card) return;
  const contentEl = card.querySelector('.note-content');
  if (!contentEl || card.querySelector('.note-confirm')) return;  // already confirming

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

  function cancel() {
    box.remove();
    contentEl.hidden = false;
  }

  box.querySelector('.note-confirm-no').addEventListener('click', cancel);

  box.querySelector('.note-confirm-yes').addEventListener('click', async () => {
    const res = await authFetch(`${cfg.apiPath}/${cfg.id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      box.querySelector('.note-confirm-text').textContent = '메모를 지우지 못했어요.';
      return;
    }
    await cfg.reload();
  });
}

function editMemo(id) {
  startInlineEdit({
    id,
    selector: 'data-memo-id',
    apiPath: '/api/memos',
    reload: reloadMemos,
  });
}

function deleteMemo(id) {
  startInlineDelete({
    id,
    selector: 'data-memo-id',
    apiPath: '/api/memos',
    reload: reloadMemos,
  });
}
// Refresh just the memo list (after create/edit/delete).
async function reloadMemos() {
  const res = await authFetch(`/api/rooms/${ROOM_ID}/memos`);
  if (!res.ok) return;
  const memos = await res.json();
  renderMemos(memos);
}

// =====================================================================
//  Annotation drawer (per-line notes)
// =====================================================================
function openDrawer(lineId) {
  currentLineId = lineId;
  const drawer = document.getElementById('drawer');
  const lineText = document.querySelector(`.poem-line[data-line-id="${lineId}"] .line-text`);

  document.getElementById('drawer-line').textContent =
    lineText ? lineText.textContent : '';
  document.getElementById('annotation-error').textContent = '';
  document.getElementById('annotation-input').value = '';

  renderAnnotations(annotationsByLine[lineId] || []);
  drawer.classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
}

function closeDrawer() {
  currentLineId = null;
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
}

function renderAnnotations(list) {
  const wrap = document.getElementById('annotation-list');
  const empty = document.getElementById('annotation-empty');

  if (!Array.isArray(list) || list.length === 0) {
    wrap.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  wrap.innerHTML = list.map(annotationItem).join('');

  wrap.querySelectorAll('[data-anno-edit]').forEach((b) =>
    b.addEventListener('click', () => editAnnotation(Number(b.dataset.annoEdit))));
  wrap.querySelectorAll('[data-anno-del]').forEach((b) =>
    b.addEventListener('click', () => deleteAnnotation(Number(b.dataset.annoDel))));
}

function annotationItem(a) {
  const mine = me && a.user_id === me.id;
  const controls = mine
    ? `<span class="note-controls">
         <button type="button" class="link-btn" data-anno-edit="${a.id}">고치기</button>
         <button type="button" class="link-btn" data-anno-del="${a.id}">지우기</button>
       </span>`
    : '';
  return `
    <article class="note-card" data-anno-id="${a.id}">
      <p class="note-content">${escapeHtml(a.content)}</p>
      <p class="note-meta">
        <span class="note-author">${escapeHtml(a.author_nickname)}</span>
        <span class="note-date">${formatDate(a.created_at)}</span>
        ${controls}
      </p>
    </article>
  `;
}

async function submitAnnotation() {
  const input = document.getElementById('annotation-input');
  const err = document.getElementById('annotation-error');
  const content = input.value.trim();
  err.textContent = '';

  if (currentLineId == null) return;
  if (content.length < 1 || content.length > 1000) {
    showError(err, '메모는 1~1000자로 써 주세요.');
    return;
  }

  const res = await authFetch(
    `/api/rooms/${ROOM_ID}/lines/${currentLineId}/annotations`,
    { method: 'POST', body: JSON.stringify({ content }) }
  );
  if (!res.ok) {
    // 409 = already annotated this line (one per user per line)
    showError(err, res.status === 409
      ? '이 줄에는 이미 메모를 남겼어요. 내 메모를 고쳐 주세요.'
      : '메모를 남기지 못했어요.');
    return;
  }
  input.value = '';
  await reloadAnnotations(currentLineId);
}

function editAnnotation(id) {
  startInlineEdit({
    id,
    selector: 'data-anno-id',
    apiPath: '/api/annotations',
    reload: () => reloadAnnotations(currentLineId),
  });
}


function deleteAnnotation(id) {
  startInlineDelete({
    id,
    selector: 'data-anno-id',
    apiPath: '/api/annotations',
    reload: () => reloadAnnotations(currentLineId),
  });
}

// Refresh one line's annotations from the server, update state + drawer + badge.
async function reloadAnnotations(lineId) {
  if (lineId == null) return;

  const res = await authFetch(
    `/api/rooms/${ROOM_ID}/lines/${lineId}/annotations`
  );
  if (!res.ok) return;
  const list = await res.json();
  annotationsByLine[lineId] = list;
  renderAnnotations(list);
  updateLineBadge(lineId, list.length);
}

// Keep the line's note indicators in sync: gutter tint, the sepia highlight
// on the text, and the faint count at the end of the line.
function updateLineBadge(lineId, count) {
  const lineEl = document.querySelector(`.poem-line[data-line-id="${lineId}"]`);
  if (!lineEl) return;

  const gutter = lineEl.querySelector('.line-gutter');
  const text = lineEl.querySelector('.line-text');
  if (gutter) gutter.classList.toggle('has-notes', count > 0);
  if (text) text.classList.toggle('noted', count > 0);

  let tally = lineEl.querySelector('.line-tally');
  if (count > 0) {
    if (!tally) {
      tally = document.createElement('span');
      tally.className = 'line-tally';
      lineEl.appendChild(tally);
    }
    tally.textContent = count;
  } else if (tally) {
    tally.remove();
  }
}

// =====================================================================
//  Helpers + wiring
// =====================================================================
// created_at looks like "2026-05-31 13:16:03"
function formatDate(created_at) {
  if (!created_at) return '';
  // created_at is stored as UTC ('YYYY-MM-DD HH:MM:SS'); mark it as UTC so the
  // browser converts it to the viewer's local time zone.
  const d = new Date(created_at.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return created_at.slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Show an inline error message that clears itself after 5 seconds.
function showError(el, message) {
  el.textContent = message;
  if (el._clearTimer) clearTimeout(el._clearTimer);
  el._clearTimer = setTimeout(() => {
    el.textContent = '';
    el._clearTimer = null;
  }, 5000);
}

document.getElementById('memo-submit').addEventListener('click', submitMemo);
document.getElementById('annotation-submit').addEventListener('click', submitAnnotation);
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

loadToday();
