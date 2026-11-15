import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { AccountApiError, accountApi, type AccountView } from '../lib/account';
import { useI18n } from '../lib/i18n';
import styles from './CodeEntry.module.css';

export type SessionState =
  { kind: 'loading' } | { kind: 'out' } | { kind: 'in'; account: AccountView };

/** The signed-in player account of this browser (a staff console session counts as signed out here). */
export function useAccount(): {
  state: SessionState;
  signedIn: (account: AccountView) => void;
  signOut: () => void;
} {
  const [state, setState] = useState<SessionState>({ kind: 'loading' });
  useEffect(() => {
    accountApi.me().then(
      (account) =>
        setState(account.sessionKind === 'ADMIN' ? { kind: 'out' } : { kind: 'in', account }),
      () => setState({ kind: 'out' }),
    );
  }, []);
  const signedIn = useCallback((account: AccountView) => setState({ kind: 'in', account }), []);
  const signOut = useCallback(() => {
    void accountApi.logout().finally(() => setState({ kind: 'out' }));
  }, []);
  return { state, signedIn, signOut };
}

/** Email one-time-code sign-in as a WEB client (never as staff). */
export function SignInForm({
  intro,
  onSignedIn,
}: {
  intro: string;
  onSignedIn: (account: AccountView) => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refusal = (error: unknown): string => {
    if (error instanceof AccountApiError) {
      if (error.status === 429) return t('unlock.throttled');
      if (error.status === 404) return t('unlock.disabled');
      if (error.status === 400) return t('unlock.invalidEmail');
    }
    return t('unlock.refused');
  };
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage(refusal(error));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      if (!sent) {
        await accountApi.requestCode(email, locale);
        setSent(true);
      } else onSignedIn(await accountApi.verifyCode(email, code));
    });
  };

  return (
    <form onSubmit={submit}>
      <p className={styles.label}>{intro}</p>
      {sent ? (
        <>
          <p role="status">{t('unlock.sent')}</p>
          <label className={styles.label} htmlFor="signin-code">
            {t('unlock.code')}
          </label>
          <input
            id="signin-code"
            className={styles.input}
            data-testid="unlock-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/gu, ''))}
          />
        </>
      ) : (
        <>
          <label className={styles.label} htmlFor="signin-email">
            {t('unlock.email')}
          </label>
          <input
            id="signin-email"
            className={styles.input}
            style={{ fontSize: 22, letterSpacing: 0, textIndent: 0 }}
            data-testid="unlock-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </>
      )}
      <div className={styles.hint} role="alert" data-testid="unlock-error">
        {message ?? ''}
      </div>
      <Button
        type="submit"
        size="lg"
        block
        disabled={busy || (sent ? code.length !== 6 : email.length < 3)}
        data-testid={sent ? 'unlock-verify' : 'unlock-send'}
      >
        {sent ? t('unlock.verify') : t('unlock.sendCode')}
      </Button>
    </form>
  );
}
