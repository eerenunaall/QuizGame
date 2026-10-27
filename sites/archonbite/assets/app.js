/*
 * Archonbite site script (no framework, no build, no third-party requests).
 * Parts: i18n + language toggle, navigation, config binding (Play links, contact), scroll reveal, card tilt,
 * home (carousel, game cards, news), store pages (gallery, lightbox, trailer facade, features, requirements),
 * play page (room-code form), guide (table of contents highlight), edit mode (?edit=1).
 * Why one file: fewer requests on a static host and the whole thing stays far below the 60 KB JS budget.
 */
(function () {
  'use strict';
  var D = document, R = D.documentElement;
  var LANG = R.lang === 'en' ? 'en' : 'tr';
  var ROOT = window.AB_ROOT || './';
  var CFG = window.ARCHONBITE_CONFIG || {};
  var PAGE = R.getAttribute('data-page') || '';
  var dict = {};
  var data = null;
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function $(s, c) { return (c || D).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || D).querySelectorAll(s)); }
  function t(k) { return dict[k] != null ? dict[k] : k; }
  function L(o) { return o == null ? '' : typeof o === 'string' ? o : (o[LANG] || o.tr || ''); }
  function h(tag, attrs, kids) {
    var n = D.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? D.createTextNode(c) : c); });
    return n;
  }
  function url(p) { return ROOT + p; }
  function fmtDate(iso) {
    try { return new Intl.DateTimeFormat(LANG === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'long' }).format(new Date(iso + 'T12:00:00')); }
    catch (e) { return iso; }
  }
  var ICONS = {
    arrow: '<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    left: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    right: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4M14 18h2v2h-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="9" r="1.4" fill="currentColor"/><circle cx="15" cy="15" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    crown: '<path d="M4 18l-1-10 5 4 4-7 4 7 5-4-1 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    globe: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    store: '<path d="M4 9l1-5h14l1 5M4 9v11h16V9M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0M10 20v-6h4v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    palette: '<path d="M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s0-2.5 1.5-2.5H17a4 4 0 004-4A9 9 0 0012 3z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="11" r="1.2" fill="currentColor"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor"/><circle cx="16" cy="11" r="1.2" fill="currentColor"/>',
    book: '<path d="M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    devices: '<rect x="2" y="5" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="17" y="8" width="5" height="10" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 19h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  };
  function icon(name, cls) {
    var s = D.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    if (cls) s.setAttribute('class', cls);
    s.innerHTML = ICONS[name] || ICONS.info; // static strings above, never user data
    return s;
  }

  /* ---------------------------------------------------------------- i18n */
  function loadDict() {
    return fetch(url('assets/i18n/' + LANG + '.json'))
      .then(function (r) { return r.json(); })
      .then(function (d) { dict = d; })
      .catch(function () { dict = {}; });
  }
  function applyI18n(root) {
    $$('[data-i18n]', root).forEach(function (n) { var v = dict[n.getAttribute('data-i18n')]; if (v != null) n.textContent = v; });
    $$('[data-i18n-html]', root).forEach(function (n) { var v = dict[n.getAttribute('data-i18n-html')]; if (v != null) n.innerHTML = v; }); // own JSON, trusted
    $$('[data-i18n-attr]', root).forEach(function (n) {
      n.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var p = pair.split(':'), v = dict[p[1]];
        if (p[0] && v != null) n.setAttribute(p[0], v);
      });
    });
    if (PAGE && dict[PAGE + '.title']) {
      D.title = dict[PAGE + '.title'];
      var m = $('meta[name="description"]'); if (m && dict[PAGE + '.desc']) m.setAttribute('content', dict[PAGE + '.desc']);
    }
  }
  function markLang() {
    $$('[data-set-lang]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-set-lang') === LANG ? 'true' : 'false'); });
  }
  function setLang(l) {
    if (l === LANG) return;
    LANG = l; R.lang = l; R.setAttribute('data-lang', l);
    try { localStorage.setItem('ab.lang', l); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    R.classList.remove('i18n-ready');
    loadDict().then(function () { applyI18n(); markLang(); renderDynamic(); R.classList.add('i18n-ready'); });
  }

  /* ---------------------------------------------------------------- config binding */
  function bindConfig() {
    var base = (CFG.PLAY_URL || '').replace(/\/+$/, '');
    $$('[data-play-href]').forEach(function (a) {
      var kind = a.getAttribute('data-play-href');
      a.setAttribute('href', base + (kind === 'tv' ? CFG.TV_PATH || '/tv' : kind === 'join' ? CFG.JOIN_PATH || '/join' : kind === 'privacy' ? '/privacy' : '/'));
      a.setAttribute('rel', 'noopener');
    });
    $$('[data-mailto]').forEach(function (a) {
      var s = a.getAttribute('data-subject');
      a.setAttribute('href', 'mailto:' + (CFG.CONTACT_EMAIL || '') + (s ? '?subject=' + encodeURIComponent(s) : ''));
    });
    $$('[data-contact-text]').forEach(function (n) { n.textContent = CFG.CONTACT_EMAIL || ''; });
    if (CFG.PLAY_LIVE === false) {
      $$('[data-play-live]').forEach(function (n) { n.hidden = true; });
      $$('[data-play-soon]').forEach(function (n) { n.hidden = false; });
    }
    $$('[data-year]').forEach(function (n) { n.textContent = String(new Date().getFullYear()); });
  }

  /* ---------------------------------------------------------------- shared UI */
  function initNav() {
    var btn = $('.menu-btn'), nav = $('#nav');
    if (!btn || !nav) return;
    function set(open) { btn.setAttribute('aria-expanded', open ? 'true' : 'false'); nav.classList.toggle('open', open); }
    btn.addEventListener('click', function () { set(btn.getAttribute('aria-expanded') !== 'true'); });
    D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('open')) { set(false); btn.focus(); } });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    $$('[data-set-lang]').forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-set-lang')); }); });
    markLang();
  }
  function initReveal(root) {
    var els = $$('.reveal:not(.in)', root);
    if (!('IntersectionObserver' in window) || reduceMotion) { els.forEach(function (n) { n.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(function (n) { io.observe(n); });
  }
  function initTilt(root) {
    if (reduceMotion || !window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    $$('.gcard', root).forEach(function (c) {
      c.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse') return;
        var r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        c.classList.add('tilting');
        c.style.setProperty('--ry', ((x - 0.5) * 9).toFixed(2) + 'deg');
        c.style.setProperty('--rx', ((0.5 - y) * 7).toFixed(2) + 'deg');
        c.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        c.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      });
      c.addEventListener('pointerleave', function () {
        c.classList.remove('tilting'); c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg');
      });
    });
  }
  function initParallax() {
    var hero = $('.hero'); if (!hero || reduceMotion) return;
    var layers = $$('.hero-layer', hero), vis = true, px = 0, py = 0, sy = 0, raf = 0;
    function apply() {
      raf = 0;
      layers.forEach(function (l) {
        var d = parseFloat(l.getAttribute('data-depth') || '0.04');
        l.style.transform = 'translate3d(' + (px * d * -60).toFixed(1) + 'px,' + ((py * d * -40) + sy * d * 0.9).toFixed(1) + 'px,0) scale(1.06)';
      });
    }
    function sched() { if (!raf && vis) raf = requestAnimationFrame(apply); }
    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var r = hero.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5; sched();
    });
    window.addEventListener('scroll', function () { sy = Math.min(window.scrollY, 900); sched(); }, { passive: true });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { vis = es[0].isIntersecting; }).observe(hero);
    apply();
  }

  /* ---------------------------------------------------------------- data */
  function loadData() {
    if (data) return Promise.resolve(data);
    return fetch(url('data/games.json')).then(function (r) { return r.json(); }).then(function (d) { data = d; return d; });
  }
  function gameById(id) { return (data.games || []).filter(function (g) { return g.id === id; })[0]; }
  function gameHref(g) { return url('games/' + g.slug + '/'); }

  /* ---------------------------------------------------------------- home */
  var fcState = null;
  function buildSlides() {
    var qn = gameById('quiznight'), sp = gameById('salty-pirate'), s = [];
    function chips(g) { return (g.tags || []).slice(0, 3).map(function (x) { return L(x); }); }
    if (qn) s.push({ id: 'qn', img: url('assets/quiznight/key-art.jpg'), thumb: url('assets/quiznight/square.jpg'), title: qn.title, text: L(qn.short), tab: L(qn.meta.status), chips: chips(qn), accent: qn.accent,
      actions: [{ href: url('play/'), text: t('common.play_now'), gold: true }, { href: gameHref(qn), text: t('common.store_page') }] });
    if (sp) s.push({ id: 'sp', img: url(sp.art.header), thumb: url(sp.art.header), title: sp.title, text: L(sp.short), tab: t('games.salty.slide.tab'), chips: [t('common.soon')].concat(chips(sp)), accent: sp.accent,
      actions: [{ href: gameHref(sp), text: t('common.store_page'), gold: true }] });
    s.push({ id: 'venue', img: url('assets/quiznight/tv-gusto.webp'), thumb: url('assets/quiznight/tv-gusto-t.webp'), title: t('home.slide.venue.title'), text: t('home.slide.venue.text'), tab: t('home.slide.venue.tab'), chips: [t('home.slide.venue.tag1'), t('home.slide.venue.tag2')], accent: 'accent-quiznight',
      actions: [{ href: url('play/#venues'), text: t('home.slide.venue.cta'), gold: true }] });
    return s;
  }
  function renderCarousel() {
    var host = $('#featured-carousel'); if (!host) return;
    if (fcState && fcState.timer) clearInterval(fcState.timer);
    var slides = buildSlides(), cur = 0, paused = reduceMotion, DUR = 7000;
    host.textContent = '';
    var root = h('div', { class: 'fc' + (reduceMotion ? ' static' : ''), role: 'region', 'aria-roledescription': 'carousel', 'aria-label': t('home.featured.list') });
    root.style.setProperty('--fc-dur', DUR + 'ms');
    var stage = h('div', { class: 'fc-stage' }), side = h('div', { class: 'fc-side', role: 'tablist', 'aria-label': t('home.featured.list') });
    var slideEls = [], tabEls = [];
    slides.forEach(function (sl, i) {
      var actions = h('div', { class: 'btn-row' }, sl.actions.map(function (a) { return h('a', { class: 'btn ' + (a.gold ? 'btn-gold' : ''), href: a.href, text: a.text }); }));
      var el = h('div', { class: 'fc-slide ' + sl.accent, role: 'tabpanel', id: 'fc-p' + i, 'aria-labelledby': 'fc-t' + i, 'aria-roledescription': 'slide', 'aria-label': (i + 1) + ' / ' + slides.length }, [
        h('img', { class: 'bg', src: sl.img, alt: '', draggable: 'false', width: 1600, height: 900, loading: i === 0 ? 'eager' : 'lazy', decoding: 'async' }),
        h('div', { class: 'fc-copy' }, [h('h3', { text: sl.title }), h('p', { text: sl.text }),
          h('ul', { class: 'chips' }, sl.chips.map(function (c) { return h('li', { class: 'chip', text: c }); })), actions])
      ]);
      slideEls.push(el); stage.appendChild(el);
      var tab = h('button', { type: 'button', class: 'fc-tab', role: 'tab', id: 'fc-t' + i, 'aria-controls': 'fc-p' + i, 'aria-selected': 'false', tabindex: '-1' }, [
        h('img', { src: sl.thumb, alt: '', width: 64, height: 64, loading: 'lazy' }),
        h('span', {}, [h('span', { class: 't1', text: sl.title }), h('span', { class: 't2', text: sl.tab })]), h('span', { class: 'bar' })]);
      tab.addEventListener('click', function () { go(i, true); });
      tab.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(cur + 1, true); tabEls[cur].focus(); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(cur - 1, true); tabEls[cur].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); go(0, true); tabEls[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); go(slides.length - 1, true); tabEls[cur].focus(); }
      });
      tabEls.push(tab); side.appendChild(tab);
    });
    function arrow(dir) {
      var b = h('button', { type: 'button', 'aria-label': t(dir < 0 ? 'common.prev' : 'common.next') }); b.appendChild(icon(dir < 0 ? 'left' : 'right'));
      b.addEventListener('click', function () { go(cur + dir, true); }); return b;
    }
    var pb = h('button', { type: 'button', 'aria-label': 'Pause' }), picon = function () { pb.textContent = ''; pb.appendChild(icon(paused ? 'play' : 'pause')); pb.setAttribute('aria-label', paused ? 'Play' : 'Pause'); };
    pb.addEventListener('click', function () { paused = !paused; root.classList.toggle('paused', paused); picon(); restart(); });
    picon();
    stage.appendChild(h('div', { class: 'fc-arrows' }, [pb, arrow(-1), arrow(1)]));
    root.appendChild(stage); root.appendChild(side); host.appendChild(root);
    function go(i, user) {
      cur = (i + slides.length) % slides.length;
      slideEls.forEach(function (s, k) { s.classList.toggle('on', k === cur); if (k === cur) s.removeAttribute('inert'); else s.setAttribute('inert', ''); s.setAttribute('aria-hidden', k === cur ? 'false' : 'true'); });
      tabEls.forEach(function (b, k) { b.setAttribute('aria-selected', k === cur ? 'true' : 'false'); b.setAttribute('tabindex', k === cur ? '0' : '-1'); });
      if (user) restart();
    }
    var st = { timer: 0 }; fcState = st;
    function restart() {
      clearInterval(st.timer); st.timer = 0;
      if (paused || reduceMotion) return;
      st.timer = setInterval(function () { go(cur + 1, false); }, DUR);
    }
    function hold(on) { root.classList.toggle('paused', on || paused); if (on) { clearInterval(st.timer); st.timer = 0; } else restart(); }
    root.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hold(true); });
    root.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hold(false); });
    root.addEventListener('focusin', function () { hold(true); });
    root.addEventListener('focusout', function () { hold(false); });
    D.addEventListener('visibilitychange', function () { if (D.hidden) hold(true); else hold(false); });
    var x0 = null;
    stage.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
    stage.addEventListener('pointerup', function (e) {
      if (x0 == null) return; var dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) go(cur + (dx < 0 ? 1 : -1), true);
    });
    stage.addEventListener('pointercancel', function () { x0 = null; });
    go(0, false); restart();
  }
  function renderCards() {
    var host = $('#game-cards'); if (!host) return;
    host.textContent = '';
    (data.games || []).forEach(function (g) {
      var a = h('a', { class: 'gcard reveal in ' + g.accent, href: gameHref(g) }, [
        h('img', { class: 'art', src: url(g.art.capsule), alt: '', width: g.art.capsule_w, height: g.art.capsule_h, loading: 'lazy', decoding: 'async' }),
        h('div', { class: 'body' }, [h('h3', { text: g.title }), h('p', { class: 'short', text: L(g.short) }),
          h('ul', { class: 'chips' }, [h('li', { class: 'chip ' + (g.placeholder ? 'chip-soon' : 'chip-status'), text: L(g.meta.status) })].concat((g.tags || []).slice(0, 3).map(function (x) { return h('li', { class: 'chip', text: L(x) }); }))),
          h('span', { class: 'go' }, [t('common.store_page'), icon('arrow')])])]);
      host.appendChild(a);
    });
    initTilt(host);
  }
  function renderNews() {
    var host = $('#news-list'); if (!host) return;
    host.textContent = '';
    var items = [];
    (data.games || []).forEach(function (g) { (g.news || []).forEach(function (n) { items.push({ n: n, g: g }); }); });
    items.sort(function (a, b) { return a.n.date < b.n.date ? 1 : -1; });
    if (!items.length) { host.appendChild(h('li', { class: 'empty', text: t('home.news.empty') })); return; }
    items.slice(0, 3).forEach(function (it) {
      host.appendChild(h('li', { class: 'news-item' }, [h('time', { datetime: it.n.date, text: fmtDate(it.n.date) }), h('h3', { text: L(it.n.title) }), h('p', { text: L(it.n.body) }), h('span', { class: 'tagrow', text: it.g.title })]));
    });
  }

  /* ---------------------------------------------------------------- store pages */
  var store = { g: null, cur: 0 };
  function mediaSrc(m) { return url((LANG === 'en' && m.src_en) || m.src); }
  // One switch for everything that moves by itself on a game page (gameplay loops, storm sea, swaying set pieces):
  // WCAG 2.2.2 wants a way to pause motion that starts automatically and lasts more than five seconds.
  // The choice is remembered; storm.js listens for the 'ab-motion' event and the html.motion-off class.
  function motionOff() { try { return localStorage.getItem('ab-motion') === 'off'; } catch (e) { return false; } }
  function setMotion(off) {
    try { localStorage.setItem('ab-motion', off ? 'off' : 'on'); } catch (e) {}
    R.classList.toggle('motion-off', off);
    $$('video[loop]').forEach(function (v) { if (off) v.pause(); else if (v.querySelector('source')) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } });
    D.dispatchEvent(new CustomEvent('ab-motion', { detail: { off: off } }));
  }
  function motionToggle(host) {
    var b = h('button', { type: 'button', class: 'motion-toggle', 'aria-pressed': 'false' }, [h('span', { class: 'mt-ic', 'aria-hidden': 'true' }), h('span', { class: 'mt-label' })]);
    function paint() { var off = R.classList.contains('motion-off'); b.setAttribute('aria-pressed', off ? 'true' : 'false'); $('.mt-label', b).textContent = t(off ? 'motion.play' : 'motion.pause'); }
    b.addEventListener('click', function () { setMotion(!R.classList.contains('motion-off')); paint(); });
    if (motionOff()) setMotion(true);
    paint(); host.appendChild(b);
  }
  function thumbSrc(m) { return url((LANG === 'en' && m.thumb_en) || m.thumb || m.src); }
  function isTodo(g, field) { return (g.todo || []).indexOf(field) >= 0; }
  function renderStore() {
    var slug = $('[data-game-page]').getAttribute('data-game-page'), g = (data.games || []).filter(function (x) { return x.slug === slug; })[0];
    if (!g) return;
    store.g = g;
    var scope = $('[data-game-page]'); scope.classList.add(g.accent);
    D.title = g.title + ' | Archonbite';
    var md = $('meta[name="description"]'); if (md) md.setAttribute('content', L(g.short));
    $$('[data-g="title"]').forEach(function (n) { n.textContent = g.title; });
    var tg = $('[data-g="tagline"]'); if (tg) tg.textContent = L(g.tagline);
    var bg = $('[data-hero-bg]'); if (bg) bg.style.backgroundImage = 'url("' + url(g.art.bg || g.art.header) + '")'; // small file on purpose: it is only blurred
    var h1 = $('h1.store-title');
    if (h1 && g.art.logo && !$('.store-logo')) { // optional logo image replaces the visible title (the h1 stays for screen readers and search)
      h1.classList.add('sr-only'); h1.parentNode.insertBefore(h('img', { class: 'store-logo', src: url(g.art.logo), alt: '', width: g.art.logo_w, height: g.art.logo_h }), h1);
    }
    // optional full-bleed gameplay loop behind the store hero. Skipped (poster only) for reduced motion, Save-Data and
    // narrow screens, where a few MB of background video is not worth the visitor's data.
    var hero = $('.store-hero');
    if (hero && g.art.hero_video && !$('.store-hero-video')) {
      var save = (navigator.connection && navigator.connection.saveData) || window.innerWidth < 700;
      var hv = h('video', { class: 'store-hero-video', muted: true, loop: true, playsinline: true, preload: reduceMotion || save ? 'none' : 'auto', poster: url(g.art.hero_video.poster), 'aria-hidden': 'true', tabindex: '-1' });
      hv.muted = true;
      if (!reduceMotion && !save) { g.art.hero_video.sources.forEach(function (s) { hv.appendChild(h('source', { src: url(s.src), type: s.type })); }); hv.autoplay = !motionOff(); }
      hero.insertBefore(hv, hero.firstChild);
      if (hv.autoplay) { var hp = hv.play(); if (hp && hp.catch) hp.catch(function () {}); }
      if (!reduceMotion) motionToggle(hero);
    }
    renderViewer(g); renderCapsule(g); renderBuy(g); renderMain(g);
    // edit mode: outline placeholder blocks
    $$('[data-field]').forEach(function (n) { n.classList.toggle('todo', R.hasAttribute('data-edit') && isTodo(g, n.getAttribute('data-field'))); });
    if (R.hasAttribute('data-edit') && !$('.edit-bar')) {
      var list = (g.todo || []).map(function (f) { return h('li', { text: f }); });
      D.body.appendChild(h('div', { class: 'edit-bar', role: 'status' }, [h('b', { text: 'TODO-OWNER ' }), t('store.editbar'), h('ul', {}, list)]));
    }
  }
  function renderViewer(g) {
    var stage = $('[data-stage]'), thumbs = $('[data-thumbs]'); if (!stage || !thumbs) return;
    var items = g.media || []; thumbs.textContent = '';
    items.forEach(function (m, i) {
      var b = h('button', { type: 'button', class: 'thumb', 'aria-label': (L(m.alt) || t('store.image')) + ' (' + (i + 1) + '/' + items.length + ')', 'aria-current': 'false' }, [
        h('img', { src: m.type === 'video' ? url(m.thumb || m.poster) : thumbSrc(m), alt: '', width: 128, height: 72, loading: 'lazy', decoding: 'async' }),
        m.type === 'video' ? h('span', { class: 'ic' }, [icon('play')]) : null]);
      b.addEventListener('click', function () { show(i); });
      thumbs.appendChild(b);
    });
    function show(i) {
      store.cur = i; var m = items[i]; if (!m) return;
      stage.textContent = ''; stage.classList.toggle('is-phone', !!m.phone);
      if (m.placeholder) stage.appendChild(h('span', { class: 'stage-badge', text: t('store.placeholder') }));
      if (m.type === 'video' && m.provider === 'file') {
        // self-hosted gameplay loop: muted, looping, inline; reduced motion gets controls and no autoplay
        var v = h('video', { muted: true, loop: true, playsinline: true, preload: 'metadata', poster: url(m.poster), 'aria-label': L(m.alt), width: m.w, height: m.h });
        v.muted = true;
        (m.sources || []).forEach(function (s) { v.appendChild(h('source', { src: url(s.src), type: s.type })); });
        // native controls keep it keyboard-operable and pausable; autoplay only when motion is allowed
        v.controls = true;
        stage.appendChild(v);
        if (!reduceMotion && !motionOff()) { v.autoplay = true; var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
      } else if (m.type === 'video') {
        var ok = m.id && /^[\w-]{6,24}$/.test(m.id);
        if (!ok) {
          var tile = h('div', { class: 'poster-tile' }, [h('div', {}, [icon('play'), h('strong', { text: L(m.caption) || t('store.trailer.soon') })])]);
          if (m.poster) tile.style.backgroundImage = 'url("' + url(m.poster) + '")';
          stage.appendChild(tile);
        } else {
          var pb = h('button', { type: 'button', class: 'poster', 'aria-label': t('store.trailer') }, [h('span', { class: 'play' }, [icon('play')]), h('span', { class: 'cap', text: t('store.trailer.privacy') })]);
          pb.style.backgroundImage = 'url("' + url(m.poster) + '")';
          pb.addEventListener('click', function () {
            stage.textContent = '';
            var f = h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + m.id + '?autoplay=1&rel=0', title: L(m.alt), allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
            stage.appendChild(f);
          });
          stage.appendChild(pb);
        }
      } else {
        stage.appendChild(h('img', { src: mediaSrc(m), alt: L(m.alt), width: m.w, height: m.h, decoding: 'async' }));
        var z = h('button', { type: 'button', class: 'zoom', 'aria-label': t('store.zoom') + ': ' + L(m.alt) });
        z.addEventListener('click', function () { openLightbox(i); });
        stage.appendChild(z);
      }
      $$('.thumb', thumbs).forEach(function (b, k) { b.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    }
    store.show = show; show(Math.min(store.cur, items.length - 1) || 0);
  }
  var lb = null;
  function openLightbox(start) {
    var items = (store.g.media || []).map(function (m, i) { return { m: m, i: i }; }).filter(function (x) { return x.m.type === 'image'; });
    if (!items.length) return;
    var pos = Math.max(0, items.map(function (x) { return x.i; }).indexOf(start));
    if (!lb) {
      lb = h('dialog', { class: 'lightbox', 'aria-label': t('store.media') });
      var img = h('img', { alt: '' }), cap = h('p', { class: 'lb-cap' }), count = h('span', {});
      var close = h('button', { type: 'button', class: 'lb-btn', 'aria-label': t('common.close') }, [icon('close')]);
      var prev = h('button', { type: 'button', class: 'lb-btn lb-nav lb-prev', 'aria-label': t('common.prev') }, [icon('left')]);
      var next = h('button', { type: 'button', class: 'lb-btn lb-nav lb-next', 'aria-label': t('common.next') }, [icon('right')]);
      lb.appendChild(h('div', { class: 'lb-inner' }, [h('div', { class: 'lb-bar' }, [count, close]), h('figure', { class: 'lb-fig' }, [img, prev, next]), cap]));
      D.body.appendChild(lb);
      lb._u = function () {
        var x = lb._items[lb._pos]; img.src = mediaSrc(x.m); img.alt = L(x.m.alt); cap.textContent = L(x.m.alt) + (x.m.placeholder ? ' (' + t('store.placeholder') + ')' : '');
        count.textContent = (lb._pos + 1) + ' ' + t('store.of') + ' ' + lb._items.length;
        if (store.show) store.show(x.i);
      };
      function step(d) { lb._pos = (lb._pos + d + lb._items.length) % lb._items.length; lb._u(); }
      prev.addEventListener('click', function () { step(-1); }); next.addEventListener('click', function () { step(1); });
      close.addEventListener('click', function () { lb.close(); });
      lb.addEventListener('click', function (e) { if (e.target === lb) lb.close(); });
      lb.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); });
      var sx = null;
      lb.addEventListener('pointerdown', function (e) { sx = e.clientX; });
      lb.addEventListener('pointerup', function (e) { if (sx != null && Math.abs(e.clientX - sx) > 60) step(e.clientX < sx ? 1 : -1); sx = null; });
    }
    lb._items = items; lb._pos = pos; lb._u();
    if (typeof lb.showModal === 'function') lb.showModal(); else window.open(mediaSrc(items[pos].m), '_blank', 'noopener');
  }
  function renderCapsule(g) {
    var box = $('[data-capsule]'); if (!box) return; box.textContent = '';
    box.appendChild(h('img', { src: url(g.art.capsule), alt: '', width: g.art.capsule_w, height: g.art.capsule_h, decoding: 'async' }));
    var dl = h('dl', { class: 'meta' });
    function row(k, v) { if (v) { dl.appendChild(h('dt', { text: t(k) })); dl.appendChild(h('dd', { text: v })); } }
    var m = g.meta || {};
    row('store.status', L(m.status)); row('store.release', L(m.release)); row('store.platforms', L(m.platforms)); row('store.dev', m.developer); row('store.pub', m.publisher);
    var cb = h('div', { class: 'cb', 'data-field': 'short' }, [h('p', { class: 'short', text: L(g.short) }), h('div', { 'data-field': 'meta' }, [dl]),
      h('p', { class: 'tags-label', text: t('store.tags') }), h('ul', { class: 'chips', 'data-field': 'tags' }, (g.tags || []).map(function (x) { return h('li', { class: 'chip', text: L(x) }); }))]);
    box.appendChild(cb);
  }
  function renderBuy(g) {
    var box = $('[data-buy]'); if (!box) return; box.textContent = '';
    var l = g.links || {}, m = g.meta || {};
    box.appendChild(h('h2', { text: g.title }));
    box.appendChild(h('p', { class: 'price', text: L(m.price) }));
    if (l.play) { var p = h('a', { class: 'btn btn-gold btn-lg', href: url(l.play), text: t('store.buy.play') }); p.appendChild(icon('arrow')); box.appendChild(p); }
    if (l.guide) box.appendChild(h('a', { class: 'btn', href: url(l.guide), text: t('store.buy.guide') }));
    if (g.id === 'quiznight') box.appendChild(h('a', { class: 'btn', href: url('play/#venues'), text: t('store.buy.venue') }));
    if (l.steam) box.appendChild(h('a', { class: 'btn btn-gold', href: l.steam, rel: 'noopener', target: '_blank', text: t('store.buy.steam') }));
    if (!l.play && !l.steam) box.appendChild(h('a', { class: 'btn btn-gold btn-lg', 'data-mailto': true, 'data-subject': g.title, href: '#', text: t('store.buy.follow') }));
    if (l.play) box.appendChild(h('p', { class: 'fine', text: t('store.noinstall') }));
    bindConfig();
  }
  function renderMain(g) {
    var main = $('[data-main]'); if (!main) return; main.textContent = '';
    function sec(id, titleKey, kids, field) { var s = h('section', { id: id, 'data-field': field || null }, [h('h2', { text: t(titleKey) })].concat(kids)); main.appendChild(s); return s; }
    sec('about', 'store.about', [h('div', { class: 'prose' }, (g.about || []).map(function (p) { return h('p', { text: L(p) }); }))], 'about');
    if ((g.features || []).length) sec('features', 'store.features', [h('ul', { class: 'features' }, g.features.map(function (f) {
      return h('li', { class: 'feature' }, [h('div', { class: 'ic' }, [icon(f.icon)]), h('h3', { text: L(f.title) }), h('p', { text: L(f.text) })]);
    }))], 'features');
    var rq = g.requirements || {}, devs = rq.devices || [];
    var rkids = [];
    if (devs.length) {
      rkids.push(h('div', { class: 'reqs' }, devs.map(function (d) {
        function col(title, rows) { return h('div', {}, [h('h4', { text: title }), h('dl', {}, rows.map(function (r) { return h('div', {}, [h('dt', { text: L(r.k) }), h('dd', { text: L(r.v) })]); }))]); }
        return h('div', { class: 'req' }, [h('h3', { text: L(d.name), class: '' }), col(t('store.min'), d.min || []), col(t('store.rec'), d.rec || [])]);
      })));
      if (rq.note) rkids.push(h('p', { class: 'note', text: L(rq.note) }));
    } else rkids.push(h('div', { class: 'empty' }, [icon('info'), h('p', { text: t('store.empty'), class: '' })]));
    sec('requirements', g.id === 'quiznight' ? 'store.reqs.qn' : 'store.reqs', rkids, 'requirements');
    if ((g.news || []).length) sec('news', 'store.news', [h('ul', { class: 'news-list' }, g.news.map(function (n) {
      return h('li', { class: 'news-item' }, [h('time', { datetime: n.date, text: fmtDate(n.date) }), h('h3', { text: L(n.title) }), h('p', { text: L(n.body) })]);
    }))], 'news');
  }

  /* ---------------------------------------------------------------- play + guide */
  function initPlay() {
    var form = $('#code-form'); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = $('#room-code'), v = (inp.value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), err = $('#code-err');
      if (v.length < 4 || v.length > 8) { err.textContent = t('play.code.bad'); inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
      err.textContent = ''; inp.removeAttribute('aria-invalid');
      location.href = (CFG.PLAY_URL || '').replace(/\/+$/, '') + (CFG.JOIN_PATH || '/join') + '/' + encodeURIComponent(v);
    });
  }
  function initToc() {
    var links = $$('.toc a'); if (!links.length || !('IntersectionObserver' in window)) return;
    var map = {}; links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { links.forEach(function (a) { a.classList.remove('on'); a.removeAttribute('aria-current'); }); var a = map[e.target.id]; if (a) { a.classList.add('on'); a.setAttribute('aria-current', 'true'); } } });
    }, { rootMargin: '-20% 0px -70% 0px' });
    $$('.article > section[id]').forEach(function (s) { io.observe(s); });
  }

  /* ---------------------------------------------------------------- boot */
  function renderDynamic() {
    if (!data) return;
    if (PAGE === 'home') { renderCarousel(); renderCards(); renderNews(); }
    if (D.querySelector('[data-game-page]')) renderStore();
    initReveal(D);
  }
  function init() {
    initNav(); bindConfig(); initParallax(); initPlay(); initToc();
    var needsData = PAGE === 'home' || !!D.querySelector('[data-game-page]');
    var jobs = [loadDict()];
    if (needsData) jobs.push(loadData().catch(function () {
      var m = $('[data-main]') || $('#game-cards'); if (m) m.textContent = t('store.error');
    }));
    Promise.all(jobs).then(function () { applyI18n(); renderDynamic(); R.classList.add('i18n-ready'); initReveal(D); });
    setTimeout(function () { R.classList.add('i18n-ready'); }, 2500); // never leave English text hidden if a request hangs
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
})();
