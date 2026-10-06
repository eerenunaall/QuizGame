import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { apiError } from './routes';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Prefixes that belong to the API: they never fall back to the single-page app. */
const API_PREFIXES = ['/v1/', '/ws', '/metrics', '/healthz', '/readyz'];

/**
 * Maps a request path to a file under `root`, or null when the path is unsafe: undecodable, NUL
 * bytes, backslashes, dot segments, dotfiles. The resolved path is re-checked to stay inside root.
 */
export function resolveSafe(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment.startsWith('.'))) return null; // .., ., .env, .git …
  const target = join(root, ...segments);
  return target === root || target.startsWith(root + sep) ? target : null;
}

export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script>/giu)) {
    const attrs = match.groups?.attrs ?? '';
    const body = match.groups?.body ?? '';
    if (/\bsrc\s*=/iu.test(attrs) || body.trim().length === 0) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  return hashes;
}

/**
 * Content-Security-Policy for the app shell. Scripts and styles come from this origin only; the
 * few inline scripts the build emits (legacy-browser shims) are allowed by hash, never wholesale.
 */
export function buildCsp(inlineHashes: readonly string[], webSocketOrigin: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' ${inlineHashes.join(' ')}`.trim(),
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src 'self' ${webSocketOrigin}`,
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export interface StaticWebOptions {
  root: string;
  /** `ws://host` / `wss://host` of the public web origin (Safari needs it spelled out). */
  webSocketOrigin: string;
  production: boolean;
}

/** Serves the built web app: hashed assets forever, the HTML shell never, unknown routes → the SPA. */
export class StaticWeb {
  private csp = '';
  private readonly options: StaticWebOptions;

  constructor(options: StaticWebOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    const html = await readFile(join(this.options.root, 'index.html'), 'utf8').catch(() => {
      throw new Error(
        `SERVE_WEB is on but ${this.options.root}/index.html does not exist (build the web app first)`,
      );
    });
    this.csp = buildCsp(inlineScriptHashes(html), this.options.webSocketOrigin);
  }

  async handle(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const path = request.raw.url?.split('?')[0] ?? '/';
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return apiError(reply, 404, 'NOT_FOUND');
    if (
      API_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, '') || path.startsWith(prefix))
    )
      return apiError(reply, 404, 'NOT_FOUND');

    const safe = resolveSafe(this.options.root, path);
    if (safe === null) return apiError(reply, 404, 'NOT_FOUND');

    let file = safe;
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    const asksForAsset = extname(path) !== '';
    if (!info?.isFile()) {
      if (asksForAsset) return apiError(reply, 404, 'NOT_FOUND'); // a missing .js must not become HTML
      file = join(this.options.root, 'index.html');
      info = await stat(file).catch(() => null);
      if (!info?.isFile()) return apiError(reply, 404, 'NOT_FOUND');
    }

    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const isHtml = type.startsWith('text/html');
    const hashed = /[./-][A-Za-z0-9_-]{8}\.[a-z0-9]+$/u.test(file) && path.startsWith('/assets/');
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;

    void reply
      .header('Content-Type', type)
      .header('Content-Length', String(info.size))
      .header('ETag', etag)
      .header('Last-Modified', info.mtime.toUTCString())
      .header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (isHtml) void reply.header('Content-Security-Policy', this.csp);

    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    if (request.method === 'HEAD') return reply.code(200).send();
    return reply.code(200).send(createReadStream(file));
  }
}
