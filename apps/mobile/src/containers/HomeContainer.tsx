import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useApp } from '../native/AppProviders';
import { HomeScreen } from '../screens/HomeScreen';

/** Home. A seat stored by an earlier session is offered as "back to your room" (server decides if it is still valid). */
export function HomeContainer() {
  const { runtime, locale, setLocale } = useApp();
  const router = useRouter();
  const [resumeCode, setResumeCode] = useState<string | null>(null);

  useEffect(() => {
    // The last room this client was seated in, remembered by the shared client's own session key.
    void (async () => {
      const last = await runtime.storage.get('qp.lastRoom');
      if (last && (await runtime.client.storedSession('PLAYER', last))) setResumeCode(last);
    })();
  }, [runtime]);

  return (
    <HomeScreen
      resumeCode={resumeCode}
      onJoin={() => router.push('/join')}
      onResume={(code) => router.push(`/room/${code}`)}
      onFullGame={() => router.push('/purchase')}
      onProfile={() => router.push('/profile')}
      onToggleLocale={() => setLocale(locale === 'tr' ? 'en' : 'tr')}
    />
  );
}
