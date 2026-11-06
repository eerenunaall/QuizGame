/*
 * Liquid glass for the studio home and the QuizNight page (the look lives in site.css, section "liquid glass").
 *  - marks the page's panels with .lg so one CSS recipe turns them into glass (no markup changes on the pages);
 *  - a soft light follows the pointer across whichever pane it is over (fine pointers only);
 *  - QuizNight gets slow drifting colour orbs behind its glass (the home page has the calm sea from storm.js instead).
 * Panels rendered later by app.js (cards, carousel, news) are picked up by a MutationObserver.
 * Reduced motion: the orbs stand still and the pointer light is off; nothing else changes.
 */
(function () {
  'use strict';
  var R = document.documentElement, page = R.getAttribute('data-page') || '';
  var qn = !!document.querySelector('main[data-game-page="quiznight"]');
  if (page !== 'home' && !qn) return;
  var reduce = false, fine = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; fine = window.matchMedia('(pointer: fine)').matches; } catch (e) {}
  R.classList.add('lg-page');

  var TARGETS = page === 'home'
    ? '.hero-copy, .fc-tab, .gcard, .values li, .news-item, .site-footer .footer-grid'
    : '.qn-card, .qn-panel, .qn-stats li, .qn-badges li, .qn-venue, details.faq, .buybox, .capsule-box, .news-item, .req, .feature, .mini, .table-wrap';
  function mark(root) {
    var list = (root || document).querySelectorAll(TARGETS);
    for (var i = 0; i < list.length; i++) if (!list[i].classList.contains('lg')) list[i].classList.add('lg');
  }
  mark();
  if ('MutationObserver' in window) new MutationObserver(function () { mark(); }).observe(document.querySelector('main') || document.body, { childList: true, subtree: true });

  if (qn) {
    var orbs = document.createElement('div');
    orbs.className = 'lg-orbs'; orbs.setAttribute('aria-hidden', 'true');
    orbs.innerHTML = '<i></i><i></i><i></i><i></i>';
    document.body.insertBefore(orbs, document.body.firstChild);
  }

  // the home sea moves by itself, so it gets the same motion switch as the game pages (WCAG 2.2.2). Same storage key
  // and event as app.js, so a choice made on any page holds everywhere.
  var hero = page === 'home' && document.querySelector('.hero');
  if (hero && !reduce && document.querySelector('canvas.storm') && !hero.querySelector('.motion-toggle')) {
    var en = R.lang === 'en', b = document.createElement('button');
    b.type = 'button'; b.className = 'motion-toggle';
    b.innerHTML = '<span class="mt-ic" aria-hidden="true"></span><span class="mt-label"></span>';
    var off = false; try { off = localStorage.getItem('ab-motion') === 'off'; } catch (e) {}
    var set = function (o) {
      off = o; R.classList.toggle('motion-off', o);
      try { localStorage.setItem('ab-motion', o ? 'off' : 'on'); } catch (e) {}
      b.setAttribute('aria-pressed', o ? 'true' : 'false');
      b.lastChild.textContent = o ? (en ? 'Play motion' : 'Hareketi başlat') : (en ? 'Pause motion' : 'Hareketi durdur');
      document.dispatchEvent(new CustomEvent('ab-motion', { detail: { off: o } }));
    };
    b.addEventListener('click', function () { set(!off); });
    hero.appendChild(b); set(off);
  }

  if (!fine || reduce) return;
  // pointer light: position is set on the pane under the pointer only, one write per frame
  var cur = null, px = 0, py = 0, queued = false;
  function paint() {
    queued = false;
    if (!cur) return;
    var r = cur.getBoundingClientRect();
    cur.style.setProperty('--lx', (px - r.left) + 'px'); cur.style.setProperty('--ly', (py - r.top) + 'px');
  }
  document.addEventListener('pointermove', function (e) {
    px = e.clientX; py = e.clientY;
    var pane = e.target.closest ? e.target.closest('.lg') : null;
    if (pane !== cur) { if (cur) cur.classList.remove('lg-lit'); cur = pane; if (cur) cur.classList.add('lg-lit'); }
    if (cur && !queued) { queued = true; requestAnimationFrame(paint); }
  }, { passive: true });
  document.addEventListener('pointerleave', function () { if (cur) cur.classList.remove('lg-lit'); cur = null; });
})();
