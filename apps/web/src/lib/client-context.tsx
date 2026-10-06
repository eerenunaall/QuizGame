import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { GameClient, type ClientState, type KeyValueStorage } from '@quizparty/controller-client';
import { APP_VERSION, resolveEndpoints, type Endpoints } from './config';
import { createStorage } from './storage';

export interface ClientRuntime {
  client: GameClient;
  storage: KeyValueStorage;
  endpoints: Endpoints;
}

export type ClientKind = 'WEB' | 'DISPLAY';

export function createRuntime(kind: ClientKind): ClientRuntime {
  const storage = createStorage();
  const endpoints = resolveEndpoints(window.location, import.meta.env);
  const client = new GameClient({
    wsUrl: endpoints.wsUrl,
    apiUrl: endpoints.apiUrl,
    client: { kind, version: APP_VERSION },
    storage,
    socketFactory: (url) => new WebSocket(url) as unknown as ReturnType<GameClientSocketFactory>,
    fetch: async (url, init) => {
      const response = await window.fetch(url, init);
      return { ok: response.ok, status: response.status, json: () => response.json() };
    },
  });
  return { client, storage, endpoints };
}

type GameClientSocketFactory = ConstructorParameters<typeof GameClient>[0]['socketFactory'];

const RuntimeContext = createContext<ClientRuntime | null>(null);

export function ClientProvider({
  kind,
  runtime,
  children,
}: {
  kind: ClientKind;
  /** Tests inject a prepared runtime. */
  runtime?: ClientRuntime;
  children: ReactNode;
}) {
  const [value] = useState(() => runtime ?? createRuntime(kind));
  useClientLifecycle(value.client);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): ClientRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('ClientProvider is missing');
  return runtime;
}

export function useClient(): GameClient {
  return useRuntime().client;
}

/** Re-renders only when the selected slice changes (selectors return existing references). */
export function useClientSelector<T>(selector: (state: ClientState) => T): T {
  const { client } = useRuntime();
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  return useSyncExternalStore(
    client.store.subscribe,
    () => selectorRef.current(client.store.get()),
    () => selectorRef.current(client.store.get()),
  );
}

export function useClientState(): ClientState {
  return useClientSelector((state) => state);
}

/**
 * Phones sleep, tabs freeze and networks change. Wake the connection when the page comes back,
 * and park it cleanly when the page is hidden for good.
 */
function useClientLifecycle(client: GameClient): void {
  useEffect(() => {
    const wake = (): void => client.nudge();
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') wake();
    };
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) wake();
    };
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', wake);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [client]);
}
