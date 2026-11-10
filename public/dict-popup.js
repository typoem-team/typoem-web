// public/dict-popup.js
// P12 — Dictionary popup.
// Shows a small in-app popup for a word. Exposes window.openDictionary(word).
//
// Depends on:
//   - auth.js  -> authFetch()  (added in a later commit; the route is auth-protected)
//   - room.js  -> renders <span class="word" data-word="..."> in the poem body

(function () {
  // ---- Build the popup shell once and reuse it ----
  let popup = null;
  let popupBody = null;
  let activeWordEl = null;
  let currentEntry = null; 

  function ensurePopup() {
    if (popup) return;

    popup = document.createElement('div');
    popup.className = 'dict-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Dictionary');
    popup.hidden = true;

    popup.innerHTML = `
      <div class="dict-popup-head">
        <h4 class="dict-popup-word" id="dict-popup-word"></h4>
        <button type="button" class="link-btn dict-popup-save" id="dict-popup-save" hidden>Save</button>
        <button type="button" class="link-btn dict-popup-close" aria-label="Close">&times;</button>
      </div>
      <div class="dict-popup-body" id="dict-popup-body"></div>
    `;

    document.body.appendChild(popup);
    popupBody = popup.querySelector('#dict-popup-body');

    // Close button
    popup.querySelector('.dict-popup-close').addEventListener('click', closeDictionary);

    // Save button — store the looked-up word in the personal notebook
    popup.querySelector('#dict-popup-save').addEventListener('click', saveCurrentWord);

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !popup.hidden) closeDictionary();
    });

    // Close when clicking outside the popup (but not on a .word, which reopens it)
    document.addEventListener('click', (e) => {
      if (popup.hidden) return;
      if (popup.contains(e.target)) return;
      if (e.target.closest('.word')) return;
      closeDictionary();
    });
  }

  // ---- Escape text before inserting into HTML (XSS guard) ----
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function closeDictionary() {
    if (popup) popup.hidden = true;
    hideSaveButton();
    currentEntry = null;
    if (activeWordEl) {
      activeWordEl.classList.remove('active');
      activeWordEl = null;
    }
  }

  // ---- Save button helpers ----
  function saveButtonEl() {
    return popup ? popup.querySelector('#dict-popup-save') : null;
  }

  function hideSaveButton() {
    const btn = saveButtonEl();
    if (btn) btn.hidden = true;
  }

  function showSaveButton() {
    const btn = saveButtonEl();
    if (!btn) return;
    btn.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Save';
  }

  // Store the first definition of the current word in the personal notebook.
  async function saveCurrentWord() {
    if (!currentEntry || !currentEntry.word) return;
    const btn = saveButtonEl();
    const defs = Array.isArray(currentEntry.definitions) ? currentEntry.definitions : [];
    const definition = (defs[0] && defs[0].definition) || '';
    if (!definition) return;

    if (btn) btn.disabled = true;

    try {
      const res = await authFetch('/api/vocab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: currentEntry.word,
          phonetic: currentEntry.phonetic || null,
          definition,
        }),
      });

      if (res.ok || res.status === 201) {
        if (btn) {
          btn.textContent = 'Saved \u2713';
          setTimeout(() => {
            const b = saveButtonEl();
            if (b && !popup.hidden) { b.textContent = 'Save'; b.disabled = false; }
          }, 5000);
        }
      } else if (btn) {
        btn.disabled = false;
      }
    } catch (err) {
      console.error(err);
      if (btn) btn.disabled = false;
    }
  }

  function setBody(html) {
    popupBody.innerHTML = html;
  }

// ---- Render the slim API payload { word, phonetic, definitions[] } ----
  function renderEntry(data) {
    currentEntry = data || null;
    document.getElementById('dict-popup-word').textContent = data.word || '';

    let html = '';
    if (data.phonetic) {
      html += `<p class="dict-phonetic">${escapeHtml(data.phonetic)}</p>`;
    }

    const defs = Array.isArray(data.definitions) ? data.definitions : [];
    if (defs.length === 0) {
      html += `<p class="dict-empty">No definition available.</p>`;
      hideSaveButton();
    } else {
      html += '<ol class="dict-def-list">';
      for (const d of defs) {
        const pos = d.partOfSpeech
          ? `<span class="dict-pos">${escapeHtml(d.partOfSpeech)}</span> `
          : '';
        const ex = d.example
          ? `<span class="dict-example">&ldquo;${escapeHtml(d.example)}&rdquo;</span>`
          : '';
        html += `<li>${pos}${escapeHtml(d.definition)}${ex ? '<br>' + ex : ''}</li>`;
      }
      html += '</ol>';
      showSaveButton();
    }
    setBody(html);
  }

  // Position the popup near the clicked word — below it by default,
  // but above it when there isn't enough room below.
  function positionPopup(anchorEl) {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const gap = 6;
    const popupHeight = popup.offsetHeight || 240;
    const popupWidth = popup.offsetWidth || 380;
    const viewportH = document.documentElement.clientHeight;

    // Vertical: flip above the word if it would overflow the bottom.
    const spaceBelow = viewportH - rect.bottom;
    let top;
    if (spaceBelow < popupHeight + gap && rect.top > popupHeight + gap) {
      top = rect.top + window.scrollY - popupHeight - gap;   // above
    } else {
      top = rect.bottom + window.scrollY + gap;              // below
    }

    // Horizontal: keep it within the viewport.
    let left = rect.left + window.scrollX;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - popupWidth - 12;
    if (left > maxLeft) left = maxLeft;
    if (left < window.scrollX + 12) left = window.scrollX + 12;

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  }


  // ---- Fetch with retries ----
  // The first lookup of a new word makes the server call the free dictionary API,
  // which is sometimes slow and makes the server answer 5xx. Retry quietly while
  // "Looking up…" stays on screen, so a one-off hiccup never reaches the user.
  const RETRY_DELAYS_MS = [800, 2000];   // up to 2 retries
  let lookupSeq = 0;                     // latest lookup wins

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchEntry(word) {
    const url = `/api/dictionary/${encodeURIComponent(word)}`;
    for (let attempt = 0; ; attempt++) {
      let res = null;
      try {
        res = await authFetch(url);
      } catch (err) {
        // network error: retry below, rethrow on the last attempt
        if (attempt >= RETRY_DELAYS_MS.length) throw err;
      }
      const retryable = !res || res.status >= 500;
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) return res;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }

  // ---- Public: look a word up and show the popup ----
  async function openDictionary(rawWord, anchorEl) {
    const word = String(rawWord || '').toLowerCase().trim();
    if (!word) return;

    ensurePopup();

    // Mark the clicked word as active (same styling as :hover)
    if (activeWordEl) activeWordEl.classList.remove('active');
    activeWordEl = anchorEl || null;
    if (activeWordEl) activeWordEl.classList.add('active');
    
    document.getElementById('dict-popup-word').textContent = word;
    currentEntry = null;
    hideSaveButton();
    setBody('<p class="dict-loading">Looking up&hellip;</p>');
    popup.hidden = false;
    positionPopup(anchorEl);

    const seq = ++lookupSeq;
    let res;
    try {
      res = await fetchEntry(word);
    } catch (err) {
      if (seq !== lookupSeq) return;
      setBody('<p class="dict-error">Could not reach the dictionary. Try again.</p>');
      return;
    }
    // The user tapped another word (or closed the popup) while we were retrying.
    if (seq !== lookupSeq || popup.hidden) return;

    // authFetch handles 401 (logout + redirect); handle the rest here.
    if (res.status === 404) {
      setBody('<p class="dict-error">No entry found for this word.</p>');
      return;
    }
    if (!res.ok) {
      setBody('<p class="dict-error">The dictionary is unavailable right now.</p>');
      return;
    }

    const data = await res.json();
    renderEntry(data);
    positionPopup(anchorEl);   // re-position now that the popup has its full height
  }

  // Expose globally so room.js / P13 can trigger a lookup directly if needed.
  window.openDictionary = openDictionary;

  // ---- Event delegation: one listener catches clicks on any .word span ----
  // Works even though the poem is rendered after this script runs.
  document.addEventListener('click', (e) => {
    const wordEl = e.target.closest('.word');
    if (!wordEl) return;
    e.preventDefault();
    const word = wordEl.dataset.word || wordEl.textContent;
    openDictionary(word, wordEl);
  });
})();