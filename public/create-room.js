// public/create-room.js
// Handles the create-room form. Mirrors login.js patterns.

requireLogin();

const form = document.getElementById('createForm');
const errorBox = document.getElementById('errorBox');
const submitBtn = document.getElementById('submitBtn');
const successBox = document.getElementById('successBox');
const inviteCode = document.getElementById('inviteCode');

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  hideError();

  const name = document.getElementById('name').value.trim();
  const description = document.getElementById('description').value.trim();

  if (name.length < 1 || name.length > 50) {
    showError('방 이름은 1~50자로 써 주세요.');
    return;
  }
  if (description.length > 200) {
    showError('소개는 200자까지 쓸 수 있어요.');
    return;
  }

  const body = { name };
  if (description) body.description = description;

  submitBtn.disabled = true;
  submitBtn.textContent = '만드는 중이에요…';

  try {
    const res = await authFetch('/api/rooms', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      // 403 = room limit reached (owned or joined)
      const e = new Error(res.status === 403
        ? '방을 더 만들 수 없어요. 가진 방 수가 한도에 닿았어요.'
        : '방을 만들지 못했어요.');
      e.isUserMessage = true;
      throw e;
    }

    const room = await res.json();

    // Show the invite code; hide the form
    form.classList.add('hidden');
    inviteCode.textContent = room.invite_code;
    successBox.classList.remove('hidden');

    // ---- Copy button ----
    const copyBtn = document.getElementById('copyBtn');
    const copyFeedback = document.getElementById('copyFeedback');

    copyBtn.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(room.invite_code);
      } catch (err) {
        const range = document.createRange();
        range.selectNodeContents(inviteCode);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
      }
      copyBtn.textContent = '복사했어요';
      copyFeedback.classList.remove('hidden');
      setTimeout(function () {
        copyBtn.textContent = '복사';
        copyFeedback.classList.add('hidden');
      }, 5000);
    });

  } catch (err) {
    console.error('Create room error:', err);
    successBox.classList.add('hidden');
    form.classList.remove('hidden');  
    showError(userMessage(err));
    submitBtn.disabled = false;
    submitBtn.textContent = '방 만들기';
  }
});


// Our own errors carry a Korean message; anything else (network, parse) is generic.
function userMessage(err) {
  return err && err.isUserMessage ? err.message : '문제가 생겼어요. 다시 시도해 주세요.';
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}