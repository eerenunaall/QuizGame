import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useApp, useStore } from '../native/AppProviders';
import { UnlockScreen, type UnlockStatus } from '../screens/LinkScreens';

/** `quiznight://unlock/<id>` / `https://host/unlock/<id>`: attach the signed-in account's full game to the TV room. */
export function UnlockContainer({ intentId }: { intentId: string }) {
  const { runtime } = useApp();
  const router = useRouter();
  const auth = useStore(runtime.auth.store);
  const [status, setStatus] = useState<UnlockStatus>('READY');
  const [roomCode, setRoomCode] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status === 'LOADING') return;
    if (auth.status === 'SIGNED_OUT') {
      setStatus('NEED_SIGN_IN');
      return;
    }
    setStatus('READY');
    runtime.api
      .peekLink(intentId)
      .then((link) => setRoomCode(link.roomCode))
      .catch(() => setStatus('DEAD'));
  }, [runtime, intentId, auth.status]);

  const claim = (): void => {
    setStatus('WORKING');
    runtime.api
      .claimLink(intentId)
      .then((result) => {
        setRoomCode(result.roomCode);
        setStatus(result.tier === 'FULL' ? 'DONE' : 'NOT_OWNED');
      })
      .catch(() => setStatus('DEAD'));
  };

  return (
    <UnlockScreen
      status={status}
      roomCode={roomCode}
      onClaim={claim}
      onSignIn={() => router.push('/profile')}
      onBuy={() => router.push('/purchase')}
    />
  );
}
