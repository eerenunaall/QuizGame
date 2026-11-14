import { useEffect, useRef, useState } from 'react';
import type { TvView } from '@quizparty/quiznight';
import { useI18n } from '../../lib/i18n';
import { sfx } from '../../lib/audio';
import { nightsApi } from '../../venue/quiznight/api';
import { ConfettiLayer } from '../../ui/ConfettiLayer';
import { Stage } from '../../ui/Stage';
import { burst, shower } from '../../lib/confetti';
import { isLowMotion } from '../../lib/motion';
import { NightSlide } from './Slides';
import styles from './night.module.css';

export type NightView = TvView & { venueName: string };

const POLL_MS = 1500;

/** The signed display link from the URL (`/tv/gece?l=<token>`, ADR-0029): the TV's only credential. */
export function linkToken(search: string): string | null {
  return new URLSearchParams(search).get('l');
}

/** Sound and confetti follow the slide, once per slide (never again on a poll that changes nothing). */
function useNightEffects(view: NightView | null): void {
  const last = useRef('');
  useEffect(() => {
    if (!view) return;
    const key = `${view.step}:${view.round?.index ?? ''}:${view.question?.number ?? ''}:${view.doubled.join(',')}`;
    if (key === last.current) return;
    const first = last.current === '';
    last.current = key;
    if (first) return;
    switch (view.step) {
      case 'ROUND_TITLE':
        sfx.play('roundStart');
        break;
      case 'LOCKED':
        sfx.play('stinger');
        break;
      case 'ANSWER':
      case 'TIE_ANSWER':
      case 'FINAL_ANSWER':
        sfx.play('revealHit');
        break;
      case 'FINAL_INTRO':
        sfx.play('stinger');
        break;
      case 'FINAL_REVEAL':
        sfx.play('drumroll', { length: 2 });
        sfx.play('score', { delayMs: 2000 });
        break;
      case 'MARKING':
        sfx.play('drumroll', { length: 2 });
        break;
      case 'ROUND_SCORES':
        sfx.play('score');
        break;
      case 'STANDINGS':
        if (view.standings?.some((row) => (row.rankChange ?? 0) > 0)) sfx.play('rankUp');
        break;
      case 'PODIUM':
        sfx.playPodium(Math.min(3, view.podium?.length ?? 1));
        sfx.play('fanfare', { delayMs: 800 });
        if (!isLowMotion()) {
          burst(0.5, 0.5, 220);
          shower(4000);
        }
        break;
      case 'WAITING':
      case 'INTRO':
      case 'HOWTO':
      case 'QUESTION':
      case 'SWAP':
      case 'HALF_TIME':
      case 'TIE_QUESTION':
      case 'FINAL_QUESTION':
        break;
    }
    if (view.step === 'QUESTION' && view.doubled.length > 0) sfx.play('doubleDown');
  }, [view]);
}

export function NightTv() {
  const { t } = useI18n();
  const [view, setView] = useState<NightView | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [state, setState] = useState<'loading' | 'ok' | 'bad' | 'offline'>('loading');
  const [now, setNow] = useState(() => Date.now());
  const token = linkToken(window.location.search);
  const failures = useRef(0);

  useEffect(() => {
    if (!token) {
      setState('bad');
      return undefined;
    }
    let stopped = false;
    const poll = async (): Promise<void> => {
      try {
        const result = await nightsApi.tv(token);
        if (stopped) return;
        if (!result) {
          setState('bad');
          return;
        }
        failures.current = 0;
        setView(result.view);
        setFetchedAt(Date.now());
        setState('ok');
      } catch {
        failures.current += 1;
        if (!stopped && failures.current >= 3) setState('offline');
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (state !== 'bad') void poll();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [token, state === 'bad']); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useNightEffects(view);
  // The timer counts down locally between polls so it moves smoothly; the server stays the authority.
  const secondsLeft =
    view?.timer !== undefined && view.timer !== null
      ? Math.max(
          0,
          Math.ceil((view.timer.remainingMs - (view.timer.running ? now - fetchedAt : 0)) / 1000),
        )
      : null;
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (
      secondsLeft !== null &&
      secondsLeft <= 5 &&
      secondsLeft > 0 &&
      secondsLeft !== lastTick.current &&
      view?.timer?.running
    )
      sfx.countdownTick(secondsLeft);
    lastTick.current = secondsLeft;
  }, [secondsLeft, view?.timer?.running]);

  return (
    <Stage>
      <div className={styles.screen} data-testid="night-tv" data-step={view?.step ?? state}>
        {state === 'bad' ? (
          <div className={styles.safe}>
            <p className={styles.center} data-testid="night-bad">
              {t('qn.tvs.badLink')}
            </p>
          </div>
        ) : view ? (
          <NightSlide view={view} secondsLeft={secondsLeft} />
        ) : (
          <div className={styles.safe}>
            <p className={styles.center}>{t('qn.tvs.waiting')}</p>
          </div>
        )}
        {state === 'offline' ? (
          <div className={styles.offline}>{t('qn.tvs.reconnecting')}</div>
        ) : null}
        {view?.paused ? (
          <div className={styles.paused} data-testid="night-paused">
            {t('qn.tvs.paused')}
          </div>
        ) : null}
        {view?.step === 'PODIUM' ? <ConfettiLayer /> : null}
      </div>
    </Stage>
  );
}
