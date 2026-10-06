import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSafe } from '../../apps/realtime/src/http/static-web';
import { startServer, type TestServer } from '../helpers/server';

const INLINE = '!function(){document.title="legacy"}();';
const HTML = `<!doctype html><html><head><title>Quiz Party</title></head><body><div id="root"></div>
<script nomodule>${INLINE}</script><script type="module" src="/assets/index-AbCd1234.js"></script></body></html>`;

let server: TestServer;
let dist: string;
beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'qp-web-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), HTML);
  await writeFile(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(dist, 'assets', 'index-AbCd1234.js'), 'console.log("app")');
  await writeFile(join(dist, 'assets', 'plain.css'), 'body{margin:0}');
  await writeFile(join(dist, '.env'), 'SECRET=1');
  server = await startServer({ env: { SERVE_WEB: '1', WEB_DIST: dist } });
});
afterAll(async () => {
  await server.dispose();
  await rm(dist, { recursive: true, force: true });
});

const get = (path: string, init: RequestInit = {}) => fetch(`${server.httpUrl}${path}`, init);

describe('serving the web app', () => {
  it('serves the shell with a strict CSP that allows exactly the inline scripts it ships', async () => {
    const response = await get('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    const csp = response.headers.get('content-security-policy') ?? '';
    const hash = createHash('sha256').update(INLINE).digest('base64');
    expect(csp).toContain(`'sha256-${hash}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self' 'sha256-");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/connect-src 'self' ws:\/\/localhost:5173/u);
    expect(await response.text()).toContain('id="root"');
  });

  it('falls back to the app for client-side routes but never for missing files or API paths', async () => {
    for (const path of [
      '/tv',
      '/join',
      '/join/ABC234',
      '/play/ABC234',
      '/credits',
      '/anything/else',
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toContain('text/html');
    }
    const missingAsset = await get('/assets/missing-12345678.js');
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.headers.get('content-type')).toContain('application/json');
    const missingApi = await get('/v1/nope');
    expect(missingApi.status).toBe(404);
    expect(await missingApi.json()).toEqual({ error: { code: 'NOT_FOUND' } });
  });

  it('caches fingerprinted assets forever and everything else not at all', async () => {
    const hashed = await get('/assets/index-AbCd1234.js');
    expect(hashed.status).toBe(200);
    expect(hashed.headers.get('content-type')).toContain('text/javascript');
    expect(hashed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(hashed.headers.get('x-content-type-options')).toBe('nosniff');
    const plain = await get('/assets/plain.css');
    expect(plain.headers.get('cache-control')).toBe('no-cache');
    expect(plain.headers.get('content-type')).toContain('text/css');
    expect((await get('/favicon.svg')).headers.get('content-type')).toBe('image/svg+xml');
  });

  it('supports HEAD and conditional requests', async () => {
    const first = await get('/assets/index-AbCd1234.js');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\//u);
    const conditional = await get('/assets/index-AbCd1234.js', {
      headers: { 'if-none-match': etag! },
    });
    expect(conditional.status).toBe(304);
    const head = await get('/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await get('/', { method: 'POST' })).status).toBe(404);
  });

  it('refuses path traversal, dotfiles and malformed paths', async () => {
    const attempts = [
      '/..%2f..%2fetc%2fpasswd',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/assets/..%5c..%5csecret',
      '/.env',
      '/assets/%2e%2e/.env',
      '/%00',
      '/%ff%fe',
      '/assets/..%2f..%2f..%2fpackage.json',
      '//etc/passwd',
    ];
    for (const path of attempts) {
      const response = await get(path);
      const body = await response.text();
      expect(body, path).not.toContain('SECRET=1');
      expect(body, path).not.toContain('root:');
      expect([200, 400, 404], path).toContain(response.status);
      if (response.status === 200)
        expect(response.headers.get('content-type'), path).toContain('text/html');
    }
  });

  it('keeps the strict API headers on API responses', async () => {
    const response = await get('/healthz');
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('resolveSafe', () => {
  const root = '/srv/web';
  it('keeps every result inside the root', () => {
    expect(resolveSafe(root, '/assets/app.js')).toBe('/srv/web/assets/app.js');
    expect(resolveSafe(root, '/')).toBe('/srv/web');
    for (const bad of [
      '/../x',
      '/a/../../x',
      '/%2e%2e/x',
      '/a\\b',
      '/.git/config',
      '/a/.hidden',
      '/a%00b',
      '/%E0%A4%A',
    ]) {
      expect(resolveSafe(root, bad), bad).toBeNull();
    }
  });
});
