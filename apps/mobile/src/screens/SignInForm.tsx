import { useState } from 'react';
import { View } from 'react-native';
import { Body, Button, ErrorText, Field, Title } from '../ui/components';
import { useI18n } from '../ui/i18n';
import { describeSignInFailure } from './errors';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Email one-time-code sign-in (ADR-0012): two steps, no password, generic server answers. */
export function SignInForm({
  requestCode,
  verifyCode,
}: {
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (work: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    work()
      .catch((cause: unknown) => setError(describeSignInFailure(i18n, cause)))
      .finally(() => setBusy(false));
  };

  return (
    <View style={{ gap: 12, alignSelf: 'stretch' }} testID="signin">
      <Title>{t('m.signin.title')}</Title>
      <Body tone="muted">{t('m.signin.intro')}</Body>
      <Field
        label={t('unlock.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        editable={!sent}
        testID="signin-email"
      />
      {sent ? (
        <>
          <Body tone="muted">{t('unlock.sent')}</Body>
          <Field
            label={t('unlock.code')}
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/gu, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            testID="signin-code"
          />
        </>
      ) : null}
      {error ? <ErrorText testID="signin-error">{error}</ErrorText> : null}
      {sent ? (
        <Button
          testID="signin-verify"
          label={t('unlock.verify')}
          busy={busy}
          disabled={code.length !== 6}
          onPress={() => run(() => verifyCode(email.trim(), code))}
        />
      ) : (
        <Button
          testID="signin-send"
          label={t('unlock.sendCode')}
          busy={busy}
          onPress={() => {
            if (!EMAIL.test(email.trim())) return setError(t('unlock.invalidEmail'));
            run(async () => {
              await requestCode(email.trim());
              setSent(true);
            });
          }}
        />
      )}
    </View>
  );
}
