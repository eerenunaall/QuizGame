import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Wordmark } from '../ui/Wordmark';
import { AccountApiError, accountApi, type AccountView, type QuizKind } from '../lib/account';
import { useI18n } from '../lib/i18n';
import { Link } from '../lib/router';
import styles from './CodeEntry.module.css';
import { SignInForm, useAccount } from './useAccount';
import { venueApi } from '../venue/api';

interface Peek {
  roomCode: string;
  tier: 'FREE' | 'FULL';
  mode: string;
  whoSaidIt?: boolean;
  quizzes: { id: string; kind: QuizKind; title: string; ready: boolean }[];
}

type Step =
  | { kind: 'ready'; peek: Peek }
  | { kind: 'done'; roomCode: string; tier: 'FREE' | 'FULL' }
  | { kind: 'attached'; title: string | null; mode?: string }
  | { kind: 'dead' };

/**
 * The page a TV's QR code opens on a phone: sign in with the account that owns the game, then attach
 * that account to the room (unlock the full game) and/or put one of its personal quizzes in the room.
 * A purchase is never made here (web checkout is off, ADR-0013).
 */
export function UnlockPage({ token }: { token: string }) {
  const { t } = useI18n();
  const { state, signedIn, signOut } = useAccount();
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Venue staff scan the same QR to open the TV as a metered table (ADR-0024); others never see this.
  const [venueStaff, setVenueStaff] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStep({ kind: 'ready', peek: await accountApi.peekLink(token) });
    } catch {
      setStep({ kind: 'dead' });
    }
  }, [token]);

  useEffect(() => {
    if (state.kind === 'in') void load();
  }, [state, load]);
  useEffect(() => {
    if (state.kind !== 'in') return;
    venueApi.mine().then(
      (result) => setVenueStaff(Array.isArray(result.venues) && result.venues.length > 0),
      () => setVenueStaff(false),
    );
  }, [state]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 404) setStep({ kind: 'dead' });
      else if (error instanceof AccountApiError && error.code === 'NOT_READY')
        setMessage(t('unlock.quiz.notReady'));
      else if (error instanceof AccountApiError && error.code === 'TIER_REQUIRED')
        setMessage(t('unlock.quiz.needFull'));
      else setMessage(t('unlock.refused'));
    } finally {
      setBusy(false);
    }
  };

  const claim = (): void => {
    void run(async () => {
      const result = await accountApi.claimLink(token);
      setStep({ kind: 'done', roomCode: result.roomCode, tier: result.tier });
    });
  };
  const attach = (quizId: string | null): void => {
    void run(async () => {
      const result = await accountApi.attachQuiz(token, quizId);
      setStep({ kind: 'attached', title: result.title });
    });
  };

  const attachWhoSaidIt = (): void => {
    void run(async () => {
      const result = await accountApi.attachWhoSaidIt(token);
      setStep({ kind: 'attached', title: result.title, mode: result.mode });
    });
  };

  return (
    <div className={styles.screen}>
      <Wordmark scale={0.62} />
      <div className={styles.card} data-testid="unlock-page">
        <h1 className={styles.label}>{t('unlock.title')}</h1>
        {state.kind === 'loading' ? <p className={styles.hint}>…</p> : null}
        {state.kind === 'out' ? (
          <SignInForm
            intro={t('unlock.intro')}
            onSignedIn={(account: AccountView) => signedIn(account)}
          />
        ) : null}
        {state.kind === 'in' && step === null ? <p className={styles.hint}>…</p> : null}
        {step?.kind === 'dead' ? (
          <p role="alert" data-testid="unlock-dead">
            {t('unlock.dead')}
          </p>
        ) : null}
        {state.kind === 'in' && step?.kind === 'ready' ? (
          <div>
            <p>{t('unlock.room', { code: step.peek.roomCode })}</p>
            {venueStaff ? (
              <p>
                <Link to={`/staff?link=${encodeURIComponent(token)}`} data-testid="unlock-staff">
                  {t('unlock.staff')}
                </Link>
              </p>
            ) : null}
            <p className={styles.label}>
              {t('unlock.signedIn', { email: state.account.email ?? '' })}
            </p>
            <div className={styles.hint} role="alert" data-testid="unlock-error">
              {message ?? ''}
            </div>
            {/* peek.tier is the signed-in account's tier, not the room's: linking is how the room learns it. */}
            <Button size="lg" block disabled={busy} onClick={claim} data-testid="unlock-claim">
              {t('unlock.link')}
            </Button>
            <h2 className={styles.label} style={{ marginTop: 18 }}>
              {t('unlock.quiz.title')}
            </h2>
            {step.peek.quizzes.length === 0 ? (
              <p>{t('unlock.quiz.none')}</p>
            ) : (
              step.peek.quizzes.map((quiz) => (
                <Button
                  key={quiz.id}
                  variant="violet"
                  size="md"
                  block
                  disabled={busy || !quiz.ready}
                  onClick={() => attach(quiz.id)}
                  data-testid={`attach-${quiz.id}`}
                  style={{ marginBottom: 10 }}
                >
                  {quiz.title}
                  {quiz.ready ? '' : ` · ${t('quiz.notReady')}`}
                </Button>
              ))
            )}
            {step.peek.whoSaidIt ? (
              <>
                <Button
                  variant="violet"
                  size="md"
                  block
                  disabled={busy}
                  onClick={attachWhoSaidIt}
                  data-testid="attach-who-said-it"
                  style={{ marginBottom: 4 }}
                >
                  {t('unlock.whosaidit')}
                </Button>
                <p className={styles.hint} style={{ marginBottom: 10 }}>
                  {t('unlock.whosaidit.hint')}
                </p>
              </>
            ) : null}
            {step.peek.mode !== 'CLASSIC' ? (
              <Button variant="ghost" size="md" block disabled={busy} onClick={() => attach(null)}>
                {t('unlock.quiz.classic')}
              </Button>
            ) : null}
            <p style={{ marginTop: 14 }}>
              <Link to="/quizzes">{t('unlock.quiz.manage')}</Link>
            </p>
            <Button variant="ghost" size="md" block onClick={signOut} style={{ marginTop: 10 }}>
              {t('unlock.signOut')}
            </Button>
          </div>
        ) : null}
        {step?.kind === 'done' ? (
          <p role="status" data-testid="unlock-result" data-tier={step.tier}>
            {step.tier === 'FULL' ? t('unlock.success') : t('unlock.notOwned')}
          </p>
        ) : null}
        {step?.kind === 'attached' ? (
          <p role="status" data-testid="unlock-attached">
            {step.mode === 'WHO_SAID_IT'
              ? t('unlock.whosaidit.attached')
              : t('unlock.quiz.attached')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
