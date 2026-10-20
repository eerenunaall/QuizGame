import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameClient } from './client';
import { message, roomView } from './fixtures';
import type { ClientConfig, KeyValueStorage, SocketLike } from './types';

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code = 1000): void {
    this.closedWith = code;
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  types(): unknown[] {
    return this.sent.map((frame) => frame.type);
  }
  last(type: string): Record<string, unknown> {
    const frame = [...this.sent].reverse().find((candidate) => candidate.type === type);
    if (!frame) throw new Error(`no ${type} frame sent`);
    return frame;
  }
}

function memoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value);
    },
    remove: (key) => {
      data.delete(key);
    },
  };
}

function setup(overrides: Partial<ClientConfig> = {}, initial: Record<string, string> = {}) {
  const sockets: FakeSocket[] = [];
  const storage = memoryStorage(initial);
  const client = new GameClient({
    wsUrl: 'ws://test/ws',
    apiUrl: '',
    client: { kind: 'WEB', version: 'test' },
    storage,
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    fetch: () => Promise.reject(new Error('not used')),
    now: () => Date.now(),
    perf: () => Date.now(),
    backoffMs: [100, 200, 400],
    pingIntervalMs: 1_000,
    pongTimeoutMs: 500,
    ...overrides,
  });
  const latest = (): FakeSocket => {
    const socket = sockets[sockets.length - 1];
    if (!socket) throw new Error('no socket yet');
    return socket;
  };
  return { client, storage, sockets, latest };
}

const GRANT = { sessionId: 'sess-1', playerId: 'p1', reconnectToken: 'T'.repeat(43) };

async function joinAs(env: ReturnType<typeof setup>): Promise<void> {
  const pending = env.client.join('ABC234', 'Ayşe', 'fox');
  await vi.advanceTimersByTimeAsync(0);
  env.latest().open();
  await vi.advanceTimersByTimeAsync(0);
  const join = env.latest().last('JOIN_ROOM');
  env
    .latest()
    .receive(
      message(
        'ROOM_JOINED',
        { session: GRANT, room: roomView({ roomId: '11111111-1111-4111-8111-111111111111' }) },
        { sequence: 1 },
      ),
    );
  await pending;
  expect(join.messageId).toMatch(/^[0-9a-f-]{36}$/);
}

describe('GameClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a stable device id once', async () => {
    const env = setup();
    const first = await env.client.deviceId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(await env.client.deviceId()).toBe(first);
    expect(env.storage.data.get('qp.device')).toBe(first);
  });

  it('joins a room, persists the session and starts liveness pings', async () => {
    const env = setup();
    await joinAs(env);
    expect(env.client.state.transport).toBe('ONLINE');
    expect(env.client.state.session).toMatchObject({
      sessionId: 'sess-1',
      role: 'PLAYER',
      code: 'ABC234',
    });
    expect(JSON.parse(env.storage.data.get('qp.player.ABC234') ?? '{}')).toMatchObject({
      token: GRANT.reconnectToken,
    });
    expect(env.latest().types()).toContain('PING');
  });

  it('sends strictly increasing sequence numbers', async () => {
    const env = setup();
    await joinAs(env);
    for (let i = 0; i < 20; i++) env.client.requestState();
    const sequences = env.latest().sent.map((frame) => frame.sequence as number);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it('keeps the sequence increasing across a page reload, whether or not storage survived', async () => {
    const env = setup();
    await joinAs(env);
    for (let i = 0; i < 20; i++) env.client.requestState(); // forces a persist (every 8 sends)
    const last = Math.max(...env.latest().sent.map((frame) => frame.sequence as number));

    // Storage survived: even with a frozen clock the new instance continues above the old one.
    const withStorage = setup({}, Object.fromEntries(env.storage.data));
    await joinAs(withStorage);
    expect(withStorage.latest().sent[0]?.sequence as number).toBeGreaterThan(
      Number(env.storage.data.get('qp.seq')),
    );

    // Storage was wiped (private mode, cleared site data): the wall clock keeps it above the old range.
    await vi.advanceTimersByTimeAsync(2_000);
    const wiped = setup();
    await joinAs(wiped);
    expect(wiped.latest().sent[0]?.sequence as number).toBeGreaterThan(last);
  });

  it('reconnects with the stored token after an abnormal close, backing off', async () => {
    const env = setup();
    await joinAs(env);
    const before = env.sockets.length;
    env.latest().serverClose(1006);
    expect(env.client.state.transport).toBe('RECONNECTING');
    await vi.advanceTimersByTimeAsync(50);
    expect(env.sockets.length).toBe(before); // still backing off
    await vi.advanceTimersByTimeAsync(400);
    expect(env.sockets.length).toBe(before + 1);
    env.latest().open();
    await vi.advanceTimersByTimeAsync(0);
    const frame = env.latest().last('RECONNECT');
    expect((frame.payload as { reconnectToken: string }).reconnectToken).toBe(GRANT.reconnectToken);
    expect(frame.sessionId).toBe('sess-1');

    // The server rotates the token; the new one must be persisted and used next time.
    const rotated = { ...GRANT, reconnectToken: 'R'.repeat(43) };
    env
      .latest()
      .receive(
        message(
          'RECONNECTED',
          { session: rotated, role: 'PLAYER', room: roomView() },
          { sequence: 1 },
        ),
      );
    await vi.advanceTimersByTimeAsync(0);
    expect(env.client.state.transport).toBe('ONLINE');
    expect(env.client.state.restoredAt).not.toBeNull();
    expect(JSON.parse(env.storage.data.get('qp.player.ABC234') ?? '{}')).toMatchObject({
      token: rotated.reconnectToken,
    });
  });

  it.each([
    [4001, 'SUPERSEDED', true],
    [4002, 'REVOKED', false],
    [4003, 'KICKED', false],
    [4004, 'LEFT', false],
    [4005, 'SESSION_EXPIRED', false],
    [4006, 'ROOM_CLOSED', false],
  ] as const)('stops for good on close code %i (%s)', async (code, reason, keepsStorage) => {
    const env = setup();
    await joinAs(env);
    const sockets = env.sockets.length;
    env.latest().serverClose(code);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(env.client.state.closedReason).toBe(reason);
    expect(env.client.state.transport).toBe('CLOSED');
    expect(env.sockets.length).toBe(sockets); // no reconnect attempt
    expect(env.storage.data.has('qp.player.ABC234')).toBe(keepsStorage);
  });

  it('asks for a fresh snapshot when the server sequence has a gap', async () => {
    const env = setup();
    await joinAs(env);
    env
      .latest()
      .receive(message('PLAYER_LEFT', { playerId: 'p9', reason: 'LEFT' }, { sequence: 2 }));
    const before = env
      .latest()
      .types()
      .filter((type) => type === 'REQUEST_STATE').length;
    env
      .latest()
      .receive(message('PLAYER_LEFT', { playerId: 'p8', reason: 'LEFT' }, { sequence: 4 }));
    expect(
      env
        .latest()
        .types()
        .filter((type) => type === 'REQUEST_STATE').length,
    ).toBe(before + 1);
  });

  it('recycles a connection that stops answering pings', async () => {
    const env = setup();
    await joinAs(env);
    const before = env.sockets.length;
    await vi.advanceTimersByTimeAsync(600); // > pong timeout, no PONG delivered
    expect(env.client.state.transport).toBe('RECONNECTING');
    await vi.advanceTimersByTimeAsync(600);
    expect(env.sockets.length).toBeGreaterThan(before);
  });

  it('feeds PONG replies into the clock estimate', async () => {
    const env = setup();
    await joinAs(env);
    const ping = env.latest().last('PING');
    const sentAt = (ping.payload as { clientSentAt: number }).clientSentAt;
    await vi.advanceTimersByTimeAsync(40);
    env
      .latest()
      .receive(
        message('PONG', { clientSentAt: sentAt, serverTime: Date.now() + 5_000 }, { sequence: 2 }),
      );
    expect(env.client.clock.hasSample()).toBe(true);
    expect(env.client.state.rttMs).toBe(40);
    expect(Math.abs(env.client.serverNow() - (Date.now() + 5_000))).toBeLessThanOrEqual(25);
  });

  it('resolves requests on ACK and rejects with the server error code', async () => {
    const env = setup();
    await joinAs(env);
    const ok = env.client.setReady(true);
    const readyFrame = env.latest().last('READY');
    env.latest().receive(message('ACK', { messageId: readyFrame.messageId }, { sequence: 2 }));
    await expect(ok).resolves.toBeUndefined();

    const bad = env.client.startGame();
    const startFrame = env.latest().last('START_GAME');
    env
      .latest()
      .receive(
        message(
          'ERROR',
          { messageId: startFrame.messageId, code: 'NOT_ENOUGH_PLAYERS' },
          { sequence: 3 },
        ),
      );
    await expect(bad).rejects.toMatchObject({ code: 'NOT_ENOUGH_PLAYERS' });
  });

  it('times out requests that the server never answers', async () => {
    const env = setup();
    await joinAs(env);
    const promise = env.client.setReady(true);
    const assertion = expect(promise).rejects.toMatchObject({ code: 'INTERNAL' });
    await vi.advanceTimersByTimeAsync(8_100);
    await assertion;
  });

  it('refuses to submit an answer outside the answering phase', async () => {
    const env = setup();
    await joinAs(env);
    await expect(env.client.submitAnswer('optionAAAA')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('rejects a join that the server refuses', async () => {
    const env = setup();
    const pending = env.client.join('ABC234', 'Ayşe', 'fox');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'ROOM_FULL' });
    await vi.advanceTimersByTimeAsync(0);
    env.latest().open();
    await vi.advanceTimersByTimeAsync(0);
    const join = env.latest().last('JOIN_ROOM');
    env
      .latest()
      .receive(message('ERROR', { messageId: join.messageId, code: 'ROOM_FULL' }, { sequence: 1 }));
    await assertion;
    expect(env.client.state.transport).toBe('IDLE');
  });

  it('suspends without forgetting the session and resumes it later', async () => {
    const env = setup();
    await joinAs(env);
    env.client.suspend();
    expect(env.client.state.transport).toBe('IDLE');
    expect(env.storage.data.has('qp.player.ABC234')).toBe(true);
    const resumed = await env.client.resume('PLAYER', 'ABC234');
    expect(resumed).toBe(true);
    expect(await env.client.resume('PLAYER', 'ZZZZZZ')).toBe(false);
  });

  it('forget() wipes the stored session', async () => {
    const env = setup();
    await joinAs(env);
    await env.client.forget();
    expect(env.storage.data.has('qp.player.ABC234')).toBe(false);
    expect(env.client.state.session).toBeNull();
  });
});
