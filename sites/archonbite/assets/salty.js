/*
 * Salty Pirates page behaviour (the look lives in site.css):
 *  - [data-sheet]   parchment that unrolls the first time it scrolls into view
 *  - video[data-lazy]  gameplay loops that load and play only while on screen, and never when motion is off
 *  - .sp-card       the three fate cards turn over on click / Enter / Space (they are buttons)
 * Safety: without IntersectionObserver, with reduced motion, or when printing, sheets are simply open and videos
 * stay on their poster; without JS nothing is ever hidden (the classes are only added here).
 */
(function () {
  'use strict';
  var main = document.querySelector('main[data-game-page="salty-pirate"]');
  if (!main) return;
  var R = document.documentElement, reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var hasIO = 'IntersectionObserver' in window;
  function motionOff() { return reduce || R.classList.contains('motion-off'); }

  // parchment
  var sheets = main.querySelectorAll('[data-sheet]');
  var sio = !reduce && hasIO ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('open'); sio.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -15% 0px' }) : null;
  for (var i = 0; i < sheets.length; i++) { sheets[i].classList.add('sheet'); if (sio) sio.observe(sheets[i]); else sheets[i].classList.add('open'); }
  window.addEventListener('beforeprint', function () { for (var j = 0; j < sheets.length; j++) sheets[j].classList.add('open'); });

  // lazy gameplay loops: preload="none" in the markup, so nothing downloads until a video is actually seen
  var vids = main.querySelectorAll('video[data-lazy]'), seen = [];
  function play(v) { if (motionOff()) return; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  if (hasIO && !reduce) {
    var vio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { if (!v._loaded) { v.preload = 'auto'; v._loaded = true; } v._visible = true; play(v); }
        else { v._visible = false; v.pause(); }
      });
    }, { rootMargin: '120px 0px' });
    for (var k = 0; k < vids.length; k++) { vio.observe(vids[k]); seen.push(vids[k]); }
  }
  document.addEventListener('ab-motion', function (e) {
    seen.forEach(function (v) { if (e.detail && e.detail.off) v.pause(); else if (v._visible) play(v); });
  });

  // fate cards
  var cards = main.querySelectorAll('.sp-card');
  for (var c = 0; c < cards.length; c++) cards[c].addEventListener('click', function () {
    var on = this.getAttribute('aria-pressed') !== 'true';
    this.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  // pointer play (fine pointers, motion allowed): a lantern that lights the sea and tentacles around the cursor
  // (it sits behind the page content, so text never dims), and cards that tilt toward the cursor with a sliding glint
  var fine = false;
  try { fine = window.matchMedia('(pointer: fine)').matches; } catch (e) {}
  if (!fine || reduce) return;
  var lamp = document.createElement('div');
  lamp.className = 'sp-lantern'; lamp.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(lamp, document.body.firstChild.nextSibling);
  var px = -999, py = -999, queued = false;
  window.addEventListener('pointermove', function (e) {
    px = e.clientX; py = e.clientY;
    if (!queued) { queued = true; requestAnimationFrame(function () { queued = false; R.style.setProperty('--mx', px + 'px'); R.style.setProperty('--my', py + 'px'); R.classList.add('lamp-on'); }); }
  }, { passive: true });
  document.addEventListener('pointerleave', function () { R.classList.remove('lamp-on'); });
  for (var d = 0; d < cards.length; d++) {
    cards[d].addEventListener('pointermove', function (e) {
      var r = this.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      this.style.setProperty('--ry', ((x - 0.5) * 22).toFixed(1) + 'deg');
      this.style.setProperty('--rx', ((0.5 - y) * 18).toFixed(1) + 'deg');
      this.style.setProperty('--gx', (x * 100).toFixed(0) + '%'); this.style.setProperty('--gy', (y * 100).toFixed(0) + '%');
    });
    cards[d].addEventListener('pointerleave', function () { this.style.setProperty('--rx', '0deg'); this.style.setProperty('--ry', '0deg'); });
  }
})();
