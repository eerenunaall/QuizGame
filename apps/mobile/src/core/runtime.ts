import {
  GameClient,
  type FetchLike,
  type KeyValueStorage,
  type SocketFactory,
} from '@quizparty/controller-client';
import { parseServerMessage } from '@quizparty/protocol';
import { ApiClient } from './api';
import { AuthStore } from './auth';
import type { AppConfig } from './config';
import { PurchaseFlow, type PurchaseProvider } from './purchases';

export interface RuntimeDeps {
  config: AppConfig;
  platform: 'IOS' | 'ANDROID';
  /** SecureStore in the app, a map in tests. */
  storage: KeyValueStorage;
  /** React Native's WebSocket in the app, `ws` in the protocol test. */
  socketFactory: SocketFactory;
  fetch: FetchLike;
  purchaseProvider: PurchaseProvider;
  /** Validate every inbound message against the protocol schema (development builds and tests). */
  strictParse?: boolean;
  backoffMs?: readonly number[];
}

export interface AppRuntime {
  config: AppConfig;
  storage: KeyValueStorage;
  client: GameClient;
  api: ApiClient;
  auth: AuthStore;
  purchases: PurchaseFlow;
}

/**
 * Wires the shared `GameClient` (the same code the browser controller runs) to the phone's
 * storage, sockets and HTTP. All platform differences are injected; nothing here knows about
 * React Native, which is what lets the protocol test drive the very same object (ADR-0017).
 */
export function createAppRuntime(deps: RuntimeDeps): AppRuntime {
  const { config } = deps;
  const client = new GameClient({
    wsUrl: config.wsUrl,
    apiUrl: config.apiUrl,
    client: { kind: deps.platform, version: config.version },
    storage: deps.storage,
    socketFactory: deps.socketFactory,
    fetch: deps.fetch,
    ...(deps.backoffMs ? { backoffMs: deps.backoffMs } : {}),
  });
  if (deps.strictParse) {
    client.parse = (raw) => {
      const result = parseServerMessage(raw);
      return result.ok ? result.value : null;
    };
  }
  const auth = new AuthStore(deps.storage);
  const api = new ApiClient({
    baseUrl: config.apiUrl,
    fetch: deps.fetch,
    token: auth.currentToken,
    onUnauthorized: () => void auth.clear(),
  });
  auth.attach(api);
  const purchases = new PurchaseFlow({
    provider: deps.purchaseProvider,
    api,
    productId: config.productId,
    signedIn: () => auth.state.status === 'SIGNED_IN',
  });
  return { config, storage: deps.storage, client, api, auth, purchases };
}
