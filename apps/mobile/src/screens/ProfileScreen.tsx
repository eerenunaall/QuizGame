import { useState } from 'react';
import { ScrollView } from 'react-native';
import type { AccountView } from '../core/api';
import { Body, Button, ErrorText, Panel, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';
import { describeFailure } from './errors';
import { SignInForm } from './SignInForm';

/**
 * Profile shell: sign-in by email code (MOBILE session), then sign out, export and delete account
 * (guideline 5.1.1(v): deletion must be possible in-app). Deleting asks twice.
 */
export function ProfileScreen({
  account,
  tier,
  hapticsOn,
  requestCode,
  verifyCode,
  onSignOut,
  onExport,
  onDelete,
  onToggleHaptics,
}: {
  account: AccountView | null;
  tier: 'FREE' | 'FULL';
  hapticsOn: boolean;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  onExport: () => Promise<void>;
  onDelete: () => Promise<void>;
  onToggleHaptics: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'export' | 'delete' | 'out' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (
    kind: 'export' | 'delete' | 'out',
    work: () => Promise<void>,
    done?: string,
  ): void => {
    setBusy(kind);
    setError(null);
    setMessage(null);
    work()
      .then(() => done && setMessage(done))
      .catch((cause: unknown) => setError(describeFailure(i18n, cause)))
      .finally(() => {
        setBusy(null);
        setConfirming(false);
      });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} testID="profile">
      <Title>{t('m.profile.title')}</Title>
      {account ? (
        <>
          <Panel>
            <Body testID="profile-email">
              {t('m.profile.signedInAs', { email: account.email ?? '' })}
            </Body>
            <Body tone="muted">
              {t(tier === 'FULL' ? 'm.profile.tier.FULL' : 'm.profile.tier.FREE')}
            </Body>
          </Panel>
          <Button
            testID="profile-export"
            variant="ghost"
            label={t('m.profile.export')}
            busy={busy === 'export'}
            onPress={() => run('export', onExport, t('m.profile.exported'))}
          />
          <Button
            testID="profile-signout"
            variant="ghost"
            label={t('m.profile.signOut')}
            busy={busy === 'out'}
            onPress={() => run('out', onSignOut)}
          />
          {confirming ? (
            <Panel>
              <Body tone="bad">{t('m.profile.deleteWarn')}</Body>
              <Button
                testID="profile-delete-confirm"
                variant="danger"
                label={t('m.profile.deleteConfirm')}
                busy={busy === 'delete'}
                onPress={() => run('delete', onDelete, t('m.profile.deleted'))}
              />
              <Button
                variant="ghost"
                label={t('common.cancel')}
                onPress={() => setConfirming(false)}
              />
            </Panel>
          ) : (
            <Button
              testID="profile-delete"
              variant="danger"
              label={t('m.profile.delete')}
              onPress={() => setConfirming(true)}
            />
          )}
        </>
      ) : (
        <SignInForm requestCode={requestCode} verifyCode={verifyCode} />
      )}
      <Button
        testID="profile-haptics"
        variant="ghost"
        label={`${t('m.profile.haptics')}: ${hapticsOn ? '✓' : '✗'}`}
        onPress={onToggleHaptics}
      />
      {message ? (
        <Body tone="good" testID="profile-message">
          {message}
        </Body>
      ) : null}
      {error ? <ErrorText testID="profile-error">{error}</ErrorText> : null}
      <Body tone="muted">{t('m.profile.privacy')}</Body>
    </ScrollView>
  );
}
