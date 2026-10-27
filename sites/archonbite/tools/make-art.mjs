// Dev-time helper (NOT needed to deploy): renders the share images (1200x630), the QuizNight key art/capsule and the
// favicon PNGs with a headless Chromium. Uses Playwright from the repo's node_modules (never run `playwright install`).
//
//   node sites/archonbite/tools/make-art.mjs
//
// Inputs are this site's own assets (fonts, mark, QuizNight screenshots, placeholder art). Output: assets/img/*.jpg|png
// and assets/quiznight/key-art.jpg|capsule.jpg|square.jpg.
import { chromium } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const A = (p) => pathToFileURL(ROOT + p).href;
const FONTS = `
@font-face{font-family:Bricolage;font-weight:200 800;src:url(${A('assets/fonts/bricolage-latin.woff2')}) format('woff2');unicode-range:U+0000-00FF,U+2013-2026}
@font-face{font-family:Bricolage;font-weight:200 800;src:url(${A('assets/fonts/bricolage-latin-ext.woff2')}) format('woff2');unicode-range:U+0100-017F}
@font-face{font-family:Inter;font-weight:100 900;src:url(${A('assets/fonts/inter-latin.woff2')}) format('woff2');unicode-range:U+0000-00FF,U+2013-2026}
@font-face{font-family:Inter;font-weight:100 900;src:url(${A('assets/fonts/inter-latin-ext.woff2')}) format('woff2');unicode-range:U+0100-017F}
*{box-sizing:border-box;margin:0}body{font-family:Inter,sans-serif;color:#f6efde;overflow:hidden}`;

const confetti = (seed = 3) => {
  let s = seed; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cols = ['#ffd84a', '#ff7a4a', '#4aa8ff', '#b36bff', '#3fd9a0'];
  return Array.from({ length: 70 }, (_, i) =>
    `<i style="position:absolute;left:${(r() * 100).toFixed(1)}%;top:${(r() * 100).toFixed(1)}%;width:${(6 + r() * 9).toFixed(0)}px;height:${(4 + r() * 6).toFixed(0)}px;background:${cols[i % 5]};opacity:${(0.35 + r() * 0.55).toFixed(2)};transform:rotate(${(r() * 180).toFixed(0)}deg);border-radius:2px"></i>`).join('');
};

// QuizNight composition: logo + TV screenshot + phone. `mode` picks the layout for each output size.
const qn = (w, h, { logo = true, text = '', sub = '', small = false } = {}) => `<style>${FONTS}
body{width:${w}px;height:${h}px;background:radial-gradient(70% 90% at 78% 40%,#4a2a9a 0%,#1a1550 45%,#0a0a22 100%);position:relative}
.glow{position:absolute;right:-5%;top:-10%;width:70%;height:120%;background:radial-gradient(closest-side,rgba(255,200,80,.35),transparent)}
.tv{position:absolute;border-radius:${small ? 10 : 18}px;border:${small ? 6 : 10}px solid #12141f;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 2px rgba(255,255,255,.12);overflow:hidden;transform:rotate(-3deg)}
.tv img{display:block;width:100%}
.ph{position:absolute;border-radius:${small ? 18 : 30}px;border:${small ? 4 : 7}px solid #12141f;box-shadow:0 24px 60px rgba(0,0,0,.65),0 0 0 2px rgba(255,255,255,.14);overflow:hidden;transform:rotate(5deg)}
.ph img{display:block;width:100%}
.logo{position:absolute}.mascot{position:absolute}
h1{position:absolute;font:800 ${small ? 64 : 96}px/1 Bricolage;letter-spacing:-.01em}
p.sub{position:absolute;font:600 ${small ? 28 : 34}px/1.3 Inter;color:#e9dfc4}
</style><div class="glow"></div><div style="position:absolute;inset:0">${confetti()}</div>`;

const pages = {
  // --- QuizNight art
  'assets/quiznight/key-art.jpg': { w: 1600, h: 900, html: qn(1600, 900) +
    `<img class="logo" src="${A('assets/quiznight/logo.webp')}" style="left:900px;top:14px;width:620px">
     <div class="tv" style="left:800px;top:290px;width:700px"><img src="${A('assets/quiznight/tv-question.webp')}"></div>
     <div class="ph" style="left:1360px;top:440px;width:200px"><img src="${A('assets/quiznight/phone-risk.webp')}"></div>
     <img class="mascot" src="${A('assets/quiznight/mascot.webp')}" style="left:660px;top:520px;height:350px">`, q: 84 },
  'assets/quiznight/capsule.jpg': { w: 920, h: 430, html: qn(920, 430, { small: true }) +
    `<img class="logo" src="${A('assets/quiznight/logo.webp')}" style="left:30px;top:16px;width:380px">
     <div class="tv" style="left:380px;top:150px;width:420px"><img src="${A('assets/quiznight/tv-question.webp')}"></div>
     <div class="ph" style="left:770px;top:215px;width:110px"><img src="${A('assets/quiznight/phone-risk.webp')}"></div>
     <img class="mascot" src="${A('assets/quiznight/mascot.webp')}" style="left:40px;top:150px;height:260px">`, q: 84 },
  'assets/quiznight/square.jpg': { w: 192, h: 192, html: `<style>${FONTS}body{width:192px;height:192px;background:radial-gradient(80% 80% at 50% 40%,#4a2a9a,#0a0a22)}</style>
     <img src="${A('assets/quiznight/mascot.webp')}" style="position:absolute;left:34px;top:8px;height:176px">`, q: 84 },
  // --- share images
  'assets/img/og-quiznight.jpg': { w: 1200, h: 630, html: qn(1200, 630, { small: true }) +
    `<img class="logo" src="${A('assets/quiznight/logo.webp')}" style="left:44px;top:60px;width:560px">
     <p class="sub" style="left:56px;top:250px;width:520px">TV sahne, telefon kumanda.<br>Parti bilgi yarışması.</p>
     <div class="tv" style="left:560px;top:150px;width:560px"><img src="${A('assets/quiznight/tv-question.webp')}"></div>
     <div class="ph" style="left:1000px;top:300px;width:150px"><img src="${A('assets/quiznight/phone-risk.webp')}"></div>
     <div style="position:absolute;left:56px;bottom:44px;font:800 30px Bricolage;letter-spacing:.14em"><img src="${A('assets/img/mark.svg')}" style="width:40px;vertical-align:middle;margin-right:12px">ARCHON<span style="color:#f1b445">BITE</span></div>`, q: 86 },
  'assets/img/og-home.jpg': { w: 1200, h: 630, html: `<style>${FONTS}
     body{width:1200px;height:630px;background:#07080d;position:relative}
     .l{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 100%}
     .dim{position:absolute;inset:0;background:radial-gradient(60% 55% at 50% 52%,rgba(7,8,13,.88),rgba(7,8,13,.35) 70%,transparent)}
     h1{position:absolute;left:0;right:0;top:230px;text-align:center;font:800 130px/1 Bricolage;letter-spacing:.08em;text-shadow:0 6px 40px #000}
     h1 b{background:linear-gradient(100deg,#b9740f,#ffe9b0 45%,#f1b445 60%,#b9740f);-webkit-background-clip:text;color:transparent}
     p{position:absolute;left:0;right:0;top:395px;text-align:center;font:600 40px Bricolage;color:#efe5cc}
     </style><img class="l" src="${A('assets/img/hero-back.svg')}"><img class="l" src="${A('assets/img/hero-mid.svg')}"><img class="l" src="${A('assets/img/hero-front.svg')}"><div class="dim"></div>
     <img src="${A('assets/img/mark.svg')}" style="position:absolute;left:560px;top:80px;width:80px;filter:drop-shadow(0 0 20px rgba(241,180,69,.6))">
     <h1>ARCHON<b>BITE</b></h1><p>Aynı masada oynanan oyunlar · Games for the same table</p>`, q: 86 },
  'assets/img/og-salty-pirate.jpg': { w: 1200, h: 630, html: `<style>${FONTS}
     body{width:1200px;height:630px;background:#040916;position:relative}
     .l{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
     .s{position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,9,22,.92),rgba(4,9,22,.2) 70%)}
     h1{position:absolute;left:60px;top:200px;font:800 120px/.95 Bricolage;color:#fff3d0;text-shadow:0 6px 30px #000;width:560px}
     p{position:absolute;left:64px;top:470px;font:600 34px Bricolage;color:#e9dfc4}
     </style><img class="l" src="${A('assets/salty-pirate/key-art.svg')}"><div class="s"></div>
     <h1>Salty<br>Pirate</h1><p>Archonbite</p>`, q: 86 },
  'assets/img/og-play.jpg': { w: 1200, h: 630, html: qn(1200, 630, { small: true }) +
    `<h1 style="left:56px;top:150px;width:520px">QuizNight'ı<br>şimdi oyna</h1>
     <p class="sub" style="left:60px;top:370px;width:480px">TV'de aç, QR'ı okut, telefonla yarış. Kurulum yok.</p>
     <div class="tv" style="left:600px;top:150px;width:540px"><img src="${A('assets/quiznight/tv-lobby.webp')}"></div>
     <div class="ph" style="left:1010px;top:310px;width:140px"><img src="${A('assets/quiznight/phone-answer.webp')}"></div>`, q: 86 },
  'assets/img/og-guide.jpg': { w: 1200, h: 630, html: qn(1200, 630, { small: true }) +
    `<h1 style="left:56px;top:150px;width:520px">QuizNight<br>nasıl oynanır</h1>
     <p class="sub" style="left:60px;top:370px;width:480px">Risk, sabotaj ve jokerlerin tüm kuralları.</p>
     <div class="tv" style="left:600px;top:150px;width:540px"><img src="${A('assets/quiznight/tv-risk.webp')}"></div>
     <div class="ph" style="left:1010px;top:310px;width:140px"><img src="${A('assets/quiznight/phone-sabotage.webp')}"></div>`, q: 86 },
};

const browser = await chromium.launch();
const tmp = mkdtempSync(join(tmpdir(), 'ab-art-'));
let n = 0;
for (const [file, spec] of Object.entries(pages)) {
  const page = await browser.newPage({ viewport: { width: spec.w, height: spec.h } });
  const f = join(tmp, `p${n++}.html`);
  writeFileSync(f, `<!doctype html><meta charset="utf-8">${spec.html}`);
  await page.goto(pathToFileURL(f).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: ROOT + file, type: 'jpeg', quality: spec.q });
  await page.close();
  console.log('wrote', file);
}
// favicons / app icons from the SVG mark
const icon = async (name, size, svgFile, bg) => {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const f = join(tmp, name + '.html');
  writeFileSync(f, `<!doctype html><style>*{margin:0}body{width:${size}px;height:${size}px;background:${bg ?? 'transparent'}}img{width:100%;height:100%;display:block}</style><img src="${A(svgFile)}">`);
  await page.goto(pathToFileURL(f).href);
  await page.screenshot({ path: ROOT + 'assets/img/' + name, omitBackground: !bg });
  await page.close();
  console.log('wrote assets/img/' + name);
};
await icon('favicon-32.png', 32, 'assets/img/favicon.svg');
await icon('apple-touch-icon.png', 180, 'assets/img/favicon.svg', '#0a0b12');
await icon('icon-192.png', 192, 'assets/img/favicon.svg');
await icon('icon-512.png', 512, 'assets/img/favicon.svg');
await browser.close();
