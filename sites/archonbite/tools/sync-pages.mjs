// Dev-time helper (NOT needed to deploy): keeps the repeated parts of every page identical and writes the Turkish
// text from assets/i18n/tr.json into the static HTML, so the pages read correctly without JavaScript and for search
// engines. The browser script still applies the dictionary at runtime, so editing a JSON file alone is enough
// to change text on the live site; run this once afterwards only if you want the static fallback refreshed.
//
//   node tools/sync-pages.mjs        (zero dependencies)
//
// What it rewrites: the <head> block, the site header and footer between their marker comments, and every
// element carrying data-i18n / data-i18n-html / data-i18n-attr.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE = 'https://archonbite.com';
const tr = JSON.parse(readFileSync(ROOT + 'assets/i18n/tr.json', 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const org = {
  '@context': 'https://schema.org', '@type': 'Organization', name: 'Archonbite', url: SITE + '/',
  logo: SITE + '/assets/img/icon-512.png', description: 'Independent game studio / Bağımsız oyun stüdyosu',
};
const publisher = { '@type': 'Organization', name: 'Archonbite', url: SITE + '/' };
const pages = [
  { file: 'index.html', path: '/', page: 'home', nav: '', og: 'og-home.jpg', ld: [org], extraHead: ['<script src="{P}assets/fx.js" defer></script>', '<link rel="preload" href="{P}data/games.json" as="fetch" crossorigin>'] },
  { file: 'play/index.html', path: '/play/', page: 'play', nav: 'play', og: 'og-play.jpg', ld: [] },
  { file: 'guide/index.html', path: '/guide/', page: 'guide', nav: 'guide', og: 'og-guide.jpg', ld: [] },
  { file: 'legal/index.html', path: '/legal/', page: 'legal', nav: '', og: 'og-home.jpg', ld: [] },
  {
    file: 'games/quiznight/index.html', path: '/games/quiznight/', page: 'game', nav: 'quiznight', og: 'og-quiznight.jpg',
    extraHead: ['<link rel="preload" href="{P}data/games.json" as="fetch" crossorigin>', '<link rel="preload" href="{P}assets/quiznight/tv-lobby.webp" as="image" fetchpriority="high">'],
    title: 'QuizNight | Archonbite',
    desc: "TV'yi sahneye, telefonları kumandaya çeviren parti bilgi yarışması. QR'ı okut, bahsini seç, rakibine sabotaj yap.",
    ld: [{
      '@context': 'https://schema.org', '@type': 'VideoGame', name: 'QuizNight', url: SITE + '/games/quiznight/',
      description: "TV'yi sahneye, telefonları kumandaya çeviren parti bilgi yarışması. / The party quiz that turns the TV into a stage and phones into controllers.",
      image: SITE + '/assets/img/og-quiznight.jpg', genre: ['Party', 'Trivia'], gamePlatform: 'Web browser', applicationCategory: 'Game',
      playMode: 'MultiPlayer', numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 8 }, inLanguage: ['tr', 'en'],
      publisher, author: publisher,
    }],
  },
  {
    file: 'games/salty-pirate/index.html', path: '/games/salty-pirate/', page: 'game', nav: 'salty', og: 'og-salty-pirate.jpg',
    extraHead: ['<script src="{P}assets/storm.js" defer></script>', '<script src="{P}assets/salty.js" defer></script>', '<script src="{P}assets/tentacles.js" defer></script>', '<link rel="preload" href="{P}assets/fonts/pirata-one-latin.woff2" as="font" type="font/woff2" crossorigin>', '<link rel="preload" href="{P}data/games.json" as="fetch" crossorigin>'],
    title: 'Salty Pirates | Archonbite',
    desc: "Salty Pirates, Archonbite'ın ikinci oyunu. Bilgiler ve görseller eklendikçe bu sayfa dolacak.",
    ld: [{
      '@context': 'https://schema.org', '@type': 'VideoGame', name: 'Salty Pirates', url: SITE + '/games/salty-pirate/',
      description: "Archonbite'ın ikinci oyunu. / Archonbite's second game.", image: SITE + '/assets/img/og-salty-pirate.jpg', applicationCategory: 'Game', publisher, author: publisher,
    }],
  },
  { file: '404.html', path: '/404.html', page: 'e404', nav: '', og: 'og-home.jpg', abs: true, noindex: true, ld: [] },
];

function prefix(p) {
  if (p.abs) return '/';
  const depth = p.file.split('/').length - 1;
  return depth === 0 ? './' : '../'.repeat(depth);
}

function head(p) {
  const P = prefix(p);
  const title = p.title ?? tr[p.page + '.title'];
  const desc = p.desc ?? tr[p.page + '.desc'];
  const canon = SITE + p.path;
  const img = `${SITE}/assets/img/${p.og}`;
  const lines = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    p.noindex ? '<meta name="robots" content="noindex">' : '',
    `<link rel="canonical" href="${canon}">`,
    p.noindex ? '' : `<link rel="alternate" hreflang="tr" href="${canon}">`,
    p.noindex ? '' : `<link rel="alternate" hreflang="en" href="${canon}?lang=en">`,
    p.noindex ? '' : `<link rel="alternate" hreflang="x-default" href="${canon}">`,
    '<meta name="theme-color" content="#07080d">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Archonbite">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${canon}">`,
    `<meta property="og:image" content="${img}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:locale" content="tr_TR">',
    '<meta property="og:locale:alternate" content="en_US">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${img}">`,
    `<link rel="icon" href="${P}assets/img/favicon.svg" type="image/svg+xml">`,
    `<link rel="icon" href="${P}assets/img/favicon-32.png" type="image/png" sizes="32x32">`,
    `<link rel="apple-touch-icon" href="${P}assets/img/apple-touch-icon.png">`,
    `<link rel="manifest" href="${P}site.webmanifest">`,
    `<link rel="preload" href="${P}assets/fonts/bricolage-latin-2.woff2" as="font" type="font/woff2" crossorigin>`,
    `<link rel="stylesheet" href="${P}assets/site.css">`,
    `<script src="${P}assets/config.js"></script>`,
    `<script src="${P}assets/boot.js"></script>`,
    `<script src="${P}assets/app.js" defer></script>`,
    ...(p.extraHead ?? []).map((l) => l.replaceAll('{P}', P)),
    ...p.ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`),
  ].filter(Boolean);
  return lines.join('\n');
}

function header(p) {
  const P = prefix(p);
  const cur = (k) => (p.nav === k ? ' aria-current="page"' : '');
  return `<a class="skip" href="#main" data-i18n="skip"></a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${P}" data-i18n-attr="aria-label:nav.home" aria-label=""><img src="${P}assets/img/mark.svg" width="34" height="34" alt=""><span>ARCHON<b>BITE</b></span></a>
    <button class="menu-btn only-js" type="button" aria-expanded="false" aria-controls="nav" data-i18n-attr="aria-label:nav.menu" aria-label=""><span></span></button>
    <nav class="nav" id="nav" data-i18n-attr="aria-label:nav.main" aria-label="">
      <a href="${P}games/quiznight/"${cur('quiznight')}>QuizNight</a>
      <a href="${P}games/salty-pirate/"${cur('salty')}>Salty Pirates</a>
      <a href="${P}guide/"${cur('guide')} data-i18n="nav.guide"></a>
      <a class="btn btn-gold btn-sm" href="${P}play/"${cur('play')} data-i18n="nav.play"></a>
      <div class="lang only-js" role="group" data-i18n-attr="aria-label:nav.lang" aria-label=""><button type="button" data-set-lang="tr" aria-pressed="true">TR</button><button type="button" data-set-lang="en" aria-pressed="false">EN</button></div>
    </nav>
  </div>
</header>`;
}

function footer(p) {
  const P = prefix(p);
  return `<footer class="site-footer scope-dark">
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <a class="brand" href="${P}" data-i18n-attr="aria-label:nav.home" aria-label=""><img src="${P}assets/img/mark.svg" width="34" height="34" alt=""><span>ARCHON<b>BITE</b></span></a>
        <p data-i18n="foot.tag"></p>
      </div>
      <div><h2 data-i18n="common.games"></h2><ul>
        <li><a href="${P}games/quiznight/">QuizNight</a></li>
        <li><a href="${P}games/salty-pirate/">Salty Pirates</a></li>
        <li><a href="${P}play/" data-i18n="nav.play"></a></li></ul></div>
      <div><h2 data-i18n="common.studio"></h2><ul>
        <li><a href="${P}guide/" data-i18n="nav.guide"></a></li>
        <li><a href="${P}play/#venues" data-i18n="home.slide.venue.cta"></a></li>
        <li><a href="mailto:hello@archonbite.com" data-mailto data-i18n="common.contact"></a></li></ul></div>
      <div><h2 data-i18n="common.legal"></h2><ul>
        <li><a href="${P}legal/" data-i18n="common.privacy"></a></li></ul></div>
    </div>
    <div class="footer-note"><span data-i18n="foot.rights"></span><span data-i18n="foot.nocookie"></span></div>
  </div>
</footer>`;
}

const region = (name, html) => `<!--@${name}-->\n${html}\n<!--@/${name}-->`;
const reRegion = (name) => new RegExp(`<!--@${name}-->[\\s\\S]*?<!--@/${name}-->`);

function fillI18n(src) {
  // text / html content
  src = src.replace(/(<(\w+)\b[^>]*?\sdata-i18n(-html)?="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, isHtml, key, _old, close) => {
    const v = tr[key];
    if (v === undefined) throw new Error('missing tr key: ' + key);
    return open + (isHtml ? v : esc(v)).replace(/&quot;/g, '"') + close;
  });
  // attributes: data-i18n-attr="attr:key;attr2:key2"
  src = src.replace(/<(\w+)\b[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g, (tagText, _t, spec) => {
    let out = tagText;
    for (const pair of spec.split(';')) {
      const [attr, key] = pair.split(':');
      const v = tr[key];
      if (v === undefined) throw new Error('missing tr key: ' + key);
      const re = new RegExp(`(\\s${attr}=")[^"]*(")`);
      out = re.test(out) ? out.replace(re, `$1${esc(v)}$2`) : out.replace(/>$/, ` ${attr}="${esc(v)}">`);
    }
    return out;
  });
  return src;
}

for (const p of pages) {
  const path = ROOT + p.file;
  let src = readFileSync(path, 'utf8');
  src = src.replace(/<html[^>]*>/, `<html lang="tr" class="no-js" data-page="${p.page}">`);
  if (reRegion('head').test(src)) src = src.replace(reRegion('head'), () => region('head', head(p)));
  else throw new Error(p.file + ': missing head region');
  src = src.replace(reRegion('header'), () => region('header', header(p)));
  src = src.replace(reRegion('footer'), () => region('footer', footer(p)));
  src = fillI18n(src);
  writeFileSync(path, src);
  console.log('synced', p.file);
}
