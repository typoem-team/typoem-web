// public/vocab.js
// Personal vocabulary notebook — lists the words the current user has saved.

// Guard: redirect to login if there is no token
requireLogin();

// The date line, tab bar and log out live in ui.js.

// ---- Escape user-provided text before inserting into HTML (XSS guard) ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ---- Korean meanings of a saved word (same look as the dictionary popup) ----
function vocabKoBlock(ko) {
  if (!Array.isArray(ko) || ko.length === 0) return '';
  let html = '<ul class="dict-ko-list vocab-ko">';
  for (const e of ko.slice(0, 4)) {
    const pos = e.pos ? `<span class="d-pos">${escapeHtml(e.pos)}</span>` : '';
    const senses = TypoemUI.koSenses(e);
    if (senses.length > 1) {
      html += `<li class="d-ko-entry">${pos}<ol class="d-ko-senses">`
        + senses.map((t) => `<li>${TypoemUI.koHtml(t)}</li>`).join('')
        + '</ol></li>';
    } else {
      html += `<li class="d-ko-entry">${pos} ${TypoemUI.koHtml(senses[0] || '')}</li>`;
    }
  }
  return html + '</ul>';
}

// ---- Build one vocabulary card ----
function vocabCard(v) {
  // Korean meanings win: a word saved with both (older saves) shows only the Korean
  const hasKo = Array.isArray(v.ko) && v.ko.length > 0;
  const phon = v.phonetic
    ? `<span class="vocab-phon">${escapeHtml(v.phonetic)}</span>`
    : '';
  return `
    <article class="vocab-card" data-vocab-id="${encodeURIComponent(v.id)}">
      <h2 class="vocab-word">${escapeHtml(v.word)} ${phon}</h2>
      ${vocabKoBlock(v.ko)}
      ${v.definition && !hasKo ? `<p class="vocab-def">${v.definition_pos ? `<span class="d-pos">${escapeHtml(v.definition_pos)}</span> ` : ''}${escapeHtml(v.definition)}</p>` : ''}
      <button type="button" class="link-btn" data-vocab-del="${encodeURIComponent(v.id)}">삭제</button>
    </article>
  `;
}

// ---- Load saved words from the API ----
async function loadVocab() {
  const status = document.getElementById('status');
  const list = document.getElementById('vocab-list');
  const empty = document.getElementById('empty-state');

  status.textContent = '불러오는 중…';
  empty.hidden = true;

  try {
    const res = await authFetch('/api/vocab');

    // authFetch already handles 401 (logout + redirect); handle the rest here
    if (!res.ok) {
      status.textContent = '단어장을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
      return;
    }

    words = await res.json();
    status.textContent = '';

    if (!Array.isArray(words) || words.length === 0) {
      words = [];
      list.innerHTML = '';
      empty.hidden = false;
      sortBar.hidden = true;
      TypoemTour.run('vocab-empty', [
        { el: '#empty-state', text: {
          touch: '시나 책에서 단어를 두 번 톡톡 누르고 “단어장에 담기”를 누르면 여기에 모여요.',
          mouse: '시나 책에서 단어를 더블클릭하고 “단어장에 담기”를 누르면 여기에 모여요.',
        } },
      ]);
      return;
    }

    sortBar.hidden = false;
    renderList();
    TypoemTour.run('vocab', [
      { el: '#vocab-list > :first-child', text: '시와 책에서 담은 단어가 여기 모여요.' },
      { el: '#vocab-sort', text: '최근에 담은 순서나 A–Z 순서로 볼 수 있어요.' },
    ]);
  } catch (err) {
    console.error(err);
    status.textContent = '네트워크에 연결할 수 없어요. 다시 시도해 주세요.';
  }
}

// ---- Draw the cards in the chosen order ----
function renderList() {
  const list = document.getElementById('vocab-list');
  // the server sends newest first; A–Z ignores case
  const shown = sortBy === 'az'
    ? words.slice().sort((a, b) => String(a.word).localeCompare(String(b.word), 'en', { sensitivity: 'base' }))
    : words;
  list.innerHTML = shown.map(vocabCard).join('');

  // CC BY-SA: credit Wiktionary whenever one of its meanings is on screen
  // (the team's own hand-written meanings are marked own and need no credit).
  const usesWiktionary = words.some((w) => Array.isArray(w.ko) && w.ko.some((e) => !e.own));
  if (usesWiktionary) {
    list.insertAdjacentHTML('beforeend',
      '<p class="d-ko-src vocab-src">한국어 뜻 출처: 위키낱말사전 (CC BY-SA 4.0)</p>');
  }
}

// ---- Sort: 최근 저장 / A–Z (remembered on this device) ----
const SORT_KEY = 'typoem:vocabSort';
const sortBar = document.getElementById('vocab-sort');
let words = [];
let sortBy = 'recent';
try { if (localStorage.getItem(SORT_KEY) === 'az') sortBy = 'az'; } catch (e) { /* storage may be unavailable */ }

function drawSortBar() {
  sortBar.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.sort === sortBy));
  });
}
drawSortBar();

sortBar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sort]');
  if (!btn || btn.dataset.sort === sortBy) return;
  sortBy = btn.dataset.sort;
  try { localStorage.setItem(SORT_KEY, sortBy); } catch (err) { /* this visit only */ }
  drawSortBar();
  renderList();
});

// ---- Delete via event delegation (cards are rendered after this runs) ----
document.getElementById('vocab-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-vocab-del]');
  if (!btn) return;

  const id = btn.dataset.vocabDel;
  btn.disabled = true;

  try {
    const res = await authFetch(`/api/vocab/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      TypoemUI.toast('단어를 삭제했어요');
      loadVocab();
    } else {
      TypoemUI.toast('단어를 삭제하지 못했어요');
      btn.disabled = false;
    }
  } catch (err) {
    console.error(err);
    TypoemUI.toast('단어를 삭제하지 못했어요');
    btn.disabled = false;
  }
});

loadVocab();
