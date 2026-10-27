// Tiny static server for previewing the site locally (zero dependencies).
//   node tools/serve.mjs [port]      then open http://localhost:8099
// It mimics a normal static host: folders serve index.html, unknown paths serve 404.html with status 404.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.argv[2] ?? 8099);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

// The catch-all block of _headers is applied too, so a CSP violation shows up here instead of on the live site.
const SITE_HEADERS = {};
try {
  let on = false;
  for (const line of (await readFile(join(ROOT, '_headers'), 'utf8')).split('\n')) {
    if (/^\S/.test(line) && !line.startsWith('#')) on = line.trim() === '/*';
    else if (on && /^\s+[\w-]+:/.test(line)) { const i = line.indexOf(':'); SITE_HEADERS[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  delete SITE_HEADERS['Strict-Transport-Security']; // http preview: no HSTS, and no https upgrade
  if (SITE_HEADERS['Content-Security-Policy']) SITE_HEADERS['Content-Security-Policy'] = SITE_HEADERS['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');
} catch { /* no _headers file: serve without them */ }

async function find(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, clean);
  if (!file.startsWith(ROOT)) return null;
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    await stat(file);
    return file;
  } catch { return null; }
}

createServer(async (req, res) => {
  const file = await find(req.url ?? '/');
  const status = file ? 200 : 404;
  const target = file ?? join(ROOT, '404.html');
  try {
    const body = await readFile(target);
    res.writeHead(status, { ...SITE_HEADERS, 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(500); res.end('error'); }
}).listen(PORT, () => console.log(`Archonbite site preview: http://localhost:${PORT}`));
