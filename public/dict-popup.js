// public/dict-popup.js
// Dictionary — double-tap (double-click) a word and its entry opens: a bottom sheet on phones, a
// dialog on tablets, and at 1024px+ a popover next to the word (it flips above
// the word when there is no room below; Esc or a click outside closes it).
// The markup is the same in all three; ui.js and CSS decide the look.
// Exposes window.openDictionary(word, anchorEl).
//
// The lookup logic (retries, latest-lookup-wins, saving to the notebook) is
// unchanged; only the shell moved from a floating popup to a sheet.
//
// Depends on:
//   - auth.js  -> authFetch()  (the route is auth-protected)
//   - ui.js    -> TypoemUI.openSheet / closeSheets / haptic
//   - room.js  -> renders <span class="word" data-word="..."> in the poem body

(function () {
  // ---- Build the sheet once and reuse it ----
  let popup = null;
  let popupBody = null;
  let activeWordEl = null;
  let currentEntry = null; 

  const UI = window.TypoemUI;

  function ensurePopup() {
    if (popup) return;

    popup = document.createElement('section');
    // "dict-popup" is kept for book.js, which asks `.dict-popup` + `hidden`
    // whether the dictionary is open before it turns a page.
    popup.className = 'sheet dict-popup';
    popup.id = 'sheet-dict';
    popup.dataset.wide = 'popover';
    popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', '사전');

    popup.innerHTML = `
      <span class="handle"></span>
      <p class="d-word"><span id="dict-popup-word"></span><small id="dict-popup-phonetic"></small></p>
      <div class="dict-popup-body" id="dict-popup-body"></div>
      <div class="sheet-actions">
        <button type="button" class="sec" data-close>닫기</button>
        <button type="button" class="pri" id="dict-popup-save" hidden>단어장에 담기</button>
      </div>
    `;

    document.body.appendChild(popup);
    popupBody = popup.querySelector('#dict-popup-body');

    // Save button — store the looked-up word in the personal notebook
    popup.querySelector('#dict-popup-save').addEventListener('click', saveCurrentWord);

    // ui.js closes the sheet (scrim, handle, 닫기, Escape, Android back);
    // tidy up our own state when that happens.
    popup.addEventListener('sheet:close', onClosed);
  }

  function isOpen() {
    return !!popup && popup.classList.contains('show');
  }

  // ---- Escape text before inserting into HTML (XSS guard) ----
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  let hideTimer = null;

  function onClosed() {
    lookupSeq++;            // drop a lookup that is still on its way
    // take it out of the page once the closing transition is over
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!isOpen()) popup.hidden = true; }, 500);
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
    btn.textContent = '단어장에 담기';
  }

  // Store the current word in the personal notebook: the Korean meanings when there are
  // any, otherwise the first English definition (with its part of speech).
  async function saveCurrentWord() {
    if (!currentEntry || !currentEntry.word) return;
    const btn = saveButtonEl();
    const defs = Array.isArray(currentEntry.definitions) ? currentEntry.definitions : [];
    const ko = (Array.isArray(currentEntry.ko) ? currentEntry.ko : []).slice(0, 4).map((e) => ({
      pos: e.pos || '',
      ko: (e.ko || []).slice(0, 3),
      own: !!e.own,
    }));
    // English only when the word has no Korean meaning
    const hasKo = ko.length > 0;
    const definition = hasKo ? '' : ((defs[0] && defs[0].definition) || '');
    const definition_pos = hasKo ? null : ((defs[0] && defs[0].definition && defs[0].partOfSpeech) || null);
    if (!definition && !hasKo) return;

    if (btn) btn.disabled = true;

    try {
      const res = await authFetch('/api/vocab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: currentEntry.word,
          phonetic: currentEntry.phonetic || null,
          definition,
          definition_pos,
          ko,
        }),
      });

      if (res.ok || res.status === 201) {
        if (btn) {
          btn.textContent = '단어장에 담았어요';   // stays until the next word
          UI.haptic();
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

// The data keeps up to three meanings per part of speech, and a meaning can itself hold
  // several ' / '-separated parts. Show each one on its own line (at most 5 per entry).
  function koSenses(entry) {
    return (entry.ko || [])
      .flatMap((g) => String(g).split(' / '))
      .map((t) => t.replace(/\s*;\s*/g, ', ').trim())   // ";" looks like a glitch: show ","
      .filter(Boolean)
      .slice(0, 5);
  }

  // ---- Render the slim API payload { word, phonetic, definitions[], ko[], koFrom } ----
  function renderEntry(data) {
    currentEntry = data || null;
    document.getElementById('dict-popup-word').textContent = data.word || '';
    document.getElementById('dict-popup-phonetic').textContent = data.phonetic || '';

    let html = '';

    const defs = Array.isArray(data.definitions) ? data.definitions : [];
    const ko = Array.isArray(data.ko) ? data.ko : [];

    // Korean meanings first (at most 4 entries), then the English definitions.
    if (ko.length > 0) {
      if (data.koFrom) {
        html += `<p class="d-ko-from">${escapeHtml(data.koFrom)}의 뜻</p>`;
      }
      html += '<ul class="dict-ko-list">';
      for (const e of ko.slice(0, 4)) {
        const pos = e.pos ? `<span class="d-pos">${escapeHtml(e.pos)}</span>` : '';
        const senses = koSenses(e);
        if (senses.length > 1) {
          // several meanings: part-of-speech chip, then one numbered line per meaning
          html += `<li class="d-ko-entry">${pos}<ol class="d-ko-senses">`
            + senses.map((t) => `<li>${escapeHtml(t)}</li>`).join('')
            + '</ol></li>';
        } else {
          html += `<li class="d-ko-entry">${pos} ${escapeHtml(senses[0] || '')}</li>`;
        }
      }
      html += '</ul>';
      // The Wiktionary credit is shown only when a Wiktionary meaning is on screen;
      // the hand-written archaic meanings (own) get no credit line.
      const shown = ko.slice(0, 4);
      if (shown.some((e) => !e.own)) {
        html += '<p class="d-ko-src">뜻 출처: 위키낱말사전 (CC BY-SA 4.0)</p>';
      }
    }

    if (defs.length === 0 && ko.length === 0) {
      html += `<p class="dict-empty">뜻을 찾지 못했어요.</p>`;
      hideSaveButton();
    } else {
      if (defs.length > 0) {
        if (ko.length > 0) html += '<p class="d-en-label">English</p>';
        html += '<ol class="dict-def-list">';
        for (const d of defs) {
          const pos = d.partOfSpeech
            ? `<span class="d-pos">${escapeHtml(d.partOfSpeech)}</span> `
            : '';
          const ex = d.example
            ? `<span class="d-ex">${escapeHtml(d.example)}</span>`
            : '';
          html += `<li>${pos}${escapeHtml(d.definition)}${ex}</li>`;
        }
        html += '</ol>';
      }
      showSaveButton();
    }
    setBody(html);
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

    // Mark the tapped word while its entry is open
    if (activeWordEl) activeWordEl.classList.remove('active');
    activeWordEl = anchorEl || null;
    if (activeWordEl) activeWordEl.classList.add('active');
    
    document.getElementById('dict-popup-word').textContent = word;
    document.getElementById('dict-popup-phonetic').textContent = '';
    currentEntry = null;
    hideSaveButton();
    setBody('<p class="dict-loading">찾는 중이에요&hellip;</p>');
    const wasOpen = isOpen();
    clearTimeout(hideTimer);
    popup.hidden = false;
    void popup.offsetWidth;    // lay it out first so the opening transition runs
    // (re)attach to the tapped word: the popover follows it, a sheet ignores it
    UI.openSheet(popup, { anchor: anchorEl });
    if (!wasOpen) UI.haptic();

    const seq = ++lookupSeq;
    let res;
    try {
      res = await fetchEntry(word);
    } catch (err) {
      if (seq !== lookupSeq) return;
      setBody('<p class="dict-error">사전에 연결하지 못했어요. 다시 눌러 주세요.</p>');
      return;
    }
    // The user tapped another word (or closed the popup) while we were retrying.
    if (seq !== lookupSeq || !isOpen()) return;

    // authFetch handles 401 (logout + redirect); handle the rest here.
    if (res.status === 404) {
      setBody('<p class="dict-error">이 단어는 사전에 없어요.</p>');
      return;
    }
    if (!res.ok) {
      setBody('<p class="dict-error">지금은 사전을 쓸 수 없어요.</p>');
      return;
    }

    const data = await res.json();
    if (seq !== lookupSeq || !isOpen()) return;
    renderEntry(data);
    UI.placePopover(popup);    // the entry changed the height: flip above the word if needed
  }

  // Expose globally so room.js / P13 can trigger a lookup directly if needed.
  window.openDictionary = openDictionary;

  // ---- Event delegation: a DOUBLE tap / double click on any .word span ----
  // Works even though the poem is rendered after this script runs.
  // Detected from two clicks on the same word (not the dblclick event), so it
  // works the same with a mouse, on phones and in the Android WebView.
  // A single tap leaves the word free for other things (book marks: the marks
  // list, see marks.js, which uses the same window).
  const DOUBLE_TAP_MS = 350;
  let lastTap = null;   // { el, t }

  document.addEventListener('click', (e) => {
    const wordEl = e.target.closest('.word');
    if (!wordEl) { lastTap = null; return; }
    const now = Date.now();
    if (lastTap && lastTap.el === wordEl && now - lastTap.t <= DOUBLE_TAP_MS) {
      lastTap = null;
      e.preventDefault();
      const word = wordEl.dataset.word || wordEl.textContent;
      openDictionary(word, wordEl);
      return;
    }
    lastTap = { el: wordEl, t: now };
  });

  // A double click would also select the word's text (poem page); keep it clean.
  document.addEventListener('mousedown', (e) => {
    if (e.detail > 1 && e.target.closest && e.target.closest('.word')) e.preventDefault();
  });

  window.TypoemDict = { DOUBLE_TAP_MS };
})();