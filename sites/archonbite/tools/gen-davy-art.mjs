// Generates the Salty Pirates page's Davy Jones set pieces as small SVGs (no downloads, re-run to tweak):
//   assets/img/parchment.svg       seamless aged-paper tile (stains + fibre grain, stitched turbulence)
//   assets/img/parchment-mask.svg  ragged sheet outline, stretched over a section as a CSS mask
//   assets/img/tentacle-l.svg / tentacle-r.svg  tapered tentacle silhouettes with suckers, rising from the bottom
//   assets/img/barnacles.svg       a crust of barnacles for panel corners
// Seeded so the art is stable between runs.   node tools/gen-davy-art.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const IMG = fileURLToPath(new URL('../assets/img/', import.meta.url));
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const f1 = (n) => n.toFixed(1);

// ---- parchment tile: stitchTiles keeps the turbulence seamless when the tile repeats
writeFileSync(IMG + 'parchment.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
<filter id="s" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".008" numOctaves="4" seed="9" stitchTiles="stitch"/>
<feColorMatrix values="0 0 0 0 .42  0 0 0 0 .29  0 0 0 0 .13  0 0 0 -1.4 1.05"/></filter>
<filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85 .35" numOctaves="3" seed="4" stitchTiles="stitch"/>
<feColorMatrix values="0 0 0 0 .30  0 0 0 0 .21  0 0 0 0 .10  0 0 0 .5 -.12"/></filter>
<rect width="480" height="480" fill="#d6c198"/><rect width="480" height="480" filter="url(#s)" opacity=".55"/><rect width="480" height="480" filter="url(#g)"/>
</svg>`);

// ---- ragged sheet mask (viewBox 1000x1000, stretched): edges wander a few units in and out
{
  const r = rng(77); const pts = [];
  const edge = (x0, y0, x1, y1, n, inward) => {
    for (let i = 0; i < n; i++) {
      const t = i / n, j = (r() - .3) * 14 + (r() < .08 ? r() * 18 : 0);
      pts.push([x0 + (x1 - x0) * t + inward[0] * j, y0 + (y1 - y0) * t + inward[1] * j]);
    }
  };
  edge(0, 0, 1000, 0, 70, [0, 1]); edge(1000, 0, 1000, 1000, 70, [-1, 0]);
  edge(1000, 1000, 0, 1000, 70, [0, -1]); edge(0, 1000, 0, 0, 70, [1, 0]);
  writeFileSync(IMG + 'parchment-mask.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"><path fill="#000" d="M${pts.map((p) => f1(p[0]) + ' ' + f1(p[1])).join('L')}Z"/></svg>`);
}

// ---- tentacles: centreline is a sum of sines; the outline is offset by a tapering half-width; suckers sit on the inner side
function tentacle(seed, w, h, flip) {
  const r = rng(seed); let body = '', suck = '';
  const arms = [{ x: .32, len: .95, th: 46, ph: 0, sw: 1 }, { x: .62, len: .7, th: 30, ph: 1.7, sw: -1 }, { x: .12, len: .5, th: 22, ph: 3.1, sw: 1 }];
  arms.forEach((a, k) => {
    const N = 60, L = [], Rt = [], C = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, y = h - t * h * a.len;
      const x = w * a.x + a.sw * (Math.sin(t * 3.2 + a.ph) * 60 * t + Math.sin(t * 7 + a.ph) * 14 * t * t) + t * t * a.sw * 90;
      C.push([x, y]);
    }
    for (let i = 0; i <= N; i++) {
      const t = i / N, p = C[i], q = C[Math.min(N, i + 1)], o = C[Math.max(0, i - 1)];
      let dx = q[0] - o[0], dy = q[1] - o[1]; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const hw = a.th * Math.pow(1 - t, 1.25) + 1.2;
      L.push([p[0] - dy * hw, p[1] + dx * hw]); Rt.push([p[0] + dy * hw, p[1] - dx * hw]);
      if (i % 3 === 1 && t < .85) {
        const s = hw * .32; const sx = p[0] + dy * hw * .55 * a.sw, sy = p[1] - dx * hw * .55 * a.sw;
        suck += `<ellipse cx="${f1(sx)}" cy="${f1(sy)}" rx="${f1(s)}" ry="${f1(s * .8)}" fill="#22403a" opacity="${(.55 - t * .4).toFixed(2)}"/>`
             + `<ellipse cx="${f1(sx)}" cy="${f1(sy)}" rx="${f1(s * .45)}" ry="${f1(s * .35)}" fill="#04100e" opacity="${(.7 - t * .5).toFixed(2)}"/>`;
      }
    }
    const d = 'M' + L.map((p) => f1(p[0]) + ' ' + f1(p[1])).join('L') + 'L' + Rt.reverse().map((p) => f1(p[0]) + ' ' + f1(p[1])).join('L') + 'Z';
    body += `<path d="${d}" fill="url(#tg)" opacity="${k === 0 ? 1 : .82}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
    + `<defs><linearGradient id="tg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#030b0a"/><stop offset=".7" stop-color="#0b1f1c"/><stop offset="1" stop-color="#12302b"/></linearGradient></defs>`
    + `<g${flip ? ` transform="translate(${w} 0) scale(-1 1)"` : ''}>${body}${suck}</g></svg>`;
}
writeFileSync(IMG + 'tentacle-l.svg', tentacle(3, 420, 900, false));
writeFileSync(IMG + 'tentacle-r.svg', tentacle(3, 420, 900, true));

// ---- barnacle crust: overlapping volcano cones (rim, shadowed throat, lit edge), densest in the corner
{
  const r = rng(19), W = 220; let g = '';
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI / 2, d = Math.pow(r(), 1.6) * W * .95, x = Math.cos(a) * d, y = Math.sin(a) * d;
    const s = (1 - d / W) * 15 + 4 + r() * 5;
    g += `<g transform="translate(${f1(x)} ${f1(y)})"><circle r="${f1(s)}" fill="#3a4a44"/><circle r="${f1(s * .82)}" fill="#59675f"/>`
       + `<circle r="${f1(s * .45)}" fill="#1b2421"/><circle cx="${f1(-s * .1)}" cy="${f1(-s * .1)}" r="${f1(s * .22)}" fill="#05090a"/>`
       + `<path d="M${f1(-s * .8)} ${f1(-s * .3)}A${f1(s * .85)} ${f1(s * .85)} 0 0 1 ${f1(s * .3)} ${f1(-s * .8)}" stroke="#a8b4a6" stroke-opacity=".45" stroke-width="1.2" fill="none"/></g>`;
  }
  const crust = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}">${g}</svg>`;
  writeFileSync(IMG + 'barnacles.svg', crust);
  writeFileSync(IMG + 'barnacles-br.svg', crust.replace(/(<svg[^>]*>)/, `$1<g transform="translate(${W} ${W}) scale(-1 -1)">`).replace('</svg>', '</g></svg>'));
}
console.log('davy art written');
