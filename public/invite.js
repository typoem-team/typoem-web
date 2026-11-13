// public/invite.js
// Invite sheet: the '+' next to the members on the home (index.html, [data-invite-room] =
// the home's room id) opens it. (The room header on 시 · 책 no longer opens it, 11/13.) Invite code (copy · share), members, and 방 삭제 (owner) / 나가기 (member).
// Moved here from the home screen: a room is where you invite people now.
//
// Data (asked for when the sheet opens):
//   GET    /api/rooms/mine         this room's invite_code and owner (skipped when the home
//                                  already has it in window.TypoemHomeRooms)
//   GET    /api/rooms/:id/members  members in join order
//   DELETE /api/rooms/:id (owner) · DELETE /api/rooms/:id/leave (member)
// Depends on auth.js, ui.js (TypoemUI, which draws the header's .r-room button).

(function () {
  'use strict';

  var UI = window.TypoemUI;
  var esc = UI.esc;
  var q = new URLSearchParams(window.location.search);
  var opener = document.querySelector('[data-invite-room]');   // the home's '+'
  if (!opener) return;
  // the home fills data-invite-room after it loads, so the id is read when the sheet opens
  var ROOM_ID = null;
  function currentRoomId() {
    return (opener.dataset && opener.dataset.inviteRoom) || q.get('id') || q.get('room');
  }

  var me = getCurrentUser();
  var room = null;            // { id, name, invite_code, owner_id } from /rooms/mine
  var sheet = null;
  function $(id) { return document.getElementById(id); }

  function build() {
    sheet = document.createElement('section');
    sheet.className = 'sheet';
    sheet.id = 'sheet-invite';
    sheet.dataset.wide = 'popover';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', '멤버 · 초대');
    sheet.innerHTML =
      '<span class="handle"></span>' +
      '<p class="s-title">친구 초대 <span id="invite-room"></span></p>' +
      '<div class="code-box"><small>초대 코드</small><p class="code" id="invite-code"></p></div>' +
      '<div class="sheet-actions">' +
        '<button type="button" class="sec" id="invite-copy">코드 복사</button>' +
        '<button type="button" class="pri" id="invite-share">공유하기</button>' +
      '</div>' +
      '<p class="s-title s-title-gap">멤버 <span id="member-count"></span></p>' +
      '<div id="member-list" aria-live="polite"></div>' +
      '<div id="room-actions-row" class="room-leave"></div>';
    document.body.appendChild(sheet);
    $('invite-copy').addEventListener('click', copyCode);
    $('invite-share').addEventListener('click', share);
  }

  // No share sheet (most desktop browsers): 공유하기 would just copy, so hide it.
  // In the app navigator.share appears late, so check again on open and after load.
  function syncShareButton() {
    if (sheet) $('invite-share').hidden = typeof navigator.share !== 'function';
  }
  window.addEventListener('load', syncShareButton);

  async function open() {
    var id = currentRoomId();
    if (!id) return;
    if (id !== ROOM_ID) { ROOM_ID = id; room = null; }
    if (!sheet) build();
    if (UI.isWide() && sheet.classList.contains('show')) { UI.closeSheets(); return; }  // second click closes the popover
    syncShareButton();
    if (!room) {
      $('invite-code').textContent = '…';
      $('member-list').innerHTML = '<p class="s-note">불러오는 중이에요…</p>';
    }
    UI.openSheet(sheet, { anchor: opener });
    UI.haptic();
    await load();
  }

  function findRoom(rooms) {
    return (Array.isArray(rooms) ? rooms : []).find(function (r) { return String(r.id) === String(ROOM_ID); }) || null;
  }

  async function load() {
    // the home already loaded /rooms/mine (index.js -> window.TypoemHomeRooms); ask again only without it
    var known = findRoom(window.TypoemHomeRooms);
    var roomsRes, membersRes;
    try {
      var id = encodeURIComponent(ROOM_ID);
      [roomsRes, membersRes] = await Promise.all([
        known ? null : authFetch('/api/rooms/mine'),
        authFetch('/api/rooms/' + id + '/members'),
      ]);
    } catch (err) {
      $('member-list').innerHTML = '<p class="s-note">네트워크에 연결할 수 없어요. 다시 열어 주세요.</p>';
      return;
    }
    room = known || findRoom(roomsRes.ok ? await roomsRes.json() : []);
    if (!room || !membersRes.ok) {
      $('invite-code').textContent = '';
      $('member-list').innerHTML = '<p class="s-note">방 정보를 불러오지 못했어요.</p>';
      $('room-actions-row').innerHTML = '';
      return;
    }
    // textContent: the room name and code are user / server data
    $('invite-room').textContent = room.name;
    $('invite-code').textContent = room.invite_code || '';
    renderMembers(await membersRes.json());
  }

  function renderMembers(members) {
    $('member-count').textContent = members.length + '명';
    $('member-list').innerHTML = members.map(function (m) {
      var name = m.nickname || m.username || '';
      var tags = [];
      if (m.role === 'owner') tags.push('방장');
      if (me && m.id === me.id) tags.push('나');
      return '<div class="mem-row">' + UI.avatar(name) + esc(name) + '<span>' + tags.join(' · ') + '</span></div>';
    }).join('');
    drawRoomAction();
  }

  // Owner: delete the room. Member: leave it. Both ask once more, inline.
  function drawRoomAction() {
    var row = $('room-actions-row');
    if (!room || !me) { row.innerHTML = ''; return; }
    var isOwner = room.owner_id === me.id;
    row.innerHTML = '<button type="button" class="leave" id="room-action">' + (isOwner ? '이 방 삭제하기' : '이 방 나가기') + '</button>';
    $('room-action').addEventListener('click', function () { confirmRoomAction(isOwner); });
  }

  function confirmRoomAction(isOwner) {
    var row = $('room-actions-row');
    row.innerHTML =
      '<div class="note-confirm">' +
        '<span class="note-confirm-text">' + (isOwner
          ? '이 방을 삭제할까요? 모두의 메모가 함께 사라지고 되돌릴 수 없어요.'
          : '이 방에서 나갈까요?') + '</span>' +
        '<span class="note-confirm-actions">' +
          '<button type="button" class="btn-sm btn-danger" id="room-confirm-yes">' + (isOwner ? '삭제' : '나가기') + '</button>' +
          '<button type="button" class="btn-sm" id="room-confirm-no">취소</button>' +
        '</span>' +
      '</div>';
    $('room-confirm-no').addEventListener('click', drawRoomAction);
    $('room-confirm-yes').addEventListener('click', async function () {
      var id = encodeURIComponent(room.id);
      var ok = false;
      try {
        var res = await authFetch(isOwner ? '/api/rooms/' + id : '/api/rooms/' + id + '/leave', { method: 'DELETE' });
        ok = res.ok || res.status === 204;
      } catch (err) { ok = false; }
      if (!ok) {
        UI.toast(isOwner ? '방을 삭제하지 못했어요' : '방에서 나가지 못했어요');
        drawRoomAction();
        return;
      }
      UI.toast(isOwner ? '방을 삭제했어요' : '방에서 나왔어요');
      window.location.href = '/rooms.html';   // this room is gone for me
    });
  }

  async function copyCode() {
    var code = $('invite-code').textContent;
    try {
      await navigator.clipboard.writeText(code);
      UI.toast('초대 코드를 복사했어요');
    } catch (err) {
      // no clipboard permission: select the code so it can be copied by hand
      var range = document.createRange();
      range.selectNodeContents($('invite-code'));
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      UI.toast('코드를 길게 눌러 복사해 주세요');
    }
  }

  async function share() {
    if (!room) return;
    var code = $('invite-code').textContent;
    var text = '‘' + room.name + '’에서 매일 시 한 편과 책 한 권을 같이 읽어요. Typoem 초대 코드: ' + code;
    if (navigator.share) {
      try { await navigator.share({ title: 'Typoem', text: text }); } catch (err) { /* cancelled */ }
      return;
    }
    // no share sheet: copy the invitation text instead
    try {
      await navigator.clipboard.writeText(text);
      UI.toast('초대 문구를 복사했어요');
    } catch (err) {
      UI.toast('초대 코드: ' + code);
    }
  }

  opener.addEventListener('click', open);
})();
