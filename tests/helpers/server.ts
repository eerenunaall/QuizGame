import type { AddressInfo } from 'node:net';
import { buildApp, loadConfig, type AppConfig, type BuiltApp } from '@quizparty/realtime';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import { seedTestBank } from './bank';

/** Short phases so a whole game runs in about a second; answer window stays at the 1 s minimum. */
export const FAST_GAME_CONFIG = {
  defaultRounds: 3,
  timings: {
    countdownMs: 100,
    roundIntroMs: 50,
    prepMs: 50,
    readBaseMs: 50,
    readPerCharMs: 0,
    readMinMs: 50,
    readMaxMs: 50,
    answerMs: { STANDARD: 1000, SPEED: 1000, RISK: 1000, CROWD: 1000, FINAL: 1000 },
    lockedMs: 50,
    revealMs: 80,
    revealPerCharMs: 0,
    revealExplanationMaxMs: 0,
    powerResolutionMs: 50,
    scoreUpdateMs: 80,
    microIntermissionMs: 50,
    finalIntroMs: 80,
  },
  director: { maxRiskRounds: 0 },
};

export interface TestServer {
  built: BuiltApp;
  config: AppConfig;
  db: TestDatabase;
  httpUrl: string;
  wsUrl: string;
  /** Graceful stop (flush + release leases). The test database stays. */
  stop(): Promise<void>;
  /** Stop and drop the database. */
  dispose(): Promise<void>;
}

export interface StartOptions {
  /** Listen on a fixed port instead of an ephemeral one (browser tests need the URL up front). */
  port?: number;
  env?: Record<string, string>;
  gameConfig?: unknown;
  /** Reuse an existing database (for restart/crash-recovery tests). */
  database?: TestDatabase;
  seed?: boolean;
}

export async function startServer(options: StartOptions = {}): Promise<TestServer> {
  const db = options.database ?? (await createTestDatabase());
  if (!options.database && options.seed !== false) await seedTestBank(db.db);
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: String(options.port ?? 0),
    HOST: '127.0.0.1',
    DATABASE_URL: db.url,
    QP_ALLOW_DEV_SEED: '1',
    PUBLIC_WEB_URL: 'http://localhost:5173',
    HEARTBEAT_INTERVAL_MS: '200',
    LEASE_MS: '2000',
    WS_AUTH_TIMEOUT_MS: '600',
    WS_PING_INTERVAL_MS: '5000',
    INSTANCE_ID: 'test-instance',
    RATE_LIMIT_SCALE: '100',
    GAME_CONFIG_OVERRIDE: JSON.stringify(options.gameConfig ?? FAST_GAME_CONFIG),
    ...options.env,
  });
  const built = await buildApp({ config });
  await built.app.listen({ port: options.port ?? 0, host: '127.0.0.1' });
  const { port } = built.app.server.address() as AddressInfo;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await built.close();
  };
  return {
    built,
    config,
    db,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    stop,
    async dispose() {
      await stop();
      if (!options.database) await db.drop();
    },
  };
}

export interface CreatedRoom {
  roomId: string;
  code: string;
  tier: 'FREE' | 'FULL';
  joinUrl: string;
  display: { sessionId: string; reconnectToken: string };
  maxPlayers: number;
}

export async function createRoom(
  server: TestServer,
  headers: Record<string, string> = {},
): Promise<CreatedRoom> {
  const response = await fetch(`${server.httpUrl}/v1/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ client: { kind: 'DISPLAY', version: 'test' } }),
  });
  if (response.status !== 201)
    throw new Error(`room creation failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as CreatedRoom;
}
