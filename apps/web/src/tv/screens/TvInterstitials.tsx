import { useEffect, useRef, useState } from 'react';
import type { Difficulty, RoundKind, RoundPublic } from '@quizparty/protocol';
import { Button } from '../../ui/Button';
import { AnimatedSticker, Sticker } from '../../ui/Sticker';
import { categoryIcon } from '../../lib/assets';
import { useI18n } from '../../lib/i18n';
import styles from './TvInterstitials.module.css';

/** Big 3·2·1 driven by the server deadline, so a late-joining TV shows the right number. */
export function TvCountdown({
  now,
  deadlineAt,
  onNumber,
}: {
  now: () => number;
  deadlineAt: number;
  onNumber?: (n: number) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(() => Math.max(0, Math.ceil((deadlineAt - now()) / 1000)));
  const last = useRef<number | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadlineAt - now()) / 1000));
      setValue(next);
      if (last.current !== next) {
        last.current = next;
        onNumber?.(next);
      }
    }, 80);
    return () => window.clearInterval(id);
  }, [deadlineAt, now, onNumber]);
  return (
    <div className={styles.center} data-testid="tv-countdown">
      <div className={styles.ready}>{t('tv.gate.title')}</div>
      <div className={styles.bigNumber} key={value}>
        {value > 0 ? value : t('game.countdown.go')}
      </div>
    </div>
  );
}

const KIND_ICON: Record<RoundKind, 'rocket' | 'stopwatch' | 'bomb' | 'megaphone' | 'fire'> = {
  STANDARD: 'rocket',
  SPEED: 'stopwatch',
  RISK: 'bomb',
  CROWD: 'megaphone',
  FINAL: 'fire',
};

/** "SORU 3 / 10" with the kind of round and what it is worth. */
export function TvRoundIntro({ round }: { round: RoundPublic }) {
  const { t, td } = useI18n();
  return (
    <div className={styles.center} data-testid="tv-round-intro">
      <Sticker id={KIND_ICON[round.kind]} size={220} className={styles.pop} />
      <div className={styles.introTitle} key={round.index}>
        {t('game.round.of', { n: round.index + 1, total: round.total })}
      </div>
      <div className={styles.kind}>{td(`game.kind.${round.kind}`)}</div>
      {round.finalStage ? (
        <div className={styles.worth}>
          {t('game.final.position', {
            n: round.finalStage.position,
            total: round.finalStage.length,
          })}
        </div>
      ) : null}
      <div className={styles.worth}>{t('game.points', { points: round.basePoints })}</div>
    </div>
  );
}

/** The final-stage splash: "FİNAL TURU · son N soru · puanlar iki katı". */
export function TvFinalSplash({ round }: { round: RoundPublic }) {
  const { t, td } = useI18n();
  const length = round.finalStage?.length ?? 1;
  return (
    <div className={styles.center} data-testid="tv-final-splash">
      <div className={styles.finalRow}>
        <AnimatedSticker id="crown" size={200} />
      </div>
      <div className={styles.finalTitle}>{t('game.final.title')}</div>
      <div className={styles.finalBox}>
        <div className={styles.finalMain}>{td('game.final.lastN', { count: length })}</div>
        <div className={styles.finalSub}>{t('game.final.double')}</div>
      </div>
    </div>
  );
}

/** Between "READY" and the question: the category and difficulty, for a beat. */
export function TvPrep({
  category,
  difficulty,
}: {
  category: { id: string; label: string };
  difficulty: Difficulty;
}) {
  const { t, td } = useI18n();
  return (
    <div className={styles.center} data-testid="tv-prep">
      <Sticker id={categoryIcon(category.id)} size={260} className={styles.pop} />
      <div className={styles.introTitle} key={category.id}>
        {category.label}
      </div>
      <div className={styles.kind}>{td(`game.difficulty.${difficulty}`)}</div>
      <div className={styles.worth}>{t('game.question.getReady')}</div>
    </div>
  );
}

/** A short beat between questions: what is coming next. */
export function TvIntermission({ next }: { next: { index: number; kind: RoundKind } | null }) {
  const { t, td } = useI18n();
  return (
    <div className={styles.center} data-testid="tv-intermission">
      {next ? (
        <>
          <Sticker id={KIND_ICON[next.kind]} size={150} className={styles.pop} />
          <div className={styles.introTitle}>
            {t('game.next', { what: td(`game.kind.${next.kind}`) })}
          </div>
        </>
      ) : null}
    </div>
  );
}

const CLOSE_STICKER = 'hourglass' as const;

export function TvClosed({ message, onNew }: { message: string; onNew: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className={styles.center} data-testid="tv-closed">
      <Sticker id={CLOSE_STICKER} size={200} className={styles.pop} />
      <div className={styles.introTitle}>{t('closed.title')}</div>
      <div className={styles.worth}>{message}</div>
      <div className={styles.cta}>
        <Button ref={ref} size="xl" onClick={onNew}>
          {t('closed.newGame')}
        </Button>
      </div>
    </div>
  );
}
