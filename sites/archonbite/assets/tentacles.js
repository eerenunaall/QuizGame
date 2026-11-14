/*
 * Salty Pirates page: two tentacles rise out of the fog at the screen edges and curl slowly (canvas 2D).
 * Stylised on purpose: one dark silhouette, a cold rim light on the outer edge, pale suckers along the inner edge,
 * and the base lost in fog. Each tentacle is a chain of segments whose bend is a sum of slow travelling sines, so the
 * curl rolls from base to tip instead of the whole limb swinging like a stick.
 * Cost: ~30 fps cap, devicePixelRatio capped at 1.5, paused in a hidden tab or with the page's motion switch;
 * reduced motion draws one still pose.
 */
(function () {
  'use strict';
  if (!document.querySelector('main[data-game-page="salty-pirate"]')) return;
  var cv = document.createElement('canvas');
  cv.className = 'tentacles'; cv.setAttribute('aria-hidden', 'true');
  var ctx = cv.getContext('2d');
  if (!ctx) return;
  var R = document.documentElement, reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var W = 0, H = 0, dpr = 1, run = false, raf = 0, last = 0, t0 = performance.now();
  // pointer the tips reach for; k eases in and out so the reach never snaps (fine pointers only)
  var mouse = { x: 0, y: 0, on: false, k: 0, want: 0 };
  var fine = false;
  try { fine = window.matchMedia('(pointer: fine)').matches; } catch (e) {}
  if (fine && !reduce) {
    window.addEventListener('pointermove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; mouse.want = 1; }, { passive: true });
    document.addEventListener('pointerleave', function () { mouse.want = 0; });
    window.addEventListener('blur', function () { mouse.want = 0; });
  }

  // x: base position as a fraction of width; dir: which way the tip leans (+1 right, -1 left)
  var arms = [
    { x: -0.02, dir: 1, len: 0.78, w: 54, sp: 0.55, ph: 0.0, segs: 34 },
    { x: 0.05, dir: 1, len: 0.52, w: 30, sp: 0.75, ph: 2.1, segs: 28, back: true },
    { x: 1.03, dir: -1, len: 0.66, w: 46, sp: 0.6, ph: 4.0, segs: 32 },
    { x: 0.95, dir: -1, len: 0.42, w: 26, sp: 0.85, ph: 1.3, segs: 26, back: true }
  ];

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // centreline points from base (index 0) to tip
  function spine(a, t) {
    var small = W < 760, scale = small ? 0.55 : 1;
    var L = H * a.len * scale, n = a.segs, seg = L / n, pts = [];
    var x = W * a.x, y = H + 30, ang = -Math.PI / 2 + a.dir * 0.12;
    pts.push([x, y]);
    for (var i = 1; i <= n; i++) {
      var u = i / n;
      // the bend grows toward the tip and travels upward; the last third curls inward
      ang += a.dir * (0.012 + 0.11 * u * u) * (1 + 0.6 * Math.sin(t * a.sp - u * 4.2 + a.ph))
           + 0.035 * Math.sin(t * a.sp * 1.7 - u * 7 + a.ph * 1.3) * u;
      // the upper half reaches for a nearby pointer: steer toward it, strongest at the tip, within ~45% of the screen
      if (mouse.on && !a.back && u > 0.4) {
        var mdx = mouse.x - x, mdy = mouse.y - y, md = Math.hypot(mdx, mdy), reach = Math.max(W, H) * 0.45;
        if (md < reach) {
          var da = Math.atan2(mdy, mdx) - ang; da = Math.atan2(Math.sin(da), Math.cos(da));
          ang += da * 0.09 * (u - 0.4) * (1 - md / reach) * mouse.k;
        }
      }
      x += Math.cos(ang) * seg; y += Math.sin(ang) * seg;
      pts.push([x, y]);
    }
    return { pts: pts, scale: scale };
  }

  function drawArm(a, t) {
    var s = spine(a, t), p = s.pts, n = p.length - 1, Lft = [], Rgt = [], nrm = [];
    for (var i = 0; i <= n; i++) {
      var q = p[Math.min(n, i + 1)], o = p[Math.max(0, i - 1)];
      var dx = q[0] - o[0], dy = q[1] - o[1], d = Math.hypot(dx, dy) || 1;
      var nx = -dy / d, ny = dx / d, u = i / n;
      var hw = (a.w * s.scale) * Math.pow(1 - u, 1.15) * 0.5 + 0.8;
      nrm.push([nx, ny, hw]);
      Lft.push([p[i][0] + nx * hw, p[i][1] + ny * hw]); Rgt.push([p[i][0] - nx * hw, p[i][1] - ny * hw]);
    }
    // body
    ctx.beginPath(); ctx.moveTo(Lft[0][0], Lft[0][1]);
    for (i = 1; i <= n; i++) ctx.lineTo(Lft[i][0], Lft[i][1]);
    for (i = n; i >= 0; i--) ctx.lineTo(Rgt[i][0], Rgt[i][1]);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, H, 0, H - H * a.len);
    g.addColorStop(0, a.back ? '#020807' : '#030b0a'); g.addColorStop(1, a.back ? '#0a1a17' : '#0f2622');
    ctx.fillStyle = g; ctx.fill();
    // rim light on the outer edge (the side the tip leans away from), fading toward the base fog
    var rim = a.dir > 0 ? Lft : Rgt;
    ctx.beginPath(); ctx.moveTo(rim[2][0], rim[2][1]);
    for (i = 3; i <= n; i++) ctx.lineTo(rim[i][0], rim[i][1]);
    var rg = ctx.createLinearGradient(0, H, 0, H - H * a.len);
    rg.addColorStop(0, 'rgba(120,200,180,0)'); rg.addColorStop(0.5, a.back ? 'rgba(120,200,180,.18)' : 'rgba(130,215,195,.42)'); rg.addColorStop(1, 'rgba(130,215,195,.1)');
    ctx.strokeStyle = rg; ctx.lineWidth = a.back ? 1.2 : 2; ctx.lineJoin = 'round'; ctx.stroke();
    if (a.back) return;
    // suckers on the inner edge: two-tone ovals that shrink toward the tip
    for (i = 3; i < n - 3; i += 2) {
      var u2 = i / n, nn = nrm[i], side = a.dir > 0 ? -1 : 1, r = nn[2] * 0.42;
      var cx = p[i][0] + nn[0] * nn[2] * 0.58 * side, cy = p[i][1] + nn[1] * nn[2] * 0.58 * side, rot = Math.atan2(nn[1], nn[0]);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
      ctx.globalAlpha = 0.85 * (1 - u2 * 0.6);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.75, r, 0, 0, 6.2832); ctx.fillStyle = '#2c5049'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.38, r * 0.5, 0, 0, 6.2832); ctx.fillStyle = '#071311'; ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    var t = (now - t0) / 1000;
    mouse.k += (mouse.want - mouse.k) * 0.06; if (mouse.k < 0.01 && !mouse.want) mouse.on = false;
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < arms.length; i++) if (arms[i].back) drawArm(arms[i], t);
    for (i = 0; i < arms.length; i++) if (!arms[i].back) drawArm(arms[i], t);
    // fog swallowing the bases
    var f = ctx.createLinearGradient(0, H, 0, H * 0.55);
    f.addColorStop(0, 'rgba(6,14,14,.95)'); f.addColorStop(1, 'rgba(6,14,14,0)');
    ctx.fillStyle = f; ctx.fillRect(0, H * 0.55, W, H * 0.45);
  }
  function loop(now) {
    if (!run) return;
    if (now - last > 32) { last = now; frame(now); }
    raf = requestAnimationFrame(loop);
  }
  function off() { return reduce || R.classList.contains('motion-off') || document.hidden; }
  function start() { if (run || off()) return; run = true; raf = requestAnimationFrame(loop); }
  function stop() { run = false; cancelAnimationFrame(raf); }

  document.body.insertBefore(cv, document.body.firstChild);
  size(); frame(t0 + 6000);
  window.addEventListener('resize', function () { size(); frame(performance.now()); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  document.addEventListener('ab-motion', function (e) { if (e.detail && e.detail.off) stop(); else start(); });
  start();
})();
