import { Share } from 'react-native';
import { useApp, useStore } from '../native/AppProviders';
import { ProfileScreen } from '../screens/ProfileScreen';

export function ProfileContainer() {
  const { runtime, locale, hapticsOn, setHapticsOn } = useApp();
  const auth = useStore(runtime.auth.store);
  const purchase = useStore(runtime.purchases.store);
  return (
    <ProfileScreen
      account={auth.account}
      tier={purchase.tier}
      hapticsOn={hapticsOn}
      requestCode={(email) => runtime.auth.requestCode(email, locale)}
      verifyCode={async (email, code) => {
        await runtime.auth.verifyCode(email, code);
        // A purchase made while signed out of this account is settled now (restore is idempotent).
        void runtime.purchases.load().then(() => runtime.purchases.recover());
      }}
      onSignOut={() => runtime.auth.signOut()}
      onExport={async () => {
        const data = await runtime.api.exportData();
        await Share.share({
          message: JSON.stringify(data, null, 2),
          title: 'quiznight-account.json',
        });
      }}
      onDelete={async () => {
        await runtime.api.deleteAccount();
        await runtime.auth.clear();
      }}
      onToggleHaptics={() => setHapticsOn(!hapticsOn)}
    />
  );
}
