import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useApp, useStore } from '../native/AppProviders';
import { PurchaseScreen } from '../screens/PurchaseScreen';

export function PurchaseContainer() {
  const { runtime } = useApp();
  const router = useRouter();
  const auth = useStore(runtime.auth.store);
  const state = useStore(runtime.purchases.store);

  useEffect(() => {
    void runtime.purchases.load();
  }, [runtime, auth.status]);

  return (
    <PurchaseScreen
      state={state}
      signedIn={auth.status === 'SIGNED_IN'}
      // Failures land in the flow's own state (shown by the screen); the promise rejection is redundant here.
      onBuy={() => void runtime.purchases.buy().catch(() => undefined)}
      onRestore={() => void runtime.purchases.restore().catch(() => undefined)}
      onSignIn={() => router.push('/profile')}
    />
  );
}
