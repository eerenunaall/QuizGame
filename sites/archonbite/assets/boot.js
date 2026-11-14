/*
 * Runs before first paint (render-blocking on purpose, ~1 KB): decides the language and marks the page as
 * "JS available" so CSS can hide English-pending text instead of flashing Turkish first. No cookies; the
 * language choice lives in localStorage and every access is wrapped because private windows can throw.
 * Order: ?lang= -> remembered choice -> browser language (tr/en) -> Turkish.
 */
(function () {
  var d = document.documentElement;
  d.className = d.className.replace('no-js', 'js');
  var lang = 'tr';
  try {
    var q = /[?&]lang=(tr|en)/.exec(location.search);
    var saved = null;
    try { saved = localStorage.getItem('ab.lang'); } catch (e) {}
    if (q) {
      lang = q[1];
      try { localStorage.setItem('ab.lang', lang); } catch (e) {}
    } else if (saved === 'tr' || saved === 'en') {
      lang = saved;
    } else if (/^en\b/i.test(navigator.language || '')) {
      lang = 'en';
    }
  } catch (e) {}
  d.lang = lang;
  d.setAttribute('data-lang', lang);
  /* Site root, so the same files work under a sub-folder as well as at the domain root. */
  var s = document.currentScript && document.currentScript.src;
  window.AB_ROOT = s ? s.replace(/assets\/boot\.js(\?.*)?$/, '') : '/';
  if (/[?&]edit=1/.test(location.search)) d.setAttribute('data-edit', '1');
})();
