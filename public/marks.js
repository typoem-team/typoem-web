// public/marks.js
// Highlights (4 colours) and notes on a word range — shared by the book reader
// (book.js) and, later, the poem screen. Exposes window.TypoemMarks.attach(opts).
//
// Depends on:
//   - auth.js       -> getCurrentUser()  (which marks are mine)
//   - ui.js         -> TypoemUI.openSheet / closeSheets / toast / haptic / avatar / esc
//   - dict-popup.js -> opens the dictionary on a double tap; TypoemDict.DOUBLE_TAP_MS
//
// The screen renders its text as "units" (book: one <p> per paragraph; poem: one
// line) whose words are <span class="word" data-w="N"> (N = 0-based position of the
// word inside its unit). A position is [unitKey, wordIndex]; unitKey must grow in
// DOM order (book: paragraph idx, poem: line number).
//
//   const marks = TypoemMarks.attach({
//     container,        element holding the units (marks are drawn inside it)
//     unitSelector,     CSS selector of a unit inside container
//     unitKey(unitEl),  -> number
//     rangeOf(row),     a stored mark -> { start: [key, w], end: [key, w] }
//     context(),        optional: captured when a selection starts, passed to create()
//     create({ kind, color, content, start, end, quote, ctx }) -> Promise<row>  (throws Error(message))
//     update(row, content) -> Promise<row>
//     remove(row)          -> Promise
//     changed({ type: 'create' | 'update' | 'delete', row })  the screen updates its list and calls set()
//     clip,             optional: element whose box is the visible area (default: the window)
//     keepSelection,    optional: selector of controls that don't end a selection (page turns)
//     selectable,       optional: false = no new selections (marks are still drawn and
//                       listed, and my own can still be edited / deleted). Poem: a past day.
//   });
//   marks.set(rows)   show these marks (the screen owns the list)
//   marks.refresh()   re-measure after the text moved (re-layout, resize)
//   marks.reposition() the text scrolled / paged: move the toolbar
//   marks.reset()     new text: drop the selection and the marks
//   marks.cancel()    end the selection (true if there was one)
//
// Gestures (no browser text selection — same on the web and in the Android app):
//   double tap on a word         dictionary (dict-popup.js)
//   single tap on a marked word  the marks list (after the double-tap window)
//   long press (~400ms) a word   starts a selection (haptic); dragging extends it
//   mouse drag across words      the same selection, snapped to whole words
//   tap a word while selecting   moves the end of the range (start/end are put in order)
//   tap elsewhere / Esc          ends the selection
//
// Drawing: marks and the selection are absolutely positioned boxes in a layer at
// the back of the container (one box per line), so they can never change line
// breaks or page counts. Overlapping translucent boxes blend on their own.

(function () {
  'use strict';

  var UI = window.TypoemUI;
  var esc = UI.esc;

  var COLORS = [
    { key: 'yellow', label: '노란색' },
    { key: 'pink', label: '분홍색' },
    { key: 'blue', label: '파란색' },
    { key: 'green', label: '초록색' },
  ];
  var COLOR_KEYS = COLORS.map(function (c) { return c.key; });
  var LONG_PRESS_MS = 400;
  var TOUCH_SLOP_PX = 10;      // moving this far before the long press fires = a swipe / scroll
  var MOUSE_DRAG_PX = 5;
  var NOTE_MAX = 500;
  var QUOTE_MAX = 1000;
  var CLICK_GUARD_MS = 600;    // a click right after a selection gesture is part of it

  function cmp(a, b) { return a[0] - b[0] || a[1] - b[1]; }

  function me() {
    return typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  }

  // ---- "오늘 / 어제 / N일 전" in Asia/Seoul; created_at is UTC 'YYYY-MM-DD HH:MM:SS' ----
  var seoulFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  function seoulDay(date) {
    var p = seoulFmt.format(date).split('-').map(Number);   // en-CA -> YYYY-MM-DD
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }
  function relativeDay(createdAt) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(createdAt || '');
    if (!m) return '';
    var t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    var days = Math.round((seoulDay(new Date()) - seoulDay(t)) / 86400000);
    if (days <= 0) return '오늘';
    if (days === 1) return '어제';
    return days + '일 전';
  }

  function colorOf(row) {
    return COLOR_KEYS.indexOf(row.color) >= 0 ? row.color : 'yellow';
  }

  // =====================================================================
  //  Shared pieces (one per page): toolbar, marks list, note sheet
  // =====================================================================
  var active = null;   // the instance the toolbar / sheets currently serve
  var bar = null;
  var listSheet = null;
  var noteSheet = null;
  var noteState = null;   // { mode: 'new', inst, sel } | { mode: 'edit', inst, row }

  function ensureBar() {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'mk-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', '구절 도구 모음');
    bar.hidden = true;
    bar.innerHTML = COLORS.map(function (c) {
      return '<button type="button" class="mk-swatch mk-c-' + c.key + '" data-color="' + c.key + '" aria-label="' + c.label + ' 형광펜"><span></span></button>';
    }).join('') +
      '<button type="button" class="mk-bar-btn" data-act="note">구절 메모</button>';
    document.body.appendChild(bar);
    // keep focus / the tap from reaching the text underneath
    bar.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !active) return;
      if (b.dataset.color) active._highlight(b.dataset.color);
      else if (b.dataset.act === 'note') active._openNoteNew();
    });
  }

  function ensureListSheet() {
    if (listSheet) return;
    listSheet = document.createElement('section');
    listSheet.className = 'sheet mk-list-sheet';
    listSheet.id = 'sheet-marks';
    listSheet.dataset.wide = 'popover';
    listSheet.hidden = true;
    listSheet.setAttribute('role', 'dialog');
    listSheet.setAttribute('aria-label', '이 구절의 형광펜과 메모');
    listSheet.innerHTML =
      '<span class="handle"></span>' +
      '<div class="mk-list" aria-live="polite"></div>';
    document.body.appendChild(listSheet);
    listSheet.addEventListener('click', function (e) {
      if (!active) return;
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'edit') active._openNoteEdit(Number(b.dataset.id));
      else if (b.dataset.act === 'del') active._deleteFromList(b);
    });
    listSheet.addEventListener('sheet:close', function () {
      if (active) active._listClosed();
      setTimeout(function () { if (!listSheet.classList.contains('show')) listSheet.hidden = true; }, 500);
    });
  }

  function ensureNoteSheet() {
    if (noteSheet) return;
    noteSheet = document.createElement('section');
    noteSheet.className = 'sheet mk-note-sheet';
    noteSheet.id = 'sheet-mark-note';
    noteSheet.hidden = true;
    noteSheet.setAttribute('role', 'dialog');
    noteSheet.setAttribute('aria-label', '구절 메모');
    noteSheet.innerHTML =
      '<span class="handle"></span>' +
      '<p class="s-title"><b class="mk-note-title"></b><span class="mk-note-count"></span></p>' +
      '<p class="d-ex mk-note-quote"></p>' +
      '<form class="mk-note-form" novalidate>' +
        '<textarea class="field mk-note-text" rows="4" maxlength="' + NOTE_MAX + '" aria-label="구절 메모"></textarea>' +
        '<div class="sheet-actions">' +
          '<button type="button" class="sec" data-close>취소</button>' +
          '<button type="submit" class="pri mk-note-save">저장</button>' +
        '</div>' +
      '</form>';
    document.body.appendChild(noteSheet);
    var text = noteSheet.querySelector('.mk-note-text');
    var count = noteSheet.querySelector('.mk-note-count');
    text.addEventListener('input', function () { count.textContent = text.value.trim().length + ' / ' + NOTE_MAX; });
    noteSheet.querySelector('.mk-note-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (noteState) noteState.inst._saveNote(text.value);
    });
    noteSheet.addEventListener('sheet:close', function () {
      var st = noteState;
      noteState = null;
      setTimeout(function () { if (!noteSheet.classList.contains('show')) noteSheet.hidden = true; }, 500);
      // closed without saving: the selection is still there, bring the toolbar back
      if (st && st.inst) st.inst.reposition();
    });
  }

  function openNoteSheet(state, title, quote, value) {
    ensureNoteSheet();
    noteState = state;
    noteSheet.querySelector('.mk-note-title').textContent = title;
    noteSheet.querySelector('.mk-note-quote').textContent = quote;
    var text = noteSheet.querySelector('.mk-note-text');
    text.value = value || '';
    noteSheet.querySelector('.mk-note-count').textContent = text.value.trim().length + ' / ' + NOTE_MAX;
    noteSheet.querySelector('.mk-note-save').disabled = false;
    noteSheet.hidden = false;
    void noteSheet.offsetWidth;   // lay it out first so the opening transition runs
    if (bar) bar.hidden = true;
    UI.openSheet(noteSheet);
    setTimeout(function () { text.focus({ preventScroll: true }); }, 60);
  }

  function noteSheetOpen() {
    return !!noteSheet && noteSheet.classList.contains('show');
  }

  // =====================================================================
  //  One text area
  // =====================================================================
  function attach(opts) {
    var c = opts.container;
    var rows = [];          // marks to show (owned by the screen, see set())
    var pending = [];       // saved optimistically, waiting for the server
    var units = [];
    var byKey = new Map();
    var sel = null;         // { a: [key, w], f: [key, w], ctx }
    var gesture = null;     // pointer down on a word
    var guardUntil = 0;     // swallow the click that ends a selection gesture
    var swallowTouchEnd = false;
    var lastPointer = 'mouse';
    var layer = null;
    var listPos = null;     // [key, w] the open marks list is about
    var inst;

    c.classList.add('mk-host');

    // ---------------------------------------------------------------- DOM helpers
    function index() {
      units = Array.prototype.slice.call(c.querySelectorAll(opts.unitSelector));
      byKey = new Map();
      units.forEach(function (u) { byKey.set(opts.unitKey(u), u); });
    }

    function wordFrom(node) {
      var w = node && node.closest ? node.closest('.word[data-w]') : null;
      return w && c.contains(w) && w.closest(opts.unitSelector) ? w : null;
    }

    function posOf(wordEl) {
      var u = wordEl.closest(opts.unitSelector);
      return [opts.unitKey(u), Number(wordEl.dataset.w)];
    }

    function wordsOf(unit) {
      return unit.querySelectorAll('.word[data-w]');
    }

    // word w of a unit; past the end -> the unit's last word
    function wordAt(unit, w) {
      var el = unit.querySelector('.word[data-w="' + w + '"]');
      if (el) return el;
      var all = wordsOf(unit);
      return all.length ? all[all.length - 1] : null;
    }

    // each unit of the range with its first and last word element
    function pieces(start, end) {
      var out = [];
      units.forEach(function (u) {
        var k = opts.unitKey(u);
        if (k < start[0] || k > end[0]) return;
        var words = wordsOf(u);
        if (!words.length) return;
        var a = k === start[0] ? wordAt(u, start[1]) : words[0];
        var b = k === end[0] ? wordAt(u, end[1]) : words[words.length - 1];
        if (a && b) out.push({ unit: u, a: a, b: b });
      });
      return out;
    }

    // Line boxes of the text between two words, relative to the container.
    // Text nodes only (a whole paragraph's box would paint its line gaps too),
    // merged per line so spaces between words are covered too.
    function lineBoxes(start, end) {
      var cr = c.getBoundingClientRect();
      var out = [];
      pieces(start, end).forEach(function (p) {
        var r = document.createRange();
        r.setStartBefore(p.a);
        r.setEndAfter(p.b);
        var raw = [];
        var walker = document.createTreeWalker(p.unit, NodeFilter.SHOW_TEXT);
        for (var n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!r.intersectsNode(n)) continue;
          var sub = document.createRange();
          sub.selectNodeContents(n);
          if (sub.compareBoundaryPoints(Range.START_TO_START, r) < 0) sub.setStart(r.startContainer, r.startOffset);
          if (sub.compareBoundaryPoints(Range.END_TO_END, r) > 0) sub.setEnd(r.endContainer, r.endOffset);
          var rects = sub.getClientRects();
          for (var i = 0; i < rects.length; i++) {
            if (rects[i].width > 0.5 && rects[i].height > 0) raw.push(rects[i]);
          }
        }
        raw.sort(function (x, y) { return x.top - y.top || x.left - y.left; });
        var lines = [];
        raw.forEach(function (x) {
          var hit = null;
          for (var j = 0; j < lines.length; j++) {
            var l = lines[j];
            var overlap = Math.min(l.bottom, x.bottom) - Math.max(l.top, x.top);
            if (overlap > Math.min(l.bottom - l.top, x.height) / 2 && x.left <= l.right + 4 && x.right >= l.left - 4) { hit = l; break; }
          }
          if (hit) {
            hit.left = Math.min(hit.left, x.left);
            hit.right = Math.max(hit.right, x.right);
            hit.top = Math.min(hit.top, x.top);
            hit.bottom = Math.max(hit.bottom, x.bottom);
          } else {
            lines.push({ left: x.left, right: x.right, top: x.top, bottom: x.bottom });
          }
        });
        lines.forEach(function (l) {
          out.push({
            left: l.left - cr.left - c.clientLeft,
            top: l.top - cr.top - c.clientTop,
            width: l.right - l.left,
            height: l.bottom - l.top,
          });
        });
      });
      return out;
    }

    function boxHtml(cls, b) {
      return '<span class="' + cls + '" style="left:' + b.left.toFixed(1) + 'px;top:' + b.top.toFixed(1) +
        'px;width:' + b.width.toFixed(1) + 'px;height:' + b.height.toFixed(1) + 'px"></span>';
    }

    function ensureLayer() {
      if (layer && layer.parentNode === c) return;
      layer = document.createElement('div');
      layer.className = 'mk-layer';
      layer.setAttribute('aria-hidden', 'true');
      // first child: the screen may look at its last child (book.js counts pages from it)
      c.insertBefore(layer, c.firstChild);
    }

    // ---------------------------------------------------------------- drawing
    function render() {
      ensureLayer();
      index();
      var html = [];
      rows.concat(pending).forEach(function (row) {
        var rg = row._draft ? row._draft : opts.rangeOf(row);
        var cls = row.kind === 'note' ? 'mk-box mk-note' : 'mk-box mk-hl mk-c-' + colorOf(row);
        lineBoxes(rg.start, rg.end).forEach(function (b) { html.push(boxHtml(cls, b)); });
      });
      if (sel) {
        var r = ordered();
        lineBoxes(r[0], r[1]).forEach(function (b) { html.push(boxHtml('mk-box mk-sel', b)); });
      }
      layer.innerHTML = html.join('');
      reposition();
    }

    function ordered() {
      return cmp(sel.a, sel.f) <= 0 ? [sel.a, sel.f] : [sel.f, sel.a];
    }

    function marksAt(pos) {
      return rows.filter(function (row) {
        var rg = opts.rangeOf(row);
        return cmp(rg.start, pos) <= 0 && cmp(pos, rg.end) <= 0;
      });
    }

    // the selected words as plain text, one space between units
    function quoteOf(start, end) {
      return pieces(start, end).map(function (p) {
        var r = document.createRange();
        r.setStartBefore(p.a);
        r.setEndAfter(p.b);
        return r.toString();
      }).join(' ').replace(/\s+/g, ' ').trim().slice(0, QUOTE_MAX);
    }

    // The toolbar sits above the visible part of the selection (below it when
    // there is no room), kept inside the screen. Hidden while a sheet is open.
    function reposition() {
      if (!sel || active !== inst) {
        if (bar && active === inst) bar.hidden = true;
        return;
      }
      ensureBar();
      if (noteSheetOpen()) { bar.hidden = true; return; }
      bar.hidden = false;

      var vw = document.documentElement.clientWidth;
      var vh = window.innerHeight;
      var area = opts.clip ? opts.clip.getBoundingClientRect() : { left: 0, top: 0, right: vw, bottom: vh };
      var left0 = Math.max(0, area.left), right0 = Math.min(vw, area.right);
      var top0 = Math.max(0, area.top), bottom0 = Math.min(vh, area.bottom);
      var boxes = Array.prototype.map.call(layer.querySelectorAll('.mk-sel'), function (b) { return b.getBoundingClientRect(); })
        .filter(function (b) { return b.right > left0 && b.left < right0 && b.bottom > top0 && b.top < bottom0; });
      var bw = bar.offsetWidth, bh = bar.offsetHeight, gap = 10, edge = 8;
      var left, top;
      if (boxes.length) {
        var first = boxes[0], last = boxes[boxes.length - 1];
        left = (first.left + first.right) / 2 - bw / 2;
        top = first.top - bh - gap;
        if (top < top0 + edge) { top = last.bottom + gap; left = (last.left + last.right) / 2 - bw / 2; }
      } else {
        // the selection is on another page: keep the toolbar at the bottom of the text
        left = (left0 + right0) / 2 - bw / 2;
        top = bottom0 - bh - 16;
      }
      bar.style.left = Math.max(edge, Math.min(left, vw - bw - edge)) + 'px';
      bar.style.top = Math.max(edge, Math.min(top, vh - bh - edge)) + 'px';
    }

    // ---------------------------------------------------------------- selection
    function begin(pos) {
      active = inst;
      if (document.querySelector('.sheet.show')) UI.closeSheets();
      sel = { a: pos, f: pos, ctx: opts.context ? opts.context() : null };
      render();
    }

    function extendTo(pos) {
      if (!sel || cmp(pos, sel.f) === 0) return;
      sel.f = pos;
      render();
    }

    function cancel() {
      if (!sel) return false;
      sel = null;
      render();
      if (bar && active === inst) bar.hidden = true;
      return true;
    }

    // ---------------------------------------------------------------- pointer input
    function stopGesture() {
      if (!gesture) return;
      clearTimeout(gesture.timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      gesture = null;
    }

    function onDown(e) {
      lastPointer = e.pointerType || 'mouse';
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (opts.selectable === false) return;
      stopGesture();
      var w = wordFrom(e.target);
      if (!w) return;
      gesture = { id: e.pointerId, type: lastPointer, x: e.clientX, y: e.clientY, pos: posOf(w), started: false, timer: null };
      if (gesture.type !== 'mouse') {
        gesture.timer = setTimeout(function () {
          if (!gesture || gesture.started) return;
          gesture.started = true;
          begin(gesture.pos);
          UI.haptic();
        }, LONG_PRESS_MS);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }

    function onMove(e) {
      var g = gesture;
      if (!g || e.pointerId !== g.id) return;
      if (!g.started) {
        var dist = Math.hypot(e.clientX - g.x, e.clientY - g.y);
        if (g.type === 'mouse') {
          if (dist < MOUSE_DRAG_PX) return;
          g.started = true;
          begin(g.pos);
        } else {
          if (dist > TOUCH_SLOP_PX) stopGesture();   // a swipe or a scroll, not a long press
          return;
        }
      }
      var w = wordFrom(document.elementFromPoint(e.clientX, e.clientY));
      if (w) extendTo(posOf(w));
    }

    function onUp(e) {
      var g = gesture;
      if (!g || e.pointerId !== g.id) return;
      if (g.started) {
        guardUntil = Date.now() + CLICK_GUARD_MS;
        swallowTouchEnd = g.type !== 'mouse';
      }
      stopGesture();
    }

    // Clicks inside the text (capture phase, before dict-popup.js sees them).
    function onClick(e) {
      if (Date.now() < guardUntil) {
        guardUntil = 0;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      var w = wordFrom(e.target);
      if (sel) {
        e.stopPropagation();
        e.preventDefault();
        if (w) extendTo(posOf(w));
        else cancel();
        return;
      }
      if (!w) { clearTimeout(listTimer); listTap = null; return; }
      // A marked word: the marks list, but only once it is clear this is a single
      // tap. The click goes on to dict-popup.js either way, which opens the
      // dictionary on a double tap — so a second tap in time cancels the list.
      var now = Date.now();
      clearTimeout(listTimer);
      if (listTap && listTap.el === w && now - listTap.t <= doubleTapMs()) { listTap = null; return; }
      listTap = { el: w, t: now };
      if (!marksAt(posOf(w)).length) return;
      listTimer = setTimeout(function () {
        listTap = null;
        if (!w.isConnected || sel) return;
        var pos = posOf(w);
        if (marksAt(pos).length) openList(pos, w);
      }, doubleTapMs() + 10);
    }

    var listTimer = 0;
    var listTap = null;     // { el, t } last tap on a word, to tell single from double
    function doubleTapMs() {
      return (window.TypoemDict && window.TypoemDict.DOUBLE_TAP_MS) || 350;
    }

    c.addEventListener('pointerdown', onDown);
    c.addEventListener('click', onClick, true);
    // while selecting, a finger drag must not scroll the page or turn it
    c.addEventListener('touchmove', function (e) {
      if (gesture && gesture.started && e.cancelable) e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchend', function (e) {
      if (swallowTouchEnd) { swallowTouchEnd = false; e.stopPropagation(); }
    });
    c.addEventListener('contextmenu', function (e) {
      if (lastPointer !== 'mouse') e.preventDefault();   // no long-press menu / callout
    });
    c.addEventListener('dragstart', function (e) { e.preventDefault(); });

    // A click anywhere else ends the selection — except the toolbar, sheets and
    // the screen's own page-turn controls.
    document.addEventListener('click', function (e) {
      if (!sel || !e.target.closest) return;
      if (c.contains(e.target)) return;
      if (e.target.closest('.mk-bar, .sheet, .scrim')) return;
      if (opts.keepSelection && e.target.closest(opts.keepSelection)) return;
      cancel();
    });
    // Esc ends the selection (ui.js closes an open sheet first and marks the event)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !e.defaultPrevented && sel && !document.querySelector('.sheet.show')) cancel();
    });
    window.addEventListener('scroll', function () { if (sel) reposition(); }, { passive: true });

    // the text re-flowed (width change, fonts): measure again
    var rafId = 0;
    function refreshSoon() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(render);
    }
    if (window.ResizeObserver) new ResizeObserver(refreshSoon).observe(c);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshSoon);

    // ---------------------------------------------------------------- marks list
    function listItem(row) {
      var mine = me() && row.user_id === me().id;
      var body = row.kind === 'note'
        ? '<p class="note-content">' + esc(row.content) + '</p>'
        : '<p class="mk-hl-tag"><span class="mk-dot mk-c-' + colorOf(row) + '"></span>형광펜</p>';
      var ctrl = mine
        ? '<div class="m-foot"><span class="note-controls">' +
            (row.kind === 'note' ? '<button type="button" class="link-btn" data-act="edit" data-id="' + row.id + '">수정</button>' : '') +
            '<button type="button" class="link-btn" data-act="del" data-id="' + row.id + '">삭제</button>' +
          '</span></div>'
        : '';
      return '<div class="m-item mk-item" data-id="' + row.id + '">' +
        UI.avatar(row.author_nickname) +
        '<div class="m-main">' +
          '<b>' + esc(row.author_nickname) + '<small>' + relativeDay(row.created_at) + '</small></b>' +
          body +
          '<q>' + esc(row.quote) + '</q>' +
          ctrl +
        '</div></div>';
    }

    function renderList() {
      var hits = listPos ? marksAt(listPos) : [];
      listSheet.querySelector('.mk-list').innerHTML = hits.map(listItem).join('');
      return hits.length;
    }

    function openList(pos, wordEl) {
      ensureListSheet();
      active = inst;
      listPos = pos;
      renderList();
      listSheet.hidden = false;
      void listSheet.offsetWidth;
      UI.openSheet(listSheet, { anchor: wordEl });
      UI.haptic();
    }

    function listOpen() {
      return !!listSheet && listSheet.classList.contains('show') && active === inst;
    }

    function rowById(id) {
      for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
      return null;
    }

    // ---------------------------------------------------------------- saving
    async function highlight(color) {
      if (!sel) return;
      var r = ordered();
      var draft = { kind: 'highlight', color: color, content: null, start: r[0], end: r[1], quote: quoteOf(r[0], r[1]), ctx: sel.ctx };
      var temp = { id: -Date.now(), kind: 'highlight', color: color, _draft: draft };   // drawn until the server answers
      pending.push(temp);
      cancel();   // ends the selection and draws the new mark right away
      UI.haptic();
      try {
        var row = await opts.create(draft);
        pending = pending.filter(function (p) { return p !== temp; });
        opts.changed({ type: 'create', row: row });
      } catch (err) {
        pending = pending.filter(function (p) { return p !== temp; });
        render();
        UI.toast(err.message || '형광펜을 저장하지 못했어요');
      }
    }

    function openNoteNew() {
      if (!sel) return;
      var r = ordered();
      var s = { a: r[0], f: r[1], ctx: sel.ctx };
      openNoteSheet({ mode: 'new', inst: inst, sel: s }, '구절 메모 남기기', quoteOf(r[0], r[1]), '');
    }

    function openNoteEdit(id) {
      var row = rowById(id);
      if (!row) return;
      openNoteSheet({ mode: 'edit', inst: inst, row: row }, '구절 메모 수정', row.quote, row.content);
    }

    async function saveNote(value) {
      var st = noteState;
      if (!st) return;
      var content = String(value || '').trim();
      if (content.length < 1 || content.length > NOTE_MAX) {
        UI.toast('구절 메모는 1~' + NOTE_MAX + '자 이내로 입력해 주세요');
        return;
      }
      var btn = noteSheet.querySelector('.mk-note-save');
      btn.disabled = true;
      try {
        if (st.mode === 'new') {
          var row = await opts.create({
            kind: 'note', color: null, content: content,
            start: st.sel.a, end: st.sel.f, quote: quoteOf(st.sel.a, st.sel.f), ctx: st.sel.ctx,
          });
          noteState = null;      // saved: closing the sheet must not bring the toolbar back
          cancel();
          UI.closeSheets();
          opts.changed({ type: 'create', row: row });
        } else {
          var updated = await opts.update(st.row, content);
          noteState = null;
          UI.closeSheets();
          opts.changed({ type: 'update', row: updated });
        }
        UI.haptic();
      } catch (err) {
        btn.disabled = false;
        UI.toast(err.message || '구절 메모를 저장하지 못했어요');
      }
    }

    // 삭제 asks once more on the same button ("삭제 확인"), then deletes.
    async function deleteFromList(btn) {
      var row = rowById(Number(btn.dataset.id));
      if (!row) return;
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = '삭제 확인';
        setTimeout(function () {
          if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = '삭제'; }
        }, 4000);
        return;
      }
      btn.disabled = true;
      try {
        await opts.remove(row);
        opts.changed({ type: 'delete', row: row });
        UI.toast('삭제했어요');
      } catch (err) {
        btn.disabled = false;
        UI.toast(err.message || '삭제하지 못했어요');
      }
    }

    // ---------------------------------------------------------------- public
    inst = {
      set: function (list) {
        rows = Array.isArray(list) ? list.slice() : [];
        render();
        if (listOpen() && renderList() === 0) UI.closeSheets();
      },
      refresh: render,
      reposition: reposition,
      cancel: cancel,
      reset: function () {
        stopGesture();
        sel = null;
        rows = [];
        pending = [];
        listPos = null;
        if (bar && active === inst) bar.hidden = true;
        if (layer) layer.innerHTML = '';
      },
      isSelecting: function () { return !!sel; },
      // used by the shared toolbar / sheets
      _highlight: highlight,
      _openNoteNew: openNoteNew,
      _openNoteEdit: openNoteEdit,
      _saveNote: saveNote,
      _deleteFromList: deleteFromList,
      _listClosed: function () { listPos = null; },
    };
    if (!active) active = inst;
    return inst;
  }

  window.TypoemMarks = { attach: attach, COLORS: COLORS, relativeDay: relativeDay };
})();
