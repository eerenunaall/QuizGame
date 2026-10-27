/**
 * `pnpm perf`: load and resilience measurement against the REAL server process (ADR-0019).
 *
 * What it does, in order:
 *   1. creates a throw-away PostgreSQL database, migrates it and loads the development bank,
 *   2. starts `apps/realtime` as a separate Node process (so its memory and CPU are its own),
 *   3. plays N rooms x M phones at once with the shared `GameClient` over real WebSockets
 *      (scenario "steady": a whole game per room, every phone answers every question),
 *   4. plays a second batch and kills every socket at once in the middle of a question
 *      (scenario "storm": all clients reconnect together; the games must still finish),
 *   5. prints a JSON report (and writes it with `--out`) and drops the database.
 *
 * Honest limits: server and load generator share this machine and loopback, so nothing here says
 * anything about WAN latency; rate limits and the per-IP socket cap are raised because every client
 * has the same source address (the production limits are not what is being measured). See docs/PERF.md.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, release } from 'node:os';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import WebSocket from 'ws';
import { GameClient, type ClientState, type SocketLike } from '@quizparty/controller-client';
import { parseServerMessage } from '@quizparty/protocol';
import { createPool, runMigrations } from '@quizparty/db';
import { realIo, run } from '../question/cli.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const { values: args } = parseArgs({
  options: {
    rooms: { type: 'string', default: '20' },
    players: { type: 'string', default: '8' },
    rounds: { type: 'string', default: '4' },
    out: { type: 'string' },
    'keep-db': { type: 'boolean', default: false },
  },
});
const ROOMS = Number(args.rooms);
const PLAYERS = Number(args.players);
const ROUNDS = Number(args.rounds);
const ADMIN_URL = (
  process.env.PERF_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://quizparty:quizparty@127.0.0.1:5432/quizparty_dev'
).replace(/\/[^/?]*(\?|$)/u, '/postgres$1');

// ───────────── statistics ─────────────

interface Dist {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}
function dist(values: number[]): Dist {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted.length === 0
      ? NaN
      : sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
  const round = (v: number): number => (Number.isNaN(v) ? v : Math.round(v * 10) / 10);
  return {
    n: sorted.length,
    min: round(sorted[0] ?? NaN),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted.at(-1) ?? NaN),
    mean: round(sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : NaN),
  };
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const now = (): number => performance.now();

// ───────────── database ─────────────

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
function urlFor(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

interface DbCounters {
  commits: number;
  rollbacks: number;
  inserted: number;
  updated: number;
  deleted: number;
  fetched: number;
  blksRead: number;
  blksHit: number;
}
async function dbCounters(client: pg.Client, name: string): Promise<DbCounters> {
  const r = await client.query(
    `SELECT xact_commit, xact_rollback, tup_inserted, tup_updated, tup_deleted, tup_fetched,
            blks_read, blks_hit FROM pg_stat_database WHERE datname = $1`,
    [name],
  );
  const row = r.rows[0] as Record<string, string>;
  return {
    commits: Number(row.xact_commit),
    rollbacks: Number(row.xact_rollback),
    inserted: Number(row.tup_inserted),
    updated: Number(row.tup_updated),
    deleted: Number(row.tup_deleted),
    fetched: Number(row.tup_fetched),
    blksRead: Number(row.blks_read),
    blksHit: Number(row.blks_hit),
  };
}
const diff = (a: DbCounters, b: DbCounters): DbCounters => ({
  commits: b.commits - a.commits,
  rollbacks: b.rollbacks - a.rollbacks,
  inserted: b.inserted - a.inserted,
  updated: b.updated - a.updated,
  deleted: b.deleted - a.deleted,
  fetched: b.fetched - a.fetched,
  blksRead: b.blksRead - a.blksRead,
  blksHit: b.blksHit - a.blksHit,
});

// ───────────── server process ─────────────

function procStatus(pid: number): { rssMb: number; cpuTicks: number } | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const rssKb = Number(/VmRSS:\s+(\d+)/u.exec(status)?.[1] ?? 0);
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { rssMb: rssKb / 1024, cpuTicks: Number(fields[11]) + Number(fields[12]) };
  } catch {
    return null;
  }
}

const GAME_CONFIG = {
  defaultRounds: ROUNDS,
  timings: {
    countdownMs: 300,
    roundIntroMs: 150,
    riskPickMs: 200,
    sabotagePickMs: 200,
    riskPickDecisionMs: 200,
    readBaseMs: 200,
    readPerCharMs: 0,
    readMinMs: 200,
    readMaxMs: 200,
    answerMs: { STANDARD: 6000, SPEED: 6000, RISK: 6000, CROWD: 6000, FINAL: 6000 },
    lockedMs: 100,
    revealMs: 300,
    revealPerCharMs: 0,
    revealExplanationMaxMs: 0,
    powerResolutionMs: 100,
    powerResolutionPerItemMs: 0,
    powerResolutionMaxMs: 100,
    scoreUpdateMs: 300,
    microIntermissionMs: 100,
    finalIntroMs: 200,
  },
  director: { maxRiskRounds: 0 },
};

async function startServer(
  databaseUrl: string,
  port: number,
): Promise<{ child: ChildProcess; log: string[] }> {
  const log: string[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: `${ROOT}apps/realtime`,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      PUBLIC_WEB_URL: `http://127.0.0.1:${port}`,
      QP_ALLOW_DEV_SEED: '1',
      LOG_LEVEL: 'warn',
      METRICS_TOKEN: 'perf-metrics-token-0123456789',
      // Every simulated phone shares one source address: lift the per-IP caps and scale the buckets.
      MAX_WS_PER_IP: '5000',
      RATE_LIMIT_SCALE: '1000',
      GAME_CONFIG_OVERRIDE: JSON.stringify(GAME_CONFIG),
      MAINTENANCE_INTERVAL_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => log.push(String(d)));
  child.stderr?.on('data', (d: Buffer) => log.push(String(d)));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log.join('')}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/readyz`);
      if (r.ok) return { child, log };
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error(`server did not become ready:\n${log.join('')}`);
}

// ───────────── simulated clients ─────────────

interface Phone {
  client: GameClient;
  sockets: WebSocket[];
  violations: string[];
}

function makePhone(port: number, kind: 'WEB' | 'DISPLAY'): Phone {
  const storage = new Map<string, string>();
  const sockets: WebSocket[] = [];
  const violations: string[] = [];
  const client = new GameClient({
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    apiUrl: `http://127.0.0.1:${port}`,
    client: { kind, version: 'perf' },
    storage: {
      get: (k) => storage.get(k) ?? null,
      set: (k, v) => void storage.set(k, v),
      remove: (k) => void storage.delete(k),
    },
    socketFactory: (url) => {
      const socket = new WebSocket(url, { headers: { Origin: `http://127.0.0.1:${port}` } });
      sockets.push(socket);
      return socket as unknown as SocketLike;
    },
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      return { ok: response.ok, status: response.status, json: () => response.json() };
    },
    backoffMs: [50, 100, 200, 400],
    pingIntervalMs: 5_000,
    pongTimeoutMs: 10_000,
  });
  client.parse = (raw) => {
    const result = parseServerMessage(raw);
    if (result.ok) return result.value;
    violations.push(result.error);
    return null;
  };
  return { client, sockets, violations };
}

interface RoomRun {
  display: Phone;
  players: Phone[];
  /** Per question: when the last answer was sent, and when the TV saw LOCKED / REVEAL. */
  questions: Map<
    string,
    { lastSentAt: number; lockedAt?: number; revealAt?: number; skewLockedAt: number[] }
  >;
  finished: Promise<void>;
  ackMs: number[];
  answerFailures: number;
  results: boolean;
}

/** One TV plus `PLAYERS` phones; phones answer ~100-1200 ms after the options appear. */
async function openRoom(port: number, joinMs: number[]): Promise<RoomRun> {
  const display = makePhone(port, 'DISPLAY');
  const created = await display.client.createRoom('tr');
  const room: RoomRun = {
    display,
    players: [],
    questions: new Map(),
    finished: Promise.resolve(),
    ackMs: [],
    answerFailures: 0,
    results: false,
  };
  for (let i = 0; i < PLAYERS; i++) {
    const phone = makePhone(port, 'WEB');
    const t0 = now();
    await phone.client.join(created.code, `Perf${i + 1}`, 'fox');
    joinMs.push(now() - t0);
    room.players.push(phone);
  }

  const inflight = new Set<string>();
  const answered = new Set<string>();
  for (const [index, phone] of room.players.entries()) {
    phone.client.store.subscribe(() => {
      const data = phone.client.store.get().room?.phaseData;
      const you = phone.client.store.get().room?.you;
      if (data?.phase !== 'ANSWERING' || you?.answer) return;
      const key = `${data.questionId}`;
      if (inflight.has(`${index}:${key}`)) return;
      inflight.add(`${index}:${key}`);
      const option = data.options[index % data.options.length];
      if (!option) return;
      setTimeout(
        () => {
          const sentAt = now();
          const record = room.questions.get(key) ?? { lastSentAt: 0, skewLockedAt: [] };
          record.lastSentAt = Math.max(record.lastSentAt, sentAt);
          room.questions.set(key, record);
          phone.client.submitAnswer(option.optionId).then(
            () => {
              room.ackMs.push(now() - sentAt);
              answered.add(`${index}:${key}`);
            },
            () => {
              room.answerFailures++;
              inflight.delete(`${index}:${key}`); // a dropped socket: try again on the next view
            },
          );
        },
        100 + Math.random() * 1100,
      );
    });
  }

  // The TV records when it sees the question lock and reveal; every phone records its own lock time.
  let lastPhase = '';
  display.client.store.subscribe(() => {
    const data = display.client.store.get().room?.phaseData;
    if (!data || data.phase === lastPhase) return;
    lastPhase = data.phase;
    const key = 'questionId' in data ? String(data.questionId) : null;
    if (!key) return;
    const record = room.questions.get(key);
    if (!record) return;
    if (data.phase === 'LOCKED' && record.lockedAt === undefined) record.lockedAt = now();
    if (data.phase === 'REVEAL' && record.revealAt === undefined) record.revealAt = now();
  });
  for (const phone of room.players) {
    let seen = '';
    phone.client.store.subscribe(() => {
      const data = phone.client.store.get().room?.phaseData;
      if (data?.phase !== 'LOCKED' || !('questionId' in data)) return;
      const key = String(data.questionId);
      if (seen === key) return;
      seen = key;
      room.questions.get(key)?.skewLockedAt.push(now());
    });
  }
  room.finished = new Promise((resolve) => {
    const check = (): void => {
      if (display.client.store.get().room?.phase === 'RESULTS') {
        room.results = true;
        resolve();
      }
    };
    display.client.store.subscribe(check);
    check();
  });
  return room;
}

function closeRoom(room: RoomRun): void {
  for (const phone of [room.display, ...room.players]) phone.client.suspend();
}

async function waitAll(rooms: RoomRun[], timeoutMs: number): Promise<number> {
  const timer = sleep(timeoutMs).then(() => 'timeout' as const);
  await Promise.race([Promise.all(rooms.map((r) => r.finished)), timer]);
  return rooms.filter((r) => r.results).length;
}

function summariseRooms(rooms: RoomRun[]): Record<string, unknown> {
  const ack: number[] = [];
  const toLock: number[] = [];
  const toReveal: number[] = [];
  const lockSpread: number[] = [];
  let failures = 0;
  let violations = 0;
  for (const room of rooms) {
    ack.push(...room.ackMs);
    failures += room.answerFailures;
    for (const phone of [room.display, ...room.players]) violations += phone.violations.length;
    for (const q of room.questions.values()) {
      if (q.lockedAt !== undefined) toLock.push(q.lockedAt - q.lastSentAt);
      if (q.revealAt !== undefined) toReveal.push(q.revealAt - q.lastSentAt);
      if (q.skewLockedAt.length > 1)
        lockSpread.push(Math.max(...q.skewLockedAt) - Math.min(...q.skewLockedAt));
    }
  }
  return {
    answerAckMs: dist(ack),
    lastAnswerToLockedOnTvMs: dist(toLock),
    lastAnswerToRevealOnTvMs: dist(toReveal),
    lockedFanOutSpreadAcrossPhonesMs: dist(lockSpread),
    answerSendFailures: failures,
    protocolViolations: violations,
    roomsFinished: rooms.filter((r) => r.results).length,
    roomsStarted: rooms.length,
  };
}

// ───────────── histogram quantiles from /metrics ─────────────

async function serverInputQuantiles(port: number): Promise<Record<string, number | string>> {
  const text = await (
    await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: 'Bearer perf-metrics-token-0123456789' },
    })
  ).text();
  const buckets: [number, number][] = [];
  let count = 0;
  for (const line of text.split('\n')) {
    const bucket = /^qp_room_input_seconds_bucket\{le="([^"]+)"\} (\S+)/u.exec(line);
    if (bucket && bucket[1] !== '+Inf') buckets.push([Number(bucket[1]), Number(bucket[2])]);
    const total = /^qp_room_input_seconds_count (\S+)/u.exec(line);
    if (total) count = Number(total[1]);
  }
  const q = (p: number): number | string => {
    const hit = buckets.find(([, c]) => c >= p * count);
    return hit ? `<= ${hit[0] * 1000} ms` : '> 1000 ms';
  };
  return { inputs: count, p50: q(0.5), p95: q(0.95), p99: q(0.99) };
}

// ───────────── main ─────────────

const dbName = `qp_perf_${Date.now().toString(36)}`;
const port = 20_000 + Math.floor(Math.random() * 20_000);
const report: Record<string, unknown> = {};
let server: { child: ChildProcess; log: string[] } | null = null;
let sampler: NodeJS.Timeout | null = null;
const loopDelay = monitorEventLoopDelay({ resolution: 10 });

try {
  await withAdmin((c) => c.query(`CREATE DATABASE "${dbName}"`));
  const databaseUrl = urlFor(dbName);
  const pool = createPool(databaseUrl, { max: 2 });
  try {
    await runMigrations(pool, `${ROOT}database/migrations`);
  } finally {
    await pool.end();
  }
  const seed = await run(
    ['seed', '--seed-file', `${ROOT}seed/questions.tr.jsonl`],
    { ...process.env, NODE_ENV: 'development', DATABASE_URL: databaseUrl },
    { ...realIo, out: () => undefined },
  );
  if (seed !== 0) throw new Error('seeding the development bank failed');

  server = await startServer(databaseUrl, port);
  const pid = server.child.pid!;
  const idle = procStatus(pid)!;
  const samples: number[] = [idle.rssMb];
  const cpuStart = procStatus(pid)!.cpuTicks;
  const wallStart = now();
  sampler = setInterval(() => {
    const s = procStatus(pid);
    if (s) samples.push(s.rssMb);
  }, 500);

  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const dbStart = await dbCounters(admin, dbName);
  let maxDbConnections = 0;
  const dbSampler = setInterval(() => {
    admin
      .query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1', [dbName])
      .then((r) => {
        maxDbConnections = Math.max(maxDbConnections, (r.rows[0] as { n: number }).n);
      })
      .catch(() => undefined);
  }, 250);
  loopDelay.enable();

  // ── scenario 1: steady ──
  const joinMs: number[] = [];
  const createStart = now();
  const steady = await Promise.all(Array.from({ length: ROOMS }, () => openRoom(port, joinMs)));
  const setupMs = now() - createStart;
  const connectedAfterSetup = procStatus(pid)!.rssMb;
  const gameStart = now();
  await Promise.all(steady.map((r) => r.players[0]!.client.startGame()));
  const finishedSteady = await waitAll(steady, 120_000);
  const steadyMs = now() - gameStart;
  report.steady = {
    rooms: ROOMS,
    playersPerRoom: PLAYERS,
    clients: ROOMS * (PLAYERS + 1),
    roomsAndJoinsSetupMs: Math.round(setupMs),
    joinMs: dist(joinMs),
    gameWallClockMs: Math.round(steadyMs),
    finished: finishedSteady,
    ...summariseRooms(steady),
  };
  report.rssAfterSetupMb = Math.round(connectedAfterSetup);
  const rssBeforeClose = procStatus(pid)!.rssMb;
  steady.forEach(closeRoom);
  await sleep(1500);

  // ── scenario 2: reconnect storm ──
  const stormJoin: number[] = [];
  const storm = await Promise.all(Array.from({ length: ROOMS }, () => openRoom(port, stormJoin)));
  await Promise.all(storm.map((r) => r.players[0]!.client.startGame()));
  // Wait until every room shows an open question, then cut every socket at the same instant.
  const inQuestion = (r: RoomRun): boolean =>
    r.display.client.store.get().room?.phaseData?.phase === 'ANSWERING';
  const stormDeadline = now() + 30_000;
  while (!storm.every(inQuestion) && now() < stormDeadline) await sleep(50);
  const all = storm.flatMap((r) => [r.display, ...r.players]);
  const cutAt = now();
  const recovered: number[] = [];
  const backOnline = (s: ClientState): boolean => s.transport === 'ONLINE' && s.room !== null;
  const waiters = all.map(
    (phone) =>
      new Promise<void>((resolve) => {
        let cut = false;
        const unsubscribe = phone.client.store.subscribe(() => {
          const s = phone.client.store.get();
          if (!cut) {
            if (s.transport !== 'ONLINE') cut = true;
            return;
          }
          if (backOnline(s)) {
            recovered.push(now() - cutAt);
            unsubscribe();
            resolve();
          }
        });
      }),
  );
  for (const phone of all) phone.sockets.at(-1)?.terminate();
  const recoveryTimeout = sleep(30_000);
  await Promise.race([Promise.all(waiters), recoveryTimeout]);
  const finishedStorm = await waitAll(storm, 120_000);
  report.reconnectStorm = {
    clientsCut: all.length,
    recoveredWithin30s: recovered.length,
    reconnectMs: dist(recovered),
    gamesFinishedAfterStorm: finishedStorm,
    ...summariseRooms(storm),
  };

  // ── server and database ──
  loopDelay.disable();
  clearInterval(dbSampler);
  const peak = Math.max(...samples);
  const last = procStatus(pid)!;
  const wallSec = (now() - wallStart) / 1000;
  const ticksPerSec = 100;
  const dbEnd = await dbCounters(admin, dbName);
  const delta = diff(dbStart, dbEnd);
  report.server = {
    rssIdleMb: Math.round(idle.rssMb),
    rssBeforeFirstCloseMb: Math.round(rssBeforeClose),
    rssPeakMb: Math.round(peak),
    rssEndMb: Math.round(last.rssMb),
    cpuSecondsTotal: Math.round(((last.cpuTicks - cpuStart) / ticksPerSec) * 10) / 10,
    cpuAverageCorePercent:
      Math.round(((last.cpuTicks - cpuStart) / ticksPerSec / wallSec) * 1000) / 10,
    inputProcessing: await serverInputQuantiles(port),
  };
  report.database = {
    name: 'throw-away database, dropped after the run',
    ...delta,
    commitsPerSecond: Math.round(delta.commits / wallSec),
    cacheHitRatio:
      Math.round((delta.blksHit / Math.max(1, delta.blksHit + delta.blksRead)) * 1000) / 10,
    maxConnections: maxDbConnections,
    poolMax: 12,
  };
  report.loadGenerator = {
    eventLoopDelayMs: {
      p50: Math.round(loopDelay.percentile(50) / 1e4) / 100,
      p99: Math.round(loopDelay.percentile(99) / 1e4) / 100,
      max: Math.round(loopDelay.max / 1e4) / 100,
    },
    note: 'Latency numbers include this process event-loop delay; read them together.',
  };
  storm.forEach(closeRoom);
  await admin.end();
  const serverLog = server.log.join('');
  report.serverLogWarningsOrErrors = (serverLog.match(/"level":(40|50|60)/gu) ?? []).length;
} catch (error) {
  console.error(server?.log.join('').slice(-3000) ?? '');
  throw error;
} finally {
  if (sampler) clearInterval(sampler);
  loopDelay.disable();
  if (server) {
    server.child.kill('SIGTERM');
    await sleep(500);
    if (server.child.exitCode === null) server.child.kill('SIGKILL');
  }
  if (!args['keep-db'])
    await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)).catch(
      () => undefined,
    );
}

report.machine = {
  cpuModel: cpus()[0]?.model ?? 'unknown',
  logicalCpus: cpus().length,
  totalMemoryGb: Math.round((totalmem() / 2 ** 30) * 10) / 10,
  kernel: release(),
  node: process.version,
  note: 'server, database and load generator share this machine (loopback); not a production sizing',
};
report.config = {
  rooms: ROOMS,
  playersPerRoom: PLAYERS,
  rounds: ROUNDS,
  startedAt: new Date().toISOString(),
};

const json = JSON.stringify(report, null, 2);
console.log(json);
if (args.out) {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${json}\n`);
}
process.exit(0);
