import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { parseRoomCode } from '@quizparty/shared';
import type { Locale } from '@quizparty/i18n';
import { ClientProvider } from './lib/client-context';
import { I18nProvider, pickLocale } from './lib/i18n';
import { Redirect, Router, type RouteDef } from './lib/router';
import { createStorage, loadPreferences, savePreferences } from './lib/storage';
import { CodeEntry } from './pages/CodeEntry';
import { Home } from './pages/Home';
import { CreditsPage, NotFoundPage } from './pages/StaticPages';

// Phones never download the TV screens (and the QR code library); TVs never download the controller.
const TvApp = lazy(() => import('./tv/TvApp').then((module) => ({ default: module.TvApp })));
const PlayApp = lazy(() =>
  import('./play/PlayApp').then((module) => ({ default: module.PlayApp })),
);

function PlayRoute({ code }: { code: string | undefined }) {
  if (!code) return <CodeEntry />;
  const parsed = parseRoomCode(code);
  if (!parsed) return <Redirect to="/join" />;
  return (
    <ClientProvider kind="WEB">
      <PlayApp code={parsed} />
    </ClientProvider>
  );
}

export function App() {
  const storage = useMemo(() => createStorage(), []);
  const [locale, setLocale] = useState<Locale>(() =>
    pickLocale(window.location.search, storage, navigator.language),
  );
  const changeLocale = useCallback(
    (next: Locale): void => {
      setLocale(next);
      savePreferences(storage, { ...loadPreferences(storage), locale: next });
      document.documentElement.lang = next;
    },
    [storage],
  );

  const routes: RouteDef[] = [
    { path: '/', render: () => <Home locale={locale} onLocale={changeLocale} /> },
    {
      path: '/tv',
      render: () => (
        <ClientProvider kind="DISPLAY">
          <TvApp locale={locale} onLocale={changeLocale} />
        </ClientProvider>
      ),
    },
    { path: '/join/:code?', render: (params) => <PlayRoute code={params.code} /> },
    { path: '/play/:code?', render: (params) => <PlayRoute code={params.code} /> },
    { path: '/credits', render: () => <CreditsPage /> },
  ];

  return (
    <I18nProvider locale={locale}>
      <Suspense
        fallback={
          <div className="qp-boot" role="status">
            Quiz Party
          </div>
        }
      >
        <Router routes={routes} notFound={<NotFoundPage />} />
      </Suspense>
    </I18nProvider>
  );
}
