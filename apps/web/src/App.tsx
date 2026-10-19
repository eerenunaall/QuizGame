import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { parseRoomCode } from '@quizparty/shared';
import type { Locale } from '@quizparty/i18n';
import { ClientProvider } from './lib/client-context';
import { I18nProvider, pickLocale } from './lib/i18n';
import { Redirect, Router, type RouteDef } from './lib/router';
import type { ThemeId } from '@quizparty/ui-tokens';
import { applyTheme, saveTheme } from './lib/theme';
import { createStorage, loadPreferences, savePreferences } from './lib/storage';
import { CodeEntry } from './pages/CodeEntry';
import { Home } from './pages/Home';
import { CreditsPage, NotFoundPage, PurchasePage } from './pages/StaticPages';
import { QuizEditorPage } from './pages/QuizEditor';
import { QuizzesPage } from './pages/Quizzes';
import { RespondPage } from './pages/Respond';
import { UnlockPage } from './pages/Unlock';

// Phones never download the TV screens (and the QR code library); TVs never download the controller.
const TvApp = lazy(() => import('./tv/TvApp').then((module) => ({ default: module.TvApp })));
// Venue staff use their own phones: the desk is a separate chunk nobody else downloads.
const StaffPage = lazy(() =>
  import('./venue/StaffPage').then((module) => ({ default: module.StaffPage })),
);
const PlayApp = lazy(() =>
  import('./play/PlayApp').then((module) => ({ default: module.PlayApp })),
);
// The legal texts are long and rarely read: nobody downloads them with the game.
const LegalPage = lazy(() =>
  import('./pages/Legal').then((module) => ({ default: module.LegalPage })),
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

  const [theme, setTheme] = useState<ThemeId>(
    () => (document.documentElement.dataset.theme as ThemeId | undefined) ?? 'party',
  );
  const changeTheme = useCallback(
    (next: ThemeId): void => {
      setTheme(next);
      applyTheme(document, next);
      saveTheme(storage, next);
    },
    [storage],
  );

  const routes: RouteDef[] = [
    { path: '/', render: () => <Home locale={locale} onLocale={changeLocale} /> },
    {
      path: '/tv',
      render: () => (
        <ClientProvider kind="DISPLAY">
          <TvApp locale={locale} onLocale={changeLocale} theme={theme} onTheme={changeTheme} />
        </ClientProvider>
      ),
    },
    { path: '/join/:code?', render: (params) => <PlayRoute code={params.code} /> },
    { path: '/play/:code?', render: (params) => <PlayRoute code={params.code} /> },
    { path: '/quizzes', render: () => <QuizzesPage /> },
    { path: '/quizzes/:id', render: (params) => <QuizEditorPage id={params.id ?? ''} /> },
    {
      path: '/blind/respond/:token',
      render: (params) => <RespondPage token={params.token ?? ''} />,
    },
    { path: '/unlock/:token', render: (params) => <UnlockPage token={params.token ?? ''} /> },
    { path: '/purchase', render: () => <PurchasePage /> },
    { path: '/staff', render: () => <StaffPage /> },
    { path: '/credits', render: () => <CreditsPage /> },
    { path: '/privacy', render: () => <LegalPage doc="privacy" /> },
    { path: '/terms', render: () => <LegalPage doc="terms" /> },
    { path: '/support', render: () => <LegalPage doc="support" /> },
  ];

  return (
    <I18nProvider locale={locale}>
      <Suspense
        fallback={
          <div className="qp-boot" role="status">
            QuizNight
          </div>
        }
      >
        <Router routes={routes} notFound={<NotFoundPage />} />
      </Suspense>
    </I18nProvider>
  );
}
