// public/join.js
// Handles the join-room form. Mirrors login.js / create-room.js patterns.

requireLogin();

const form = document.getElementById('joinForm');
const errorBox = document.getElementById('errorBox');
const submitBtn = document.getElementById('submitBtn');
const codeInput = document.getElementById('invite_code');

backToPrevious(document.getElementById('backLink'));

// Force uppercase as the user types (invite codes are uppercase)
codeInput.addEventListener('input', function () {
  codeInput.value = codeInput.value.toUpperCase();
});

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  hideError();

  const code = codeInput.value.trim().toUpperCase();

  if (code.length !== 6) {
    showError('초대 코드 6자리를 입력해 주세요.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '참여하는 중이에요…';

  try {
    const res = await authFetch('/api/rooms/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code: code })
    });

    if (!res.ok) {
      // 404 -> no such room, 409 -> already a member, 403 -> room limit reached (MAX_JOINED_ROOMS in roomsController)
      const messages = {
        404: '이 코드로 들어갈 수 있는 방이 없어요. 코드를 다시 확인해 주세요.',
        409: '이미 참여한 방이에요.',
        403: '방은 최대 5개까지 참여할 수 있어요.',
      };
      const e = new Error(messages[res.status] || '방에 참여하지 못했어요.');
      e.isUserMessage = true;
      throw e;
    }

    // Joined -> straight to that room's home
    const room = await res.json();
    window.location.href = '/index.html?room=' + encodeURIComponent(room.id);

  } catch (err) {
    console.error('Join room error:', err);
    showError(authErrorMessage(err));
    submitBtn.disabled = false;
    submitBtn.textContent = '참여';
  }
});


function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}