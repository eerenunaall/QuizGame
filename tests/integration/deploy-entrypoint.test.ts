import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';

/**
 * The line that starts the game server in the Docker image (infra/deployment/entrypoint.sh). Render
 * stops a deploy with SIGTERM to PID 1 (tini), which forwards it to this process only: if it is not the
 * node server itself, the server never drains its rooms or releases its leases (apps/realtime/src/main.ts).
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const entrypoint = readFileSync(`${root}/infra/deployment/entrypoint.sh`, 'utf8');
const startLine = entrypoint.match(/^exec .+$/gmu)?.at(-1);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe('the container image', () => {
  it('keeps the pnpm that corepack prepared where the unprivileged runtime user can read it', () => {
    const dockerfile = readFileSync(`${root}/infra/deployment/Dockerfile`, 'utf8');
    const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
    expect(runtime).toMatch(/^USER node$/mu);
    const home = runtime.match(/COREPACK_HOME=(\S+)/u)?.[1];
    expect(home).toBeDefined();
    expect(home).not.toMatch(/^\/root\b/u);
    expect(runtime).toMatch(/corepack prepare[^\n]*chmod -R a\+rX "\$COREPACK_HOME"/u);
  });
});

describe('the container start command', () => {
  it('hands SIGTERM to the server so a deploy shuts it down gracefully', async () => {
    expect(startLine).toBeDefined();
    const port = await freePort();
    const child = spawn('bash', ['-c', startLine!], {
      cwd: root,
      detached: true, // own process group, so a failing run cannot leak a server
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: t.url,
        PORT: String(port),
        HOST: '127.0.0.1',
        LOG_LEVEL: 'info',
        MAINTENANCE_INTERVAL_MS: '0',
      },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    try {
      const deadline = Date.now() + 40_000;
      while (!output.includes('Server listening') && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100));
      expect(output).toContain('Server listening');

      child.kill('SIGTERM');
      const result = await Promise.race([
        exited,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      // Give a late "shutting down" line the same moment it would have in the container.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(output).toContain('shutting down');
      expect(result).toEqual({ code: 0, signal: null });
    } finally {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }, 60_000);
});
