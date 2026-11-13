// public/tour.js
// First-run coach marks: a few speech bubbles per screen ("여기를 누르면 …"), shown once.
//   TypoemTour.run('home', [{ el: '#hr-poem', text: '…' }, …])
//     el: a selector, or a list of selectors (the first visible one wins).
//     text: a string, or { touch, mouse } when the gesture differs (pointer: coarse = touch).
//     Steps whose target is missing or hidden are skipped; nothing visible -> no tour, not marked seen.
//   TypoemTour.reset()   settings "안내 다시 보기": every screen shows its tour again
//   TypoemTour.close()   true if a tour was open (ui.js: the Android back button closes it first)
// Only for accounts made in the last 14 days (user.created_at from login), on any device;
// older accounts only after reset() (localStorage['typoem:tour-on']).
// Seen flags: localStorage['typoem:tour2:<page>'] = '1', this device only (no server).
// Call run() after the screen has drawn its content. Load after ui.js.

(function () {
  'use strict';

  var PREFIX = 'typoem:tour2:';   // tour2: the tours were redone (11/13), so they show once more
  var ON = 'typoem:tour-on';   // set by reset(): an older account asked to see the tours
  var NEW_DAYS = 14;
  var current = null;   // { root, hole, tip, steps, i, page, onKey, onMove }

  // created_at comes from the login response (UTC 'YYYY-MM-DD HH:MM:SS'). Missing (old login, or
  // an account from before the column) = not new.
  function isNewAccount() {
    var user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec((user && user.created_at) || '');
    if (!m) return false;
    var joined = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return Date.now() - joined < NEW_DAYS * 864e5;
  }

  function seen(page) {
    try {
      if (localStorage.getItem(ON) !== '1' && !isNewAccount()) return true;
      return localStorage.getItem(PREFIX + page) === '1';
    } catch (e) { return true; }
  }
  function markSeen(page) {
    try { localStorage.setItem(PREFIX + page, '1'); } catch (e) { /* private mode: shows again next time */ }
  }

  function reset() {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(PREFIX) === 0) localStorage.removeItem(k);
      });
      localStorage.setItem(ON, '1');
    } catch (e) { /* private mode: no tour */ }
  }

  function visible(el) {
    return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function find(sel) {
    var list = Array.isArray(sel) ? sel : [sel];
    for (var i = 0; i < list.length; i++) {
      var el = document.querySelector(list[i]);
      if (visible(el)) return el;
    }
    return null;
  }

  function place() {
    if (!current) return;
    var step = current.steps[current.i];
    var pad = 6, gap = 12, edge = 12;
    var r = step.target.getBoundingClientRect();
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var hole = current.hole.style;
    hole.left = (r.left - pad) + 'px';
    hole.top = (r.top - pad) + 'px';
    hole.width = (r.width + pad * 2) + 'px';
    hole.height = (r.height + pad * 2) + 'px';

    var tip = current.tip;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var below = vh - r.bottom - pad - gap, above = r.top - pad - gap;
    var top = h <= below || below >= above ? r.bottom + pad + gap : r.top - pad - gap - h;
    // a target taller than the screen (the book page): the bubble sits over it, inside the screen
    top = Math.max(edge, Math.min(top, vh - h - edge));
    var left = Math.max(edge, Math.min(r.left + r.width / 2 - w / 2, vw - w - edge));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function show(i) {
    current.i = i;
    var step = current.steps[i];
    var last = i === current.steps.length - 1;
    step.target.scrollIntoView({ block: 'center', inline: 'nearest' });
    current.tip.querySelector('.tour-text').textContent = step.text;
    current.tip.querySelector('.tour-count').textContent = (i + 1) + ' / ' + current.steps.length;
    current.tip.querySelector('.tour-skip').hidden = last;
    var next = current.tip.querySelector('.tour-next');
    next.textContent = last ? '확인' : '다음';
    place();
    next.focus({ preventScroll: true });
  }

  function next() {
    if (!current) return;
    if (current.i < current.steps.length - 1) show(current.i + 1);
    else close();
  }

  function close() {
    if (!current) return false;
    var c = current;
    current = null;
    markSeen(c.page);
    c.root.remove();
    document.removeEventListener('keydown', c.onKey, true);
    window.removeEventListener('resize', c.onMove);
    window.removeEventListener('scroll', c.onMove, true);
    return true;
  }

  function run(page, steps) {
    if (current || seen(page)) return;
    // touch (the app, a phone browser) and mouse (a computer) do things differently
    var touch = !window.matchMedia || window.matchMedia('(pointer: coarse)').matches;
    var list = steps
      .map(function (s) {
        return { target: find(s.el), text: typeof s.text === 'string' ? s.text : s.text[touch ? 'touch' : 'mouse'] };
      })
      .filter(function (s) { return s.target; });
    if (!list.length) return;

    var root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML =
      '<div class="tour-hole" aria-hidden="true"></div>' +
      '<div class="tour-tip" role="dialog" aria-modal="true" aria-label="화면 안내">' +
        '<p class="tour-text" aria-live="polite"></p>' +
        '<div class="tour-foot">' +
          '<span class="tour-count"></span>' +
          '<button type="button" class="link-btn tour-skip">건너뛰기</button>' +
          '<button type="button" class="btn-sm tour-next"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    current = {
      root: root, page: page, steps: list, i: 0,
      hole: root.querySelector('.tour-hole'),
      tip: root.querySelector('.tour-tip'),
      onKey: function (e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      },
      onMove: function () { requestAnimationFrame(place); },
    };
    // a tap anywhere moves on; the skip button closes; taps never reach the page underneath
    root.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.target.closest('.tour-skip')) close();
      else next();
    });
    document.addEventListener('keydown', current.onKey, true);
    window.addEventListener('resize', current.onMove);
    window.addEventListener('scroll', current.onMove, true);

    show(0);
    if (window.TypoemUI) window.TypoemUI.anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  }

  window.TypoemTour = { run: run, reset: reset, close: close };
})();
