// public/index.js
// Home — the room you opened last: members, invite, and a deck of covers
// (today's poem + the three most recent past poems + "more").
//
// Data (existing APIs, unchanged):
//   GET    /api/rooms/mine          rooms + invite_code + member_count
//   GET    /api/rooms/:id/today     today's poem, memos, annotations
//   GET    /api/rooms/:id/history   past daily poems + contributors
//   GET    /api/rooms/:id/members   members in join order
//   POST   /api/rooms/join          join with an invite code
//   DELETE /api/rooms/:id/leave     leave (members) · DELETE /api/rooms/:id (owner)
//
// Depends on auth.js, ui.js (TypoemUI), streak.js (TypoemStreak).

requireLogin();

const UI = window.TypoemUI;
const esc = UI.esc;
const me = getCurrentUser();
const $ = (id) => document.getElementById(id);

const PAST_ON_DECK = 3;       // past covers shown on the deck before "+N"

// Everything that only makes sense when there is a room (deck, room card, invite, past poems).
function setRoomView(visible) {
  document.querySelectorAll('[data-room-view]').forEach((el) => { el.hidden = !visible; });
}

// ---- State ----
let rooms = [];
let room = null;              // current room (from /rooms/mine)
let today = null;             // /today payload, or null if it failed
let past = [];                // history rows before today's date
let deckItems = [];           // [{ kind: 'today' | 'past' | 'more', ... }]
let deckIndex = 0;
let loadSeq = 0;              // latest room load wins

// PoetryDB writes an em dash as "--" and italics as _word_ (same rules as room.js)
function meta(text) {
  return esc(text || '')
    .replace(/-{2,}/g, '—')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}

// =====================================================================
//  Load
// =====================================================================
async function loadHome(preferRoomId) {
  const status = $('status');
  status.textContent = '방을 불러오는 중이에요…';

  // The room we'll most likely show is already known (the one read last), so its
  // poem / history / members are asked for together with the room list instead
  // of after it: one round trip to the server less before the home screen fills.
  const wanted = preferRoomId != null ? preferRoomId : UI.getLastRoom();
  const early = wanted != null ? { roomId: wanted, data: fetchRoomData(wanted) } : null;

  let res;
  try {
    res = await authFetch('/api/rooms/mine');
  } catch (err) {
    status.textContent = '네트워크 오류가 났어요. 다시 시도해 주세요.';
    return;
  }
  // authFetch already handles 401 (logout + redirect)
  if (!res.ok) {
    status.textContent = '방을 불러오지 못했어요.';
    return;
  }
  rooms = await res.json();
  status.textContent = '';

  if (!Array.isArray(rooms) || rooms.length === 0) {
    rooms = [];
    room = null;
    UI.setLastRoom(null);
    setRoomView(false);
    $('empty-state').hidden = false;
    return;
  }
  $('empty-state').hidden = true;
  setRoomView(true);

  // The room opened last; if it is gone (left / deleted), the newest room.
  const found = rooms.find((r) => String(r.id) === String(wanted));
  await showRoom(found || rooms[0], found ? early.data : null);
}

// today (without a streak check-in: drawing the cover isn't reading it), history,
// members, all at once. Each one resolves to its Response, or null on a network error.
function fetchRoomData(roomId) {
  const id = encodeURIComponent(roomId);
  return Promise.all([
    authFetch(`/api/rooms/${id}/today?checkin=0`).catch(() => null),
    authFetch(`/api/rooms/${id}/history`).catch(() => null),
    authFetch(`/api/rooms/${id}/members`).catch(() => null),
  ]);
}

// prefetched: fetchRoomData(next.id) already started by loadHome, if any.
async function showRoom(next, prefetched) {
  const seq = ++loadSeq;
  room = next;
  UI.setLastRoom(room.id);

  // textContent: the room name is user input
  $('room-name').textContent = room.name;
  $('invite-room').textContent = room.name;
  $('invite-code').textContent = room.invite_code || '';
  $('room-avs').innerHTML = '';
  $('status').textContent = '';
  renderRooms();
  renderDeckLoading();

  const [todayRes, historyRes, membersRes] = await (prefetched || fetchRoomData(room.id));
  if (seq !== loadSeq) return;   // the user switched rooms meanwhile

  today = todayRes && todayRes.ok ? await todayRes.json() : null;
  const history = historyRes && historyRes.ok ? (await historyRes.json()).history || [] : [];
  const members = membersRes && membersRes.ok ? await membersRes.json() : [];
  if (seq !== loadSeq) return;

  // History includes today's poem; everything else is a "past poem".
  // (If /today failed, compare against the server's UTC date so today's row
  //  still isn't shown as past.)
  const todayDate = today ? today.date : new Date().toISOString().slice(0, 10);
  past = history.filter((row) => row.date !== todayDate);

  if (!today) {
    $('status').textContent = todayRes && todayRes.status === 503
      ? '오늘의 시를 가져오지 못했어요. 잠시 뒤에 다시 열어 주세요.'
      : '오늘의 시를 불러오지 못했어요.';
  }

  renderMembers(members);
  renderDeck();
  renderHistory();
}

// =====================================================================
//  Members + invite sheet
// =====================================================================
function renderMembers(members) {
  const names = members.map((m) => m.nickname || m.username || '');
  const shown = names.slice(0, 5);
  $('room-avs').innerHTML = shown.map(UI.avatar).join('') +
    (names.length > shown.length ? `<em>+${names.length - shown.length}</em>` : '');
  $('room-avs').setAttribute('aria-label', `멤버 ${names.length}명`);

  $('member-count').textContent = `${members.length}명`;
  $('member-list').innerHTML = members.map((m) => {
    const name = m.nickname || m.username || '';
    const tags = [];
    if (m.role === 'owner') tags.push('방장');
    if (me && m.id === me.id) tags.push('나');
    return `<div class="mem-row">${UI.avatar(name)}${esc(name)}<span>${tags.join(' · ')}</span></div>`;
  }).join('');

  drawRoomAction();
}

// Owner: delete the room. Member: leave it. Both ask once more, inline.
function drawRoomAction() {
  const row = $('room-actions-row');
  if (!room || !me) { row.innerHTML = ''; return; }
  const isOwner = room.owner_id === me.id;
  row.innerHTML = `<button type="button" class="leave" id="room-action">${isOwner ? '이 방 삭제하기' : '이 방 나가기'}</button>`;
  $('room-action').addEventListener('click', () => confirmRoomAction(isOwner));
}

function confirmRoomAction(isOwner) {
  const row = $('room-actions-row');
  row.innerHTML = `
    <div class="note-confirm">
      <span class="note-confirm-text">${isOwner
        ? '이 방을 삭제할까요? 모두의 메모가 함께 사라지고 되돌릴 수 없어요.'
        : '이 방에서 나갈까요?'}</span>
      <span class="note-confirm-actions">
        <button type="button" class="btn-sm btn-danger" id="room-confirm-yes">${isOwner ? '삭제' : '나가기'}</button>
        <button type="button" class="btn-sm" id="room-confirm-no">취소</button>
      </span>
    </div>`;
  $('room-confirm-no').addEventListener('click', drawRoomAction);
  $('room-confirm-yes').addEventListener('click', async () => {
    const id = encodeURIComponent(room.id);
    const path = isOwner ? `/api/rooms/${id}` : `/api/rooms/${id}/leave`;
    let ok = false;
    try {
      const res = await authFetch(path, { method: 'DELETE' });
      ok = res.ok || res.status === 204;
    } catch (err) { ok = false; }
    if (!ok) {
      UI.toast(isOwner ? '방을 삭제하지 못했어요' : '방에서 나가지 못했어요');
      drawRoomAction();
      return;
    }
    UI.closeSheets();
    UI.setLastRoom(null);
    UI.toast(isOwner ? '방을 삭제했어요' : '방에서 나왔어요');
    loadHome();
  });
}

// 공유 창이 없는 환경(대부분의 PC 브라우저)에선 공유하기가 복사와 똑같아서 숨긴다.
// 앱은 navigator.share가 늦게 생기므로 시트를 열 때와 페이지가 다 뜬 뒤에 다시 확인한다.
function syncShareButton() {
  $('invite-share').hidden = typeof navigator.share !== 'function';
}
syncShareButton();
window.addEventListener('load', syncShareButton);

$('invite-open').addEventListener('click', () => {
  drawRoomAction();              // reset a half-finished confirm
  syncShareButton();
  UI.openSheet('sheet-invite');
  UI.haptic();
});

$('invite-copy').addEventListener('click', async () => {
  const code = $('invite-code').textContent;
  try {
    await navigator.clipboard.writeText(code);
    UI.toast('초대 코드를 복사했어요');
  } catch (err) {
    // no clipboard permission: select the code so it can be copied by hand
    const range = document.createRange();
    range.selectNodeContents($('invite-code'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    UI.toast('코드를 길게 눌러 복사해 주세요');
  }
});

$('invite-share').addEventListener('click', async () => {
  const code = $('invite-code').textContent;
  const text = `${room.name}에서 같이 시 읽어요. Typoem 초대 코드: ${code}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Typoem', text }); } catch (err) { /* cancelled */ }
    return;
  }
  // no share sheet (most desktop browsers): copy the invitation text instead
  try {
    await navigator.clipboard.writeText(text);
    UI.toast('초대 문구를 복사했어요');
  } catch (err) {
    UI.toast(`초대 코드: ${code}`);
  }
});

// =====================================================================
//  Room list sheet: switch · join with a code · create
// =====================================================================
function renderRooms() {
  $('rooms-count').textContent = `${rooms.length}개`;
  $('rooms-list').innerHTML = rooms.map((r) => {
    const current = room && r.id === room.id;
    return `
      <button type="button" class="room-row" data-room-id="${esc(r.id)}"${current ? ' aria-current="true"' : ''}>
        <span class="sw" style="background:${UI.coverColor(r.id)}"></span>
        <span class="room-row-text"><b>${esc(r.name)}</b><small>멤버 ${esc(r.member_count)}명</small></span>
        <span class="chk"${current ? '' : ' hidden'} aria-hidden="true">✓</span>
      </button>`;
  }).join('');
}

// Sheet / dialog, or at 1024px+ a dropdown under the room name.
function openRooms() {
  const sheet = $('sheet-rooms');
  if (UI.isWide() && sheet.classList.contains('show')) {   // second click closes the dropdown
    UI.closeSheets();
    return;
  }
  $('join-code').value = '';
  UI.openSheet(sheet, { anchor: $('room-switch') });
  UI.haptic();
}

$('room-switch').addEventListener('click', openRooms);

// Crossing 1024px: the deck gains / loses its "+N" card.
UI.onWideChange(() => { if (room) renderDeck(); });
document.addEventListener('typoem:rooms', () => {
  if (rooms.length) openRooms();
});

$('rooms-list').addEventListener('click', (e) => {
  const row = e.target.closest('.room-row');
  if (!row) return;
  const next = rooms.find((r) => String(r.id) === row.dataset.roomId);
  UI.closeSheets();
  if (next && (!room || next.id !== room.id)) showRoom(next);
});

const joinInput = $('join-code');
joinInput.addEventListener('input', () => {
  joinInput.value = joinInput.value.toUpperCase();
});

$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = joinInput.value.trim().toUpperCase();
  if (code.length !== 6) {
    UI.toast('초대 코드 6자리를 입력해 주세요');
    return;
  }
  const btn = $('join-btn');
  btn.disabled = true;
  try {
    const res = await authFetch('/api/rooms/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code: code }),
    });
    if (!res.ok) {
      const messages = {
        404: '그 코드의 방을 찾지 못했어요',
        409: '이미 참여한 방이에요',
        403: '방에 더 참여할 수 없어요',
      };
      UI.toast(messages[res.status] || '방에 참여하지 못했어요');
      return;
    }
    const joined = await res.json();
    UI.closeSheets();
    UI.toast(`${joined.name}에 참여했어요`);
    await loadHome(joined.id);
  } catch (err) {
    UI.toast('네트워크 오류가 났어요. 다시 시도해 주세요');
  } finally {
    btn.disabled = false;
  }
});

// =====================================================================
//  Cover deck
// =====================================================================
function contributorText(row) {
  const n = row.contributor_count || 0;
  return n > 0 ? `${n}명 참여` : '메모 없음';
}

function coverHTML(item) {
  if (item.kind === 'more') {
    return `
      <div class="cover more" role="group" aria-label="지난 시 더보기">
        <b>+${item.count}</b>
        <em>지난 시 전체 보기</em>
      </div>`;
  }
  const p = item.poem;
  const title = p.title || 'Untitled';
  let kicker, foot;
  if (item.kind === 'today') {
    const notes = (today.memos || []).length + (today.annotations || []).length;
    kicker = `TODAY’S POEM · ${esc(UI.formatIsoDay(today.date).split(' ')[0])}`;
    foot = `<span>${notes ? `메모 ${notes}` : '메모 없음'}</span><span>읽기 →</span>`;
  } else {
    kicker = `${esc(UI.formatIsoDay(item.row.date))} · 지난 시`;
    foot = `<span>${contributorText(item.row)}</span>`;
  }
  return `
    <div class="cover" style="background:${UI.coverColor(p.id)}" role="group" aria-label="${esc(title)}">
      <span class="c-kicker">${kicker}</span>
      <span class="c-title${UI.titleSize(title)}">${meta(title)}</span>
      <span class="c-author">${meta(p.author)}</span>
      <span class="c-foot">${foot}</span>
    </div>`;
}

function renderDeckLoading() {
  deckItems = [];
  $('deck').innerHTML = '<div class="cover k0 cover-loading" aria-hidden="true"></div>';
  $('dots').innerHTML = '';
}

function renderDeck() {
  deckItems = [];
  if (today && today.poem) deckItems.push({ kind: 'today', poem: today.poem });
  past.slice(0, PAST_ON_DECK).forEach((row) => {
    deckItems.push({ kind: 'past', row, poem: { id: row.poem_id, title: row.title, author: row.author } });
  });
  // "+N" opens the full list; at 1024px+ the list is already on the page.
  if (past.length > PAST_ON_DECK && !UI.isWide()) deckItems.push({ kind: 'more', count: past.length - PAST_ON_DECK });

  const deck = $('deck');
  deck.innerHTML = deckItems.map(coverHTML).join('');
  $('dots').innerHTML = deckItems.length > 1
    ? deckItems.map((_, i) => `<button type="button" role="tab" aria-label="${i + 1}번째 표지" data-i="${i}"></button>`).join('')
    : '';
  deckIndex = 0;
  layoutDeck();
}

function covers() {
  return Array.prototype.slice.call($('deck').children);
}

// k0 = front cover, k1..k3 = the ones peeking out behind, gone = swiped away
function layoutDeck() {
  covers().forEach((c, i) => {
    const k = i - deckIndex;
    c.className = c.className.replace(/\s?(k\d|gone)\b/g, '') + (k < 0 ? ' gone' : ' k' + Math.min(k, 3));
    c.style.transform = '';
    c.setAttribute('aria-hidden', String(k !== 0));
  });
  document.querySelectorAll('#dots button').forEach((d, i) => {
    d.setAttribute('aria-current', String(i === deckIndex));
  });
}

function goTo(n) {
  n = Math.max(0, Math.min(deckItems.length - 1, n));
  if (n !== deckIndex) {
    deckIndex = n;
    UI.haptic();
  }
  layoutDeck();
}

function openCover(i) {
  const item = deckItems[i];
  if (!item) return;
  if (item.kind === 'more') {
    UI.openSheet('sheet-history');
    UI.haptic();
  } else if (item.kind === 'today') {
    openReader(covers()[i], today.poem);
  } else {
    openReader(covers()[i], item.poem, item.row.date);   // read-only past poem
  }
}

// Unfold: the tapped cover grows into the reading screen's top band, then the
// reading page (room.html) takes over with the same band already in place.
// date: a past day (YYYY-MM-DD) opens that poem read-only; omit it for today.
let opening = false;
function openReader(coverEl, p, date) {
  if (opening) return;
  const color = UI.coverColor(p.id);
  const url = `/room.html?id=${encodeURIComponent(room.id)}` + (date ? `&date=${encodeURIComponent(date)}` : '');
  // Today's poem is already here: hand it to the reading screen so it can draw
  // the poem at once instead of waiting for /today again (room.js takeHomeCopy).
  if (!date && today) {
    try {
      sessionStorage.setItem('typoem:today', JSON.stringify({ roomId: room.id, savedAt: Date.now(), data: today }));
    } catch (err) { /* storage full: the reader just loads it itself */ }
  }
  try {
    sessionStorage.setItem('typoem:open', JSON.stringify({
      roomId: room.id, roomName: room.name, color, title: p.title, author: p.author,
    }));
  } catch (err) { /* the reader just paints the band a moment later */ }

  UI.haptic();
  if (UI.reduceMotion || !coverEl || !coverEl.animate) {
    window.location.href = url;
    return;
  }
  opening = true;

  const cr = coverEl.getBoundingClientRect();
  const col = document.body.getBoundingClientRect();   // the centre column
  const morph = document.createElement('div');
  morph.className = 'morph';
  morph.style.background = color;
  // same height as .r-head on the reading screen
  morph.style.height = 'calc(var(--band-h) + var(--safe-top))';
  document.body.appendChild(morph);
  const bandHeight = morph.offsetHeight;

  const from = { left: cr.left + 'px', top: cr.top + 'px', width: cr.width + 'px', height: cr.height + 'px', borderRadius: '6px 12px 12px 6px' };
  const to = { left: col.left + 'px', top: '0px', width: col.width + 'px', height: bandHeight + 'px', borderRadius: '0px' };
  Object.assign(morph.style, from);

  window.TypoemNative.setStatusBar('light');
  const tabbar = $('tabbar');
  if (tabbar) tabbar.classList.add('away');
  UI.anim($('home'), [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 420 });
  UI.anim(morph, [from, to], { duration: 520 }).finished.then(() => {
    window.location.href = url;
  });
}

// Coming back with the browser's back button can restore this page from the
// back/forward cache mid-unfold: put everything back.
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  opening = false;
  document.querySelectorAll('.morph').forEach((m) => m.remove());
  const home = $('home');
  if (home.getAnimations) home.getAnimations().forEach((a) => a.cancel());
  const tabbar = $('tabbar');
  if (tabbar) tabbar.classList.remove('away');
  window.TypoemNative.setStatusBar('dark');
  if (room) showRoom(room);        // memo counts may have changed while reading
});

// Drag to turn: the cover follows the finger with a slight tilt;
// past 70px it goes to the next / previous cover.
(function wireDeck() {
  const deck = $('deck');
  let startX = 0, dx = 0, dragging = false, moved = false;

  deck.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.cover');
    if (!c || !c.classList.contains('k0') || deckItems.length < 2) return;
    dragging = true; moved = false; startX = e.clientX; dx = 0;
  });
  deck.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 6) {
      // a tap stays a click; only grab the pointer once it is really a drag
      moved = true;
      deck.classList.add('dragging');
      try { deck.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    }
    if (!moved) return;
    const c = covers()[deckIndex];
    const edge = (deckIndex === 0 && dx > 0) || (deckIndex === deckItems.length - 1 && dx < 0);
    const x = edge ? dx * 0.25 : dx;
    c.style.transform = `translateX(${x}px) rotate(${x * 0.03}deg)`;
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    deck.classList.remove('dragging');
    if (!moved) return;
    if (dx < -70) goTo(deckIndex + 1);
    else if (dx > 70) goTo(deckIndex - 1);
    else layoutDeck();
  }
  deck.addEventListener('pointerup', endDrag);
  deck.addEventListener('pointercancel', endDrag);

  deck.addEventListener('click', (e) => {
    if (moved) { moved = false; return; }   // the click that ends a drag
    const c = e.target.closest('.cover');
    if (!c) return;
    const i = covers().indexOf(c);
    if (i !== deckIndex) { goTo(i); return; }   // a cover behind comes to the front
    openCover(i);
  });
  deck.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') goTo(deckIndex + 1);
    else if (e.key === 'ArrowLeft') goTo(deckIndex - 1);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCover(deckIndex); }
  });
  $('dots').addEventListener('click', (e) => {
    const d = e.target.closest('button');
    if (d) goTo(Number(d.dataset.i));
  });
})();

// =====================================================================
//  Past poems sheet (date · title · author · who joined in)
// =====================================================================
function renderHistory() {
  $('h-count').textContent = past.length ? `${past.length}편` : '';
  if (!past.length) {
    $('h-list').innerHTML = '<p class="s-note">아직 지난 시가 없어요.</p>';
    return;
  }
  $('h-list').innerHTML = past.map((row, i) => {
    const names = row.contributors
      ? row.contributors.split(',').map((n) => esc(n.trim())).join(', ')
      : '';
    return `
      <button type="button" class="h-row" data-i="${i}">
        <span class="sw" style="background:${UI.coverColor(row.poem_id)}"></span>
        <span class="h-text"><b>${meta(row.title || 'Untitled')}</b><small>${meta(row.author)}</small>${names ? `<small class="h-names">${names}</small>` : ''}</span>
        <em>${esc(UI.formatIsoDay(row.date))}<br>${contributorText(row)}</em>
      </button>`;
  }).join('');
}

// A row opens that day's poem read-only (no unfold: the list is in a sheet).
$('h-list').addEventListener('click', (e) => {
  const rowEl = e.target.closest('.h-row');
  if (!rowEl) return;
  const row = past[Number(rowEl.dataset.i)];
  if (!row) return;
  openReader(null, { id: row.poem_id, title: row.title, author: row.author }, row.date);
});

// =====================================================================
//  Start
// =====================================================================
(async function start() {
  window.TypoemNative.setStatusBar('dark');   // dark status bar text on the paper background
  TypoemStreak.load();           // hides itself on 404
  await loadHome();
  // deep links from the tab bar / other pages
  if (window.location.hash === '#rooms' && rooms.length) openRooms();
  if (window.location.hash === '#history' && room) {
    if (UI.isWide()) $('sheet-history').scrollIntoView({ block: 'start' });
    else UI.openSheet('sheet-history');
  }
  if (window.location.hash) history.replaceState(null, '', window.location.pathname);
})();
