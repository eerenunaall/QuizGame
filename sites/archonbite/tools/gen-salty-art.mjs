// Generates the Salty Pirates PLACEHOLDER art (original SVG, no third-party material).
// Run: node tools/gen-salty-art.mjs   (writes into assets/salty-pirate/). Zero dependencies.
// The art is deliberately generic pirate-sea scenery. It makes NO claim about the real game: when the owner has
// real key art and screenshots, drop them into assets/salty-pirate/ and point data/games.json at them.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../assets/salty-pirate/', import.meta.url));
mkdirSync(out, { recursive: true });

// Small deterministic PRNG so regenerating produces identical files (clean diffs).
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const defs = (id = '') => `
  <linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#040916"/><stop offset=".45" stop-color="#0c2238"/>
    <stop offset=".72" stop-color="#17505c"/><stop offset="1" stop-color="#e0a24a"/>
  </linearGradient>
  <radialGradient id="moon${id}" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#fff6d6"/><stop offset=".55" stop-color="#f4dc9a" stop-opacity=".35"/><stop offset="1" stop-color="#f4dc9a" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="sea${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#14606a"/><stop offset=".5" stop-color="#0b3342"/><stop offset="1" stop-color="#050f1c"/>
  </linearGradient>
  <radialGradient id="glow${id}" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/>
  </radialGradient>`;

function stars(w, h, n, seed, maxY) {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = (r() * w).toFixed(0), y = (r() * maxY).toFixed(0), rad = (0.5 + r() * 1.5).toFixed(1);
    s += `<circle cx="${x}" cy="${y}" r="${rad}" fill="#fff" opacity="${(0.25 + r() * 0.65).toFixed(2)}"/>`;
  }
  return `<g>${s}</g>`;
}

// A wave band: a smooth wavy top edge filled down to `bottom`.
function waves(w, y, amp, len, bottom, fill, phase = 0, opacity = 1) {
  let d = `M0 ${bottom} L0 ${y}`;
  for (let x = 0; x <= w + len; x += len) {
    const cx = x + len / 2 + phase;
    d += ` Q${cx} ${y - amp} ${x + len} ${y}`;
  }
  d += ` L${w} ${bottom} Z`;
  return `<path d="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

function sail(x0, x1, top, bottom, bulge) {
  // Tattered bottom edge (zigzag) so the sails read as old canvas.
  let d = `M${x0} ${top} Q${(x0 + x1) / 2} ${top - 8} ${x1} ${top} L${x1 - 4} ${bottom - bulge}`;
  const teeth = 6;
  for (let i = 1; i <= teeth; i++) {
    const x = x1 - ((x1 - x0) * i) / teeth;
    d += ` L${x.toFixed(1)} ${bottom + (i % 2 ? 10 : -4)}`;
  }
  d += ' Z';
  return `<path d="${d}"/>`;
}

function skull(cx, cy, s, fill = '#f3ead6') {
  return `<g transform="translate(${cx} ${cy}) scale(${s})" fill="${fill}">
    <path d="M0 -22c-13 0-22 9-22 20 0 7 3 12 8 15v8h8v-5h4v5h4v-5h4v5h8v-8c5-3 8-8 8-15 0-11-9-20-22-20z" transform="translate(0 4)"/>
    <circle cx="-8" cy="-2" r="5.5" fill="#050b17"/><circle cx="8" cy="-2" r="5.5" fill="#050b17"/>
    <path d="M0 5l-3 7h6z" fill="#050b17"/>
    <path d="M-30 20L30 40M30 20L-30 40" stroke="${fill}" stroke-width="7" stroke-linecap="round"/>
  </g>`;
}

function ship(x, y, s, fill = '#04070e', sails = '#20405c') {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}" stroke="${fill}">
    <path d="M-150 -40 L-150 -66 L-98 -66 L-98 -24 L108 -24 L172 -56 L180 -46 L152 -6 C120 24 40 36 -20 36 C-92 36 -140 16 -150 -40 Z" stroke="none"/>
    <path d="M-150 -66 L-98 -66" stroke-width="5"/>
    <path d="M0 -24V-262M104 -24V-204M-92 -24V-176" stroke-width="7" fill="none"/>
    <path d="M-60 -226H60M-44 -154H44M-30 -246H30M60 -182H150M-150 -150H-34" stroke-width="5" fill="none"/>
    <path d="M178 -48L252 -86" stroke-width="6" fill="none"/>
    <g fill="${sails}" stroke="none">
      ${sail(-62, 62, -226, -170, 14)}
      ${sail(-70, 70, -150, -84, 18)}
      ${sail(-86, 86, -76, -30, 12).replace('<path', '<path opacity=".0"')}
      ${sail(66, 146, -182, -120, 12)}
      ${sail(-150, -34, -150, -100, 10)}
    </g>
    <path d="M0 -262L-4 -250M0 -262L90 -248L60 -234L90 -222" stroke-width="3" fill="none"/>
    <path d="M-150 -24L0 -262M178 -48L0 -262M-98 -66L0 -262M104 -204L0 -262" stroke-width="1.4" opacity=".7" fill="none"/>
    <g stroke="none">
      <rect x="2" y="-262" width="62" height="38" rx="2" transform="translate(0 0)"/>
    </g>
    <circle cx="-128" cy="-52" r="4" fill="#ffd27a" stroke="none"/><circle cx="-112" cy="-52" r="4" fill="#ffd27a" stroke="none"/>
    <circle cx="-120" cy="-52" r="22" fill="url(#glowK)" stroke="none"/>
    <circle cx="248" cy="-84" r="5" fill="#ffd27a" stroke="none"/>
  </g>`;
}

function seaScene(w, h, { shipAt = [0.6, 0.62, 0.9], moonAt = [0.28, 0.3, 120], id = '', stormy = false } = {}) {
  const horizon = h * 0.62;
  const [mx, my, mr] = moonAt;
  const sx = shipAt[0] * w, sy = shipAt[1] * h, ss = shipAt[2] * (h / 900);
  const r = rng(7);
  let glints = '';
  for (let i = 0; i < 46; i++) {
    const yy = horizon + 10 + r() * (h - horizon - 20);
    const spread = 30 + (yy - horizon) * 0.45;
    const xx = mx * w + (r() - 0.5) * spread * 2;
    glints += `<rect x="${xx.toFixed(0)}" y="${yy.toFixed(0)}" width="${(10 + r() * 60).toFixed(0)}" height="2" rx="1" fill="#fff0c0" opacity="${(0.2 + r() * 0.5).toFixed(2)}"/>`;
  }
  return `
  <rect width="${w}" height="${h}" fill="url(#sky${id})"/>
  ${stars(w, h, 120, 3, horizon * 0.8)}
  <circle cx="${mx * w}" cy="${my * h}" r="${mr * 2.6 * (h / 900)}" fill="url(#moon${id})"/>
  <circle cx="${mx * w}" cy="${my * h}" r="${mr * 0.62 * (h / 900)}" fill="#fff3cc"/>
  <circle cx="${mx * w - 14}" cy="${my * h + 8}" r="${mr * 0.1 * (h / 900)}" fill="#e8d193" opacity=".55"/>
  <circle cx="${mx * w + 18}" cy="${my * h - 12}" r="${mr * 0.07 * (h / 900)}" fill="#e8d193" opacity=".5"/>
  ${stormy ? '' : `<path d="M0 ${horizon} H${w}" stroke="#ffcf7a" stroke-opacity=".5" stroke-width="3"/>`}
  <rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#sea${id})"/>
  ${glints}
  ${waves(w, horizon + 14, 8, 90, h, '#0d4551', 0, 0.55)}
  <g>${ship(sx, sy, ss)}</g>
  ${waves(w, horizon + h * 0.12, 16, 140, h, '#08232f', 30, 0.95)}
  ${waves(w, horizon + h * 0.24, 22, 200, h, '#051620', 90, 1)}
  ${waves(w, horizon + h * 0.34, 30, 260, h, '#030c14', 10, 1)}`;
}

function wrap(w, h, body, vb, id = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb ?? `0 0 ${w} ${h}`}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Placeholder art">
<!-- PLACEHOLDER ART: original generic pirate-sea scenery generated by tools/gen-salty-art.mjs. It is not from the real game. -->
<defs>${defs(id)}
<radialGradient id="glowK" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd27a" stop-opacity=".9"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient></defs>
${body}
</svg>
`;
}

const W = 1600, H = 900;
// 1) key art + capsule (same scene, different crop)
const key = seaScene(W, H, { shipAt: [0.6, 0.67, 1.1], moonAt: [0.3, 0.3, 120] });
writeFileSync(out + 'key-art.svg', wrap(W, H, key));
writeFileSync(out + 'capsule.svg', wrap(920, 430, key, '180 190 1240 580'));

// 2) five placeholder "screens" (1280x720)
const SW = 1280, SH = 720;
writeFileSync(out + 'shot-1.svg', wrap(SW, SH, seaScene(SW, SH, { shipAt: [0.5, 0.64, 0.85], moonAt: [0.72, 0.28, 100] })));

// island at dusk
const island = (() => {
  const w = SW, h = SH, hz = h * 0.6;
  const r = rng(11);
  let palms = '';
  for (const [px, py, ps] of [[0.62, 0.5, 1], [0.7, 0.52, 0.8], [0.55, 0.53, 0.7]]) {
    const x = px * w, y = py * h;
    palms += `<g transform="translate(${x} ${y}) scale(${ps})" fill="#03080f" stroke="#03080f"><path d="M0 0C4 -40 6 -80 14 -120" stroke-width="7" fill="none"/>
      <path d="M14 -120C-30 -140 -60 -120 -80 -90C-45 -110 -20 -112 14 -120ZM14 -120C50 -150 90 -135 110 -100C70 -120 40 -118 14 -120ZM14 -120C0 -160 30 -190 60 -190C40 -170 30 -150 14 -120ZM14 -120C-20 -165 -60 -165 -90 -150C-55 -150 -30 -140 14 -120Z" stroke="none"/></g>`;
  }
  return `<defs><linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1646"/><stop offset=".5" stop-color="#8a3a5a"/><stop offset=".8" stop-color="#f08a4b"/><stop offset="1" stop-color="#ffd07a"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#dusk)"/>${stars(w, h, 60, 5, hz * 0.5)}
  <circle cx="${w * 0.2}" cy="${hz - 20}" r="70" fill="#ffe3a3" opacity=".9"/>
  <rect y="${hz}" width="${w}" height="${h - hz}" fill="url(#sea)"/>
  <path d="M${w * 0.4} ${hz} Q${w * 0.52} ${hz - 120} ${w * 0.66} ${hz - 90} Q${w * 0.8} ${hz - 60} ${w * 0.9} ${hz} Z" fill="#03080f"/>
  ${palms}
  <circle cx="${w * 0.6}" cy="${hz - 10}" r="40" fill="url(#glowK)"/><circle cx="${w * 0.6}" cy="${hz - 10}" r="5" fill="#ffd27a"/>
  ${waves(w, hz + 30, 10, 110, h, '#0a3340', 0, 0.8)}${waves(w, hz + 120, 18, 170, h, '#061c28', 40, 1)}${waves(w, hz + 210, 26, 240, h, '#030c14', 0, 1)}`;
})();
writeFileSync(out + 'shot-2.svg', wrap(SW, SH, island.replace(/url\(#sea\)/g, 'url(#sea)')));

// storm
const storm = (() => {
  const w = SW, h = SH, hz = h * 0.66, r = rng(21);
  let clouds = '';
  for (let i = 0; i < 16; i++) {
    const cx = r() * w, cy = 40 + r() * 230, rx = 120 + r() * 220, ry = 40 + r() * 70;
    clouds += `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${i % 3 ? '#0c1626' : '#16243a'}" opacity=".9"/>`;
  }
  return `<defs><linearGradient id="st" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05070f"/><stop offset=".7" stop-color="#1b2a40"/><stop offset="1" stop-color="#3b5a6a"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#st)"/>${clouds}
  <path d="M760 40L700 230L760 230L690 400L830 190L770 190L840 40Z" fill="#fff8d8"/><path d="M760 40L700 230L760 230L690 400L830 190L770 190L840 40Z" fill="#fff8d8" opacity=".5" transform="scale(1.02)"/>
  <circle cx="760" cy="230" r="170" fill="url(#glowK)" opacity=".35"/>
  <rect y="${hz}" width="${w}" height="${h - hz}" fill="url(#sea)"/>
  <g transform="rotate(-6 ${w * 0.3} ${hz})">${ship(w * 0.3, hz + 20, 0.7)}</g>
  ${waves(w, hz + 10, 24, 120, h, '#0c3a47', 0, 0.9)}${waves(w, hz + 70, 34, 160, h, '#071f2b', 50, 1)}${waves(w, hz + 130, 44, 220, h, '#030c14', 0, 1)}`;
})();
writeFileSync(out + 'shot-3.svg', wrap(SW, SH, storm));

// lantern and map
const lantern = (() => {
  const w = SW, h = SH;
  return `<defs><linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1608"/><stop offset="1" stop-color="#150a04"/></linearGradient>
  <radialGradient id="lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffc766" stop-opacity=".85"/><stop offset=".5" stop-color="#ff9a3c" stop-opacity=".25"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient></defs>
  <rect width="${w}" height="${h}" fill="#0a0604"/>
  <circle cx="${w * 0.72}" cy="${h * 0.3}" r="420" fill="url(#lamp)"/>
  <rect y="${h * 0.58}" width="${w}" height="${h * 0.42}" fill="url(#wood)"/>
  <g stroke="#3a210e" stroke-width="2" opacity=".7">${Array.from({ length: 8 }, (_, i) => `<path d="M0 ${h * 0.6 + i * 40}H${w}"/>`).join('')}</g>
  <g transform="translate(${w * 0.3} ${h * 0.5}) rotate(-4)">
    <path d="M-250 20L250 -10L270 190L-230 220Z" fill="#e8d5a0"/><path d="M-250 20L250 -10L270 190L-230 220Z" fill="#b98a3e" opacity=".25"/>
    <path d="M-200 150C-150 80 -80 120 -20 70S90 120 160 60" stroke="#6b3b12" stroke-width="3" stroke-dasharray="10 8" fill="none"/>
    <path d="M150 40l30 30M180 40l-30 30" stroke="#a31818" stroke-width="8" stroke-linecap="round"/>
    <path d="M-170 60c20-20 50-10 60 10s-10 40-40 30-30-20-20-40z" fill="#a98a4a" opacity=".6"/>
  </g>
  <g transform="translate(${w * 0.72} ${h * 0.28})"><path d="M-8 -90V-70M8 -90V-70" stroke="#2c1a0c" stroke-width="5"/><rect x="-36" y="-70" width="72" height="14" rx="4" fill="#2c1a0c"/>
    <path d="M-30 -56L-36 60H36L30 -56Z" fill="#ffd27a" opacity=".95"/><path d="M-30 -56L-36 60H36L30 -56Z" fill="none" stroke="#2c1a0c" stroke-width="6"/><path d="M0 -56V60M-33 2H33" stroke="#2c1a0c" stroke-width="3"/>
    <rect x="-42" y="60" width="84" height="14" rx="4" fill="#2c1a0c"/><ellipse cx="0" cy="0" rx="22" ry="40" fill="#fff3c8" opacity=".9"/></g>
  <g transform="translate(${w * 0.58} ${h * 0.78}) rotate(-12)" fill="#1d1109"><rect width="260" height="22" rx="8"/><rect x="-30" y="-4" width="40" height="30" rx="6"/><rect x="250" y="-6" width="34" height="34" rx="7"/><rect x="40" y="0" width="6" height="22" fill="#a8791f"/><rect x="170" y="0" width="6" height="22" fill="#a8791f"/></g>`;
})();
writeFileSync(out + 'shot-4.svg', wrap(SW, SH, lantern));

// skull flag
const flag = (() => {
  const w = SW, h = SH;
  return `<defs><linearGradient id="fs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050a18"/><stop offset="1" stop-color="#17505c"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#fs)"/>${stars(w, h, 90, 9, h * 0.6)}
  <circle cx="${w * 0.8}" cy="${h * 0.22}" r="80" fill="#fff3cc"/><circle cx="${w * 0.8}" cy="${h * 0.22}" r="200" fill="url(#moon)"/>
  <rect x="${w * 0.16}" y="60" width="12" height="${h}" fill="#1a0e06"/>
  <path d="M${w * 0.16 + 12} 90C${w * 0.3} 60 ${w * 0.42} 140 ${w * 0.58} 100S${w * 0.7} 70 ${w * 0.76} 120L${w * 0.72} 190L${w * 0.76} 260L${w * 0.72} 330C${w * 0.62} 360 ${w * 0.5} 290 ${w * 0.4} 330S${w * 0.26} 360 ${w * 0.16 + 12} 340Z" fill="#05070e" stroke="#1d2a3a" stroke-width="4"/>
  ${skull(w * 0.46, 210, 3.6)}
  ${waves(w, h * 0.86, 20, 180, h, '#06202c', 20, 1)}${waves(w, h * 0.93, 26, 240, h, '#030c14', 0, 1)}`;
})();
writeFileSync(out + 'shot-5.svg', wrap(SW, SH, flag));
console.log('wrote placeholder art to', out);
