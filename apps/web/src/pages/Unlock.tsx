import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Wordmark } from '../ui/Wordmark';
import { AccountApiError, accountApi, type AccountView } from '../lib/account';
import { useI18n } from '../lib/i18n';
import styles from './CodeEntry.module.css';

type Step =
  | { kind: 'loading' }
  | { kind: 'signIn' }
  | { kind: 'ready'; account: AccountView; roomCode: string }
  | { kind: 'done'; roomCode: string; tier: 'FREE' | 'FULL' }
  | { kind: 'dead' };

/**
 * The page a TV's "unlock" QR code opens on a phone: sign in with the account that owns the game,
 * then attach it to the room. A purchase is never made here (web checkout is off, ADR-0013).
 */
export function UnlockPage({ token }: { token: string }) {
  const { t, locale } = useI18n();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** Whoever is signed in sees what the link is for; a dead link says so without saying why. */
  const proceed = useCallback(
    async (account: AccountView): Promise<void> => {
      try {
        const link = await accountApi.peekLink(token);
        setStep({ kind: 'ready', account, roomCode: link.roomCode });
      } catch {
        setStep({ kind: 'dead' });
      }
    },
    [token],
  );

  useEffect(() => {
    accountApi.me().then(
      (account) =>
        account.sessionKind === 'ADMIN' ? setStep({ kind: 'signIn' }) : proceed(account),
      () => setStep({ kind: 'signIn' }),
    );
  }, [proceed]);

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

  const sendCode = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      await accountApi.requestCode(email, locale);
      setSent(true);
    });
  };
  const verify = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      const account = await accountApi.verifyCode(email, code);
      await proceed(account);
    });
  };
  const claim = (): void => {
    void run(async () => {
      try {
        const result = await accountApi.claimLink(token);
        setStep({ kind: 'done', roomCode: result.roomCode, tier: result.tier });
      } catch (error) {
        if (error instanceof AccountApiError && error.status === 404) setStep({ kind: 'dead' });
        else throw error;
      }
    });
  };

  return (
    <div className={styles.screen}>
      <Wordmark scale={0.62} />
      <div className={styles.card} data-testid="unlock-page">
        <h1 className={styles.label}>{t('unlock.title')}</h1>
        {step.kind === 'loading' ? <p className={styles.hint}>…</p> : null}
        {step.kind === 'dead' ? (
          <p role="alert" data-testid="unlock-dead">
            {t('unlock.dead')}
          </p>
        ) : null}
        {step.kind === 'signIn' ? (
          <form onSubmit={sent ? verify : sendCode}>
            <p className={styles.label}>{t('unlock.intro')}</p>
            {sent ? (
              <>
                <p role="status">{t('unlock.sent')}</p>
                <label className={styles.label} htmlFor="unlock-code">
                  {t('unlock.code')}
                </label>
                <input
                  id="unlock-code"
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
                <label className={styles.label} htmlFor="unlock-email">
                  {t('unlock.email')}
                </label>
                <input
                  id="unlock-email"
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
        ) : null}
        {step.kind === 'ready' ? (
          <div>
            <p>{t('unlock.room', { code: step.roomCode })}</p>
            <p className={styles.label}>
              {t('unlock.signedIn', { email: step.account.email ?? '' })}
            </p>
            <div className={styles.hint} role="alert" data-testid="unlock-error">
              {message ?? ''}
            </div>
            <Button size="lg" block disabled={busy} onClick={claim} data-testid="unlock-claim">
              {t('unlock.link')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              block
              style={{ marginTop: 14 }}
              onClick={() => void accountApi.logout().finally(() => setStep({ kind: 'signIn' }))}
            >
              {t('unlock.signOut')}
            </Button>
          </div>
        ) : null}
        {step.kind === 'done' ? (
          <p role="status" data-testid="unlock-result" data-tier={step.tier}>
            {step.tier === 'FULL' ? t('unlock.success') : t('unlock.notOwned')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
