/*
 * QuizNight page behaviour (the look lives in assets/quiznight.css): gameplay clips marked video[data-lazy] load and
 * play only while on screen, never with reduced motion, and pause with the site's motion switch (the 'ab-motion' event
 * from app.js). Without IntersectionObserver or with reduced motion the clips simply stay on their poster.
 */
(function () {
  'use strict';
  var main = document.querySelector('main[data-game-page="quiznight"]');
  if (!main) return;
  var R = document.documentElement, reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduce || !('IntersectionObserver' in window)) {
    // stays on the poster; native controls keep the clip reachable for anyone who wants to play it
    var still = main.querySelectorAll('video[data-lazy]');
    for (var s = 0; s < still.length; s++) still[s].controls = true;
    return;
  }
  function off() { return R.classList.contains('motion-off'); }
  var seen = [];
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) {
        if (!v._loaded) { v.preload = 'auto'; v._loaded = true; }
        v._visible = true;
        if (!off()) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      } else { v._visible = false; v.pause(); }
    });
  }, { rootMargin: '120px 0px' });
  var vids = main.querySelectorAll('video[data-lazy]');
  for (var i = 0; i < vids.length; i++) { vids[i].muted = true; io.observe(vids[i]); seen.push(vids[i]); }
  document.addEventListener('ab-motion', function (e) {
    seen.forEach(function (v) {
      if (e.detail && e.detail.off) v.pause();
      else if (v._visible) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    });
  });
})();
