// Site self-check (zero dependencies):  node tools/check.mjs
// Fails (exit 1) when: an internal link or asset reference does not resolve, a page lacks lang/title/description/one h1,
// an external http(s) subresource slipped in, a JSON file is invalid, tr/en dictionaries differ in keys, a data-i18n key is
// missing, a {tr,en} text in games.json lacks a language, inline script/style would break the strict CSP, or an <img>
// has no alt/width/height. Warns (exit 0) about unused i18n keys and Turkish text that is stale against tr.json.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const html = files.filter((f) => f.endsWith('.html'));

// ---- 1. JSON validity
const jsonFiles = files.filter((f) => f.endsWith('.json') || f.endsWith('.webmanifest'));
const parsed = {};
for (const f of jsonFiles) {
  try { parsed[rel(f)] = JSON.parse(read(f)); } catch (e) { err(`${rel(f)}: invalid JSON (${e.message})`); }
}

// ---- 2. i18n parity and key usage
const tr = parsed['assets/i18n/tr.json'] ?? {};
const en = parsed['assets/i18n/en.json'] ?? {};
for (const k of Object.keys(tr)) if (!(k in en)) err(`en.json is missing key "${k}"`);
for (const k of Object.keys(en)) if (!(k in tr)) err(`tr.json is missing key "${k}"`);
for (const k of Object.keys(tr)) if (typeof tr[k] !== 'string' || !tr[k].trim()) err(`tr.json key "${k}" is empty`);
for (const k of Object.keys(en)) if (typeof en[k] !== 'string' || !en[k].trim()) err(`en.json key "${k}" is empty`);
const used = new Set();
const markUsed = (k) => used.add(k);

// games.json: every {tr,en} text complete
(function walkTexts(node, path) {
  if (Array.isArray(node)) node.forEach((n, i) => walkTexts(n, `${path}[${i}]`));
  else if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    if ((keys.includes('tr') || keys.includes('en')) && keys.every((k) => k === 'tr' || k === 'en')) {
      if (!node.tr || !node.en) err(`games.json ${path}: needs both "tr" and "en"`);
    } else for (const k of keys) walkTexts(node[k], `${path}.${k}`);
  }
})(parsed['data/games.json'] ?? {}, 'games');

// ---- 3. HTML checks
const REF_ATTR = /\s(?:href|src|poster|content)="([^"]*)"/g;
function resolveRef(fromFile, ref, isAbsPage) {
  let r = ref.split('#')[0].split('?')[0];
  if (!r) return { ok: true };
  if (/^(mailto:|tel:|data:|javascript:)/.test(r)) return { ok: true };
  if (/^https?:\/\//.test(r)) return { ok: true, external: true };
  const target = r.startsWith('/') ? join(ROOT, r) : resolve(dirname(fromFile), r);
  if (!target.startsWith(ROOT.replace(/[\\/]$/, ''))) return { ok: false };
  if (existsSync(target) && statSync(target).isDirectory()) return { ok: existsSync(join(target, 'index.html')) };
  return { ok: existsSync(target) };
}
for (const f of html) {
  const src = read(f), name = rel(f);
  const lang = /<html[^>]*\slang="(\w+)"/.exec(src);
  if (!lang) err(`${name}: <html lang> missing`);
  if (!/<title>[^<]{3,}<\/title>/.test(src)) err(`${name}: <title> missing`);
  if (!/<meta name="description" content="[^"]{20,}"/.test(src)) err(`${name}: meta description missing or too short`);
  const h1 = (src.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) err(`${name}: expected exactly one <h1>, found ${h1}`);
  if (!/<link rel="canonical"/.test(src)) err(`${name}: canonical link missing`);
  if (!/property="og:image"/.test(src) || !/name="twitter:card"/.test(src)) err(`${name}: Open Graph / Twitter tags missing`);
  if (name !== '404.html' && !/hreflang="en"/.test(src)) err(`${name}: hreflang alternates missing`);
  // CSP friendliness
  for (const m of src.matchAll(/<script\b([^>]*)>/g)) {
    if (!/\bsrc=/.test(m[1]) && !/type="application\/ld\+json"/.test(m[1])) err(`${name}: inline <script> would be blocked by CSP`);
  }
  if (/<style[\s>]/.test(src)) err(`${name}: inline <style> would be blocked by CSP`);
  if (/\sstyle="/.test(src)) err(`${name}: style="" attribute would be blocked by CSP`);
  if (/\son[a-z]+="/.test(src)) err(`${name}: inline event handler would be blocked by CSP`);
  // images
  for (const m of src.matchAll(/<img\b[^>]*>/g)) {
    const t = m[0];
    if (!/\salt=/.test(t)) err(`${name}: <img> without alt: ${t.slice(0, 80)}`);
    if (!/\swidth=/.test(t) || !/\sheight=/.test(t)) err(`${name}: <img> without width/height: ${t.slice(0, 80)}`);
  }
  // references
  const body = src.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  for (const m of body.matchAll(/<(link|script|img|source|iframe|a|video|audio)\b([^>]*)>/g)) {
    const attrs = m[2];
    const a = /\s(?:href|src|poster)="([^"]*)"/.exec(attrs);
    if (!a) continue;
    const isSub = m[1] !== 'a' && !(m[1] === 'link' && /rel="(canonical|alternate)"/.test(attrs));
    if (!a[1]) { err(`${name}: empty ${m[1]} reference`); continue; }
    const r = resolveRef(f, a[1]);
    if (r.external && isSub) err(`${name}: external subresource ${a[1]}`);
    if (!r.ok) err(`${name}: broken reference "${a[1]}"`);
  }
  for (const m of body.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) { markUsed(m[1]); if (!(m[1] in tr) || !(m[1] in en)) err(`${name}: i18n key "${m[1]}" missing in tr/en`); }
  for (const m of body.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) { const k = pair.split(':')[1]; markUsed(k); if (!(k in tr) || !(k in en)) err(`${name}: i18n key "${k}" missing in tr/en`); }
  const pk = /data-page="(\w+)"/.exec(src);
  if (pk) { markUsed(pk[1] + '.title'); markUsed(pk[1] + '.desc'); }
  // Turkish static text in sync with tr.json?
  for (const m of body.matchAll(/<(\w+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const want = (tr[m[2]] ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&quot;/g, '"');
    if (m[3] !== want) { warn(`${name}: static Turkish text for "${m[2]}" is stale (run node tools/sync-pages.mjs)`); break; }
  }
}
// keys used from JS
for (const f of files.filter((x) => x.endsWith('.js') && rel(x).startsWith('assets/'))) {
  const src = read(f);
  for (const m of src.matchAll(/\bt\('([\w.]+)'\)/g)) { markUsed(m[1]); if (!(m[1] in tr)) err(`${rel(f)}: t('${m[1]}') missing in tr.json`); }
  for (const m of src.matchAll(/'((?:store|common|home|games|play|nav)\.[\w.]+)'/g)) markUsed(m[1]);
}
for (const k of Object.keys(tr)) if (!used.has(k)) warn(`unused i18n key: ${k}`);

// ---- 4. games.json asset references
const games = parsed['data/games.json']?.games ?? [];
const assetFields = ['src', 'thumb', 'src_en', 'thumb_en', 'poster', 'capsule', 'header', 'bg', 'square', 'og', 'logo'];
(function walkAssets(node, path) {
  if (Array.isArray(node)) node.forEach((n, i) => walkAssets(n, `${path}[${i}]`));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) {
    if (assetFields.includes(k) && typeof v === 'string') {
      if (!existsSync(join(ROOT, v))) err(`games.json ${path}.${k}: file not found "${v}"`);
    } else walkAssets(v, `${path}.${k}`);
  }
})(games, 'games');
for (const g of games) {
  for (const k of ['play', 'guide']) if (g.links?.[k] && !existsSync(join(ROOT, g.links[k], 'index.html'))) err(`games.json ${g.id}.links.${k}: no such page`);
  if (!existsSync(join(ROOT, 'games', g.slug, 'index.html'))) err(`games.json ${g.id}: games/${g.slug}/index.html missing`);
}

// ---- 5. CSS / JS / manifest / sitemap references
for (const f of files.filter((x) => x.endsWith('.css'))) {
  const css = read(f);
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    const u = m[1];
    if (/^https?:/.test(u)) err(`${rel(f)}: external url() ${u}`);
    else if (!u.startsWith('data:') && !existsSync(resolve(dirname(f), u.split('#')[0].split('?')[0]))) err(`${rel(f)}: broken url() ${u}`);
  }
  if (/@import/.test(css)) err(`${rel(f)}: @import (external request risk)`);
}
for (const f of files.filter((x) => x.endsWith('.js') && rel(x).startsWith('assets/'))) {
  for (const m of read(f).matchAll(/https?:\/\/[^\s'")]+/g)) {
    const u = m[0];
    const ok = u.startsWith('http://www.w3.org/2000/svg') || u.startsWith('https://www.youtube-nocookie.com/embed/') || rel(f) === 'assets/config.js';
    if (!ok) err(`${rel(f)}: unexpected external URL ${u}`);
  }
}
for (const ic of parsed['site.webmanifest']?.icons ?? []) if (!existsSync(join(ROOT, ic.src))) err(`site.webmanifest: icon not found ${ic.src}`);
if (existsSync(join(ROOT, 'sitemap.xml'))) {
  for (const m of read(join(ROOT, 'sitemap.xml')).matchAll(/<loc>https:\/\/archonbite\.com([^<]*)<\/loc>/g)) {
    const p = m[1].split('?')[0];
    if (!existsSync(join(ROOT, p, p.endsWith('/') ? 'index.html' : ''))) err(`sitemap.xml: ${m[1]} has no file`);
  }
} else err('sitemap.xml missing');
for (const need of ['robots.txt', '_headers', '404.html', 'OWNER-FILL.md', 'DEPLOY.md', 'CREDITS.md']) if (!existsSync(join(ROOT, need))) err(`${need} missing`);
// big files / total JS weight
const jsBytes = files.filter((f) => extname(f) === '.js' && rel(f).startsWith('assets/')).reduce((n, f) => n + statSync(f).size, 0);
// 72 KB: storm.js, salty.js and tentacles.js load only on the Salty Pirates page; the shared pages stay well under 50 KB.
if (jsBytes > 72 * 1024) err(`total JS is ${(jsBytes / 1024).toFixed(1)} KB (budget 72 KB)`);
// the product name must never carry a model identifier
for (const f of files.filter((x) => /\.(html|js|css|json|md|mjs|xml|txt|webmanifest)$/.test(x) || x.endsWith('_headers'))) {
  if (/claude-|sonnet|opus|haiku/i.test(read(f)) && rel(f) !== 'tools/check.mjs') err(`${rel(f)}: contains a model identifier`);
}

console.log(`Checked ${html.length} pages, ${jsonFiles.length} JSON files, ${Object.keys(tr).length} i18n keys, JS ${(jsBytes / 1024).toFixed(1)} KB.`);
for (const w of warns) console.log('warning:', w);
for (const e of errors) console.log('ERROR:  ', e);
console.log(errors.length ? `\n${errors.length} problem(s).` : '\nAll checks passed.');
process.exit(errors.length ? 1 : 0);
