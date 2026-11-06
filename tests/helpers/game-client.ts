import WebSocket from 'ws';
import {
  GameClient,
  type ClientState,
  type KeyValueStorage,
  type SocketLike,
} from '@quizparty/controller-client';
import { parseServerMessage } from '@quizparty/protocol';
import type { TestServer } from './server';

export type MemoryStorage = KeyValueStorage & { data: Map<string, string> };

export function memoryStorage(initial: Iterable<[string, string]> = []): MemoryStorage {
  const data = new Map(initial);
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

export interface TestGameClient {
  client: GameClient;
  storage: MemoryStorage;
  /** Every socket the client opened, oldest first. */
  sockets: WebSocket[];
  /** Messages the strict schema validation rejected (must stay empty). */
  violations: string[];
  /** Abruptly kills the live TCP connection, like a phone losing signal. */
  dropConnection(): void;
  waitFor(
    predicate: (state: ClientState) => boolean,
    timeoutMs?: number,
    label?: string,
  ): Promise<ClientState>;
}

/** A real `GameClient` wired to a real `ws` socket; every inbound message is strictly validated. */
export function makeGameClient(
  server: TestServer,
  options: { storage?: MemoryStorage; kind?: 'WEB' | 'DISPLAY'; backoffMs?: number[] } = {},
): TestGameClient {
  const storage = options.storage ?? memoryStorage();
  const sockets: WebSocket[] = [];
  const violations: string[] = [];
  const client = new GameClient({
    wsUrl: server.wsUrl,
    apiUrl: server.httpUrl,
    client: { kind: options.kind ?? 'WEB', version: 'test' },
    storage,
    socketFactory: (url) => {
      const socket = new WebSocket(url, { headers: { Origin: 'http://localhost:5173' } });
      sockets.push(socket);
      return socket as unknown as SocketLike;
    },
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      return { ok: response.ok, status: response.status, json: () => response.json() };
    },
    backoffMs: options.backoffMs ?? [40, 80],
    pingIntervalMs: 1_000,
    pongTimeoutMs: 3_000,
  });
  client.parse = (raw) => {
    const result = parseServerMessage(raw);
    if (result.ok) return result.value;
    violations.push(result.error);
    return null;
  };

  const waitFor = (
    predicate: (state: ClientState) => boolean,
    timeoutMs = 8_000,
    label = 'client state',
  ): Promise<ClientState> =>
    new Promise((resolve, reject) => {
      const initial = client.store.get();
      if (predicate(initial)) {
        resolve(initial);
        return;
      }
      const timer = setTimeout(() => {
        unsubscribe();
        const state = client.store.get();
        reject(
          new Error(
            `timed out waiting for ${label}; transport=${state.transport} phase=${state.room?.phase ?? 'none'} closed=${state.closedReason ?? 'no'}`,
          ),
        );
      }, timeoutMs);
      const unsubscribe = client.store.subscribe(() => {
        const state = client.store.get();
        if (!predicate(state)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(state);
      });
    });

  return {
    client,
    storage,
    sockets,
    violations,
    dropConnection: () => sockets.at(-1)?.terminate(),
    waitFor,
  };
}

/** Answers every question as soon as options are visible, choosing option number `pick`. */
export function autoAnswer(test: TestGameClient, pick: number): () => void {
  let answered: string | null = null;
  return test.client.store.subscribe(() => {
    const room = test.client.store.get().room;
    const data = room?.phaseData;
    if (!room || data?.phase !== 'ANSWERING' || room.you?.answer || answered === data.questionId) {
      return;
    }
    answered = data.questionId;
    const option = data.options[pick % data.options.length];
    if (option) void test.client.submitAnswer(option.optionId).catch(() => undefined);
  });
}
