/*
 * Salty Pirates page: the text sections are parchment sheets that unroll the first time they scroll into view.
 * Only adds classes; the look and the animation live in site.css. Sections arrive late (app.js renders them from
 * games.json), so a MutationObserver picks them up. Safety: without IntersectionObserver, with reduced motion, or
 * when printing, every sheet is simply open; without JS the class is never added, so nothing is ever hidden.
 */
(function () {
  'use strict';
  var main = document.querySelector('main[data-game-page="salty-pirate"]');
  if (!main) return;
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var io = !reduce && 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('open'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -12% 0px' }) : null;
  function prep() {
    var list = main.querySelectorAll('.store-main > section:not(.sheet)');
    for (var i = 0; i < list.length; i++) {
      list[i].classList.add('sheet');
      if (io) io.observe(list[i]); else list[i].classList.add('open');
    }
  }
  prep();
  if ('MutationObserver' in window) new MutationObserver(prep).observe(main, { childList: true, subtree: true });
  window.addEventListener('beforeprint', function () {
    var s = main.querySelectorAll('.sheet');
    for (var i = 0; i < s.length; i++) s[i].classList.add('open');
  });
})();
