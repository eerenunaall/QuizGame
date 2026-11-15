import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from '../helpers/server';

const ADMIN_HTML = `<!doctype html><html><head><title>Yönetim</title></head><body><div id="root"></div>
<script type="module" src="/admin/assets/index-AbCd1234.js"></script></body></html>`;
const WEB_HTML = '<!doctype html><html><head><title>Web</title></head><body>web</body></html>';

let server: TestServer;
let admin: string;
let web: string;
beforeAll(async () => {
  admin = await mkdtemp(join(tmpdir(), 'qp-admin-'));
  web = await mkdtemp(join(tmpdir(), 'qp-web2-'));
  await mkdir(join(admin, 'assets'));
  await writeFile(join(admin, 'index.html'), ADMIN_HTML);
  await writeFile(join(admin, 'assets', 'index-AbCd1234.js'), 'console.log("admin")');
  await writeFile(join(web, 'index.html'), WEB_HTML);
  server = await startServer({
    env: { SERVE_WEB: '1', WEB_DIST: web, SERVE_ADMIN: '1', ADMIN_DIST: admin },
  });
});
afterAll(async () => {
  await server.dispose();
  await rm(admin, { recursive: true, force: true });
  await rm(web, { recursive: true, force: true });
});

const get = (path: string, init: RequestInit = {}) =>
  fetch(`${server.httpUrl}${path}`, { redirect: 'manual', ...init });

describe('serving the admin console under /admin', () => {
  it('serves its own shell, not the player app, with a strict CSP and no framing', async () => {
    const response = await get('/admin/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Yönetim');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await (await get('/')).text()).toContain('web');
  });

  it('redirects /admin to /admin/ and keeps client routes inside the console', async () => {
    const bare = await get('/admin');
    expect(bare.status).toBe(308);
    expect(bare.headers.get('location')).toBe('/admin/');
    const route = await get('/admin/questions/abc');
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('Yönetim');
  });

  it('serves fingerprinted assets forever, 404s a missing asset, and never leaks the web app files', async () => {
    const asset = await get('/admin/assets/index-AbCd1234.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await get('/admin/assets/missing-12345678.js')).status).toBe(404);
    expect((await get('/admin/v1/admin/stats')).status).toBe(404);
    expect((await get('/admin/..%2f..%2fetc/passwd')).status).toBe(404);
    expect((await get('/admin/.env')).status).toBe(404);
  });

  it('is read-only: only GET and HEAD', async () => {
    expect((await get('/admin/', { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('keeps the API behind the guard even when the console is mounted', async () => {
    expect((await get('/v1/admin/stats')).status).toBe(401);
  });
});
