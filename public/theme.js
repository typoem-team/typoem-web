// public/theme.js
// Light / dark theme (settings: 라이트 · 다크 · 기기 설정). Loaded in <head> of every page,
// before the body is drawn, so the page never flashes the wrong colours.
//   localStorage['typoem:theme'] = 'light' (default) | 'dark' | 'system'
//   -> <html data-theme="..."> ; styles.css has the dark values (docs/design/Design.md 1장)
// On settings.html it also wires the buttons with [data-theme-choice].

(function () {
  'use strict';

  var KEY = 'typoem:theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'system' ? v : 'light';
    } catch (e) { return 'light'; }
  }

  function isDark(choice) {
    return choice === 'dark' || (choice === 'system' && !!media && media.matches);
  }

  // <meta theme-color> follows the page background (the reading screen sets its own)
  function syncMeta() {
    if (document.body && document.body.classList.contains('reader-page')) return;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark(read()) ? '#161e20' : '#ffffff');
  }

  function apply(choice) {
    root.dataset.theme = choice;
    syncMeta();
  }

  function set(choice) {
    try { localStorage.setItem(KEY, choice); } catch (e) { /* private mode: this page only */ }
    apply(choice);
    try { window.dispatchEvent(new Event('typoem:theme')); } catch (e) { /* old browser */ }   // the app repaints its bars
    document.querySelectorAll('[data-theme-choice]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice));
    });
  }

  apply(read());
  if (media && media.addEventListener) {
    media.addEventListener('change', function () {
      if (read() !== 'system') return;
      apply('system');
      try { window.dispatchEvent(new Event('typoem:theme')); } catch (e) { /* old browser */ }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    syncMeta();
    var current = read();
    document.querySelectorAll('[data-theme-choice]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.themeChoice === current));
      b.addEventListener('click', function () { set(b.dataset.themeChoice); });
    });
  });

  window.TypoemTheme = { get: read, set: set, isDark: function () { return isDark(read()); } };
})();
