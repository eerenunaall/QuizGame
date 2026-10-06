import { Suspense, lazy, useEffect, useState } from 'react';
import { ClientProvider } from '../lib/client-context';
import { CodeEntry } from './CodeEntry';

const TvApp = lazy(() => import('../tv/TvApp').then((module) => ({ default: module.TvApp })));

/** Wide landscape screens are TVs and desktops: start a game. Everything else is a phone: join one. */
function useIsTvLike(): boolean {
  const query = '(min-width: 1000px) and (min-aspect-ratio: 13/10)';
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => setMatches(media.matches);
    if (media.addEventListener) media.addEventListener('change', update);
    else media.addListener(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update);
      else media.removeListener(update);
    };
  }, []);
  return matches;
}

export function Home({
  locale,
  onLocale,
}: {
  locale: 'tr' | 'en';
  onLocale: (locale: 'tr' | 'en') => void;
}) {
  const tvLike = useIsTvLike();
  if (!tvLike) return <CodeEntry />;
  return (
    <ClientProvider kind="DISPLAY">
      <Suspense
        fallback={
          <div className="qp-boot" role="status">
            Quiz Party
          </div>
        }
      >
        <TvApp locale={locale} onLocale={onLocale} />
      </Suspense>
    </ClientProvider>
  );
}
