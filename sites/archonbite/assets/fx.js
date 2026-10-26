/*
 * Hero embers: a tiny canvas particle field (warm sparks rising from the golden gate).
 * Why canvas and not video/WebGL: ~1.5 KB, no extra download, and it pauses when off-screen, in a hidden tab,
 * or when the visitor prefers reduced motion (then it draws one still frame).
 */
(function () {
  'use strict';
  var c = document.querySelector('.hero-fx');
  if (!c || !c.getContext) return;
  var ctx = c.getContext('2d'), w = 0, h = 0, dpr = 1, ps = [], run = false, raf = 0;
  var reduce = false, small = window.innerWidth < 700;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function spawn(p, fresh) {
    p.x = w * rnd(0.3, 0.7) + rnd(-w * 0.18, w * 0.18);
    p.y = fresh ? rnd(0, h) : h * rnd(0.82, 1.02);
    p.r = rnd(0.6, 2.2) * dpr; p.vy = rnd(0.15, 0.7) * dpr; p.vx = rnd(-0.15, 0.15) * dpr;
    p.a = rnd(0.25, 0.9); p.tw = rnd(0, 6.28); p.hue = rnd(28, 46);
    return p;
  }
  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = c.clientWidth * dpr; h = c.clientHeight * dpr; c.width = w; c.height = h;
    var n = small ? 36 : 80; ps = [];
    for (var i = 0; i < n; i++) ps.push(spawn({}, true));
    if (reduce) frame(0);
  }
  function frame(dt) {
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (!reduce) { p.y -= p.vy * dt; p.x += p.vx * dt + Math.sin(p.tw += 0.03) * 0.25 * dpr; if (p.y < -10) spawn(p, false); }
      var fade = Math.min(1, p.y / (h * 0.5));
      ctx.beginPath();
      ctx.fillStyle = 'hsla(' + p.hue + ',95%,65%,' + (p.a * fade * (0.7 + 0.3 * Math.sin(p.tw))) + ')';
      ctx.shadowColor = 'hsla(' + p.hue + ',100%,60%,.9)'; ctx.shadowBlur = 8 * dpr;
      ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
    }
  }
  var last = 0;
  function loop(ts) {
    if (!run) return;
    var dt = Math.min(2.5, (ts - last) / 16.67 || 1); last = ts;
    frame(dt); raf = requestAnimationFrame(loop);
  }
  function start() { if (reduce || run) return; run = true; last = performance.now(); raf = requestAnimationFrame(loop); }
  function stop() { run = false; cancelAnimationFrame(raf); }
  size();
  window.addEventListener('resize', function () { small = window.innerWidth < 700; size(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { if (es[0].isIntersecting) start(); else stop(); }).observe(c);
  else start();
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
})();
