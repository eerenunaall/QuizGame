import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import type { SocketLike, Store } from '@quizparty/controller-client';
import { resolveLocale, type Locale } from '@quizparty/i18n';
import { resolveAppConfig } from '../core/config';
import { createAppRuntime, type AppRuntime } from '../core/runtime';
import { I18nProvider } from '../ui/i18n';
import { haptic, type HapticKind } from './haptics';
import { createExpoIapProvider } from './expoIapProvider';
import { secureStorage } from './secureStorage';

interface AppContextValue {
  runtime: AppRuntime;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  hapticsOn: boolean;
  setHapticsOn: (on: boolean) => void;
  /** Present only while the player allows haptics. */
  haptic: ((kind: HapticKind) => void) | undefined;
}

const AppContext = createContext<AppContextValue | null>(null);
const LOCALE_KEY = 'qp.locale';
const HAPTICS_KEY = 'qp.haptics';

/** Builds the runtime once, restores the account session and settles unfinished purchases (flow C). */
export function AppProviders({ children }: { children: ReactNode }) {
  const runtime = useMemo(
    () =>
      createAppRuntime({
        config: resolveAppConfig(Constants.expoConfig?.extra, Constants.expoConfig?.version),
        platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
        storage: secureStorage,
        socketFactory: (url) => new WebSocket(url) as unknown as SocketLike,
        fetch: (url, init) => fetch(url, init),
        purchaseProvider: createExpoIapProvider(),
        strictParse: __DEV__,
      }),
    [],
  );
  const [locale, setLocaleState] = useState<Locale>(() =>
    resolveLocale(getLocales()[0]?.languageTag),
  );
  const [hapticsOn, setHapticsState] = useState(true);

  useEffect(() => {
    void (async () => {
      const savedLocale = await secureStorage.get(LOCALE_KEY);
      if (savedLocale === 'tr' || savedLocale === 'en') setLocaleState(savedLocale);
      setHapticsState((await secureStorage.get(HAPTICS_KEY)) !== 'off');
      await runtime.auth.restore();
      await runtime.purchases.recover();
    })();
  }, [runtime]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void secureStorage.set(LOCALE_KEY, next);
  }, []);
  const setHapticsOn = useCallback((on: boolean) => {
    setHapticsState(on);
    void secureStorage.set(HAPTICS_KEY, on ? 'on' : 'off');
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      runtime,
      locale,
      setLocale,
      hapticsOn,
      setHapticsOn,
      haptic: hapticsOn ? haptic : undefined,
    }),
    [runtime, locale, setLocale, hapticsOn, setHapticsOn],
  );
  return (
    <AppContext.Provider value={value}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppProviders is missing');
  return value;
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
