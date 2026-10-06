import { useEffect, useRef, useState } from 'react';
import type { PhaseDataOf, RoundKind, RoundPublic } from '@quizparty/protocol';
import { Button } from '../../ui/Button';
import { CountdownRing } from '../../ui/CountdownRing';
import { AnimatedSticker, Sticker } from '../../ui/Sticker';
import { categoryIcon } from '../../lib/assets';
import { useI18n } from '../../lib/i18n';
import { STAKE_STICKER } from '../../play/powers';
import styles from './TvInterstitials.module.css';
import { cx } from '../../lib/cx';

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

/**
 * QUESTION_PREP on the TV: the category, the stake ladder everyone is choosing from, which powers
 * are on, and how many players have decided (never what they decided).
 */
export function TvPrep({
  data,
  now,
  startAt,
  deadlineAt,
}: {
  data: PhaseDataOf<'QUESTION_PREP'>;
  now: () => number;
  startAt: number;
  deadlineAt: number | null;
}) {
  const { t, td } = useI18n();
  const total = Math.max(data.eligibleCount, data.committedCount);
  return (
    <div className={styles.center} data-testid="tv-prep">
      <div className={styles.prepHead}>
        <Sticker id={categoryIcon(data.category.id)} size={190} className={styles.pop} />
        <div className={styles.prepTitleBox}>
          <div className={styles.prepCategory} key={data.category.id}>
            {data.category.label}
          </div>
          <div className={styles.prepPills}>
            <span className={styles.pill}>{td(`game.difficulty.${data.difficulty}`)}</span>
            <span className={styles.pill}>{td(`game.kind.${data.round.kind}`)}</span>
          </div>
        </div>
      </div>

      <div className={styles.ladderTitle}>{t('tv.prep.title')}</div>
      <div className={styles.ladder} data-testid="tv-ladder">
        {data.riskLadder.map((rung) => (
          <div key={rung.tier} className={cx(styles.rung, styles[`rung${rung.tier}`])}>
            <Sticker id={STAKE_STICKER[rung.tier]} size={72} />
            <span className={styles.rungName}>{td(`ctl.prep.stake.${rung.tier}`)}</span>
            <span className={styles.rungMult}>×{rung.multiplier}</span>
            <span className={styles.rungLoss}>
              {rung.loss > 0
                ? t('ctl.prep.stake.loss', { loss: rung.loss })
                : t('ctl.prep.stake.noLoss')}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.badges}>
        {data.stakeMandatory ? (
          <span className={cx(styles.badge, styles.badgeGold)}>{t('tv.prep.mandatory')}</span>
        ) : null}
        {data.doubleDownEnabled ? (
          <span className={styles.badge}>
            <Sticker id="fire" size={44} />
            {t('tv.prep.doubleDownOpen')}
          </span>
        ) : null}
        {data.sabotageEnabled ? (
          <span className={styles.badge}>
            <Sticker id="bomb" size={44} />
            {t('tv.prep.sabotageOpen')}
          </span>
        ) : null}
      </div>

      <div className={styles.prepFoot}>
        <span className={styles.prepReady} data-testid="tv-prep-ready">
          {t('tv.prep.ready', { done: data.committedCount, total })}
        </span>
        {deadlineAt !== null ? (
          <CountdownRing now={now} startAt={startAt} deadlineAt={deadlineAt} size={120} />
        ) : null}
      </div>
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
