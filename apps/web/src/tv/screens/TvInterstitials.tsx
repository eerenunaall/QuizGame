import { useEffect, useRef, useState } from 'react';
import type { PhaseDataOf, RoundKind, RoundPublic } from '@quizparty/protocol';
import { Button } from '../../ui/Button';
import { CountdownRing } from '../../ui/CountdownRing';
import { AnimatedSticker, Sticker } from '../../ui/Sticker';
import { PowerIcon } from '../../ui/PowerIcon';
import { useI18n } from '../../lib/i18n';
import { RISK_ICON, SABOTAGE_STICKER, STAKE_STICKER, sabotageKinds } from '../../play/powers';
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

/** One tick per player at the table, the first `done` filled: a count in seating order, never a name (ATTACK 27). */
function PickTicks({ done, total }: { done: number; total: number }) {
  const { t } = useI18n();
  const count = Math.max(total, done);
  return (
    <div className={styles.pickProgress} data-testid="tv-pick-progress">
      <div className={styles.ticks} aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <span key={index} className={cx(styles.tick, index < done && styles.tickOn)} />
        ))}
      </div>
      <span className={styles.prepReady} data-testid="tv-prep-ready">
        {t('tv.pick.locked', { done, total: count })}
      </span>
    </div>
  );
}

function PickClock({
  now,
  startAt,
  deadlineAt,
}: {
  now: () => number;
  startAt: number;
  deadlineAt: number | null;
}) {
  return deadlineAt !== null ? (
    <div className={styles.pickClock} data-testid="tv-pick-clock">
      <CountdownRing now={now} startAt={startAt} deadlineAt={deadlineAt} size={230} />
    </div>
  ) : null;
}

/**
 * RISK_PICK on the TV (ADR-0022): a loud title, the stake ladder everyone is choosing from, a big
 * countdown and how many players have locked in (never what or who).
 */
export function TvRiskPick({
  data,
  now,
  startAt,
  deadlineAt,
}: {
  data: PhaseDataOf<'RISK_PICK'>;
  now: () => number;
  startAt: number;
  deadlineAt: number | null;
}) {
  const { t, td } = useI18n();
  return (
    <div className={cx(styles.center, styles.pickScreen)} data-testid="tv-risk">
      <div className={cx(styles.pickTitle, styles.pickRisk)} data-testid="tv-pick-title">
        {t('tv.risk.title')}
      </div>
      <div className={styles.pickRule}>{t('tv.risk.rule')}</div>
      <div className={styles.prepPills}>
        <span className={styles.pill}>{data.category.label}</span>
        <span className={styles.pill}>{td(`game.difficulty.${data.difficulty}`)}</span>
        <span className={styles.pill}>{td(`game.kind.${data.round.kind}`)}</span>
      </div>

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
        {/* ADR-0023: the extras on offer this round (config, the same for everybody) */}
        {data.risks?.cover ? (
          <span className={styles.badge} data-testid="tv-extra-cover">
            <PowerIcon id={RISK_ICON.cover} size={44} />
            {t('risk.cover')}
          </span>
        ) : null}
        {data.risks?.duel ? (
          <span className={styles.badge} data-testid="tv-extra-duel">
            <PowerIcon id={RISK_ICON.duel} size={44} />
            {t('risk.duel')}
          </span>
        ) : null}
        {data.risks?.pot ? (
          <span className={styles.badge} data-testid="tv-extra-pot">
            <PowerIcon id={RISK_ICON.pot} size={44} />
            {t('risk.pot')}
          </span>
        ) : null}
      </div>

      <div className={styles.pickFoot}>
        <PickClock now={now} startAt={startAt} deadlineAt={deadlineAt} />
        <PickTicks done={data.committedCount} total={data.eligibleCount} />
      </div>
    </div>
  );
}

/**
 * SABOTAGE_PICK on the TV (ADR-0022). Only a count of players who are done: which of them hit whom,
 * or whether anyone did, stays secret until POWER_RESOLUTION (ATTACK 27).
 */
export function TvSabotagePick({
  data,
  now,
  startAt,
  deadlineAt,
}: {
  data: PhaseDataOf<'SABOTAGE_PICK'>;
  now: () => number;
  startAt: number;
  deadlineAt: number | null;
}) {
  const { t, td } = useI18n();
  return (
    <div className={cx(styles.center, styles.pickScreen)} data-testid="tv-sabotage">
      <div className={cx(styles.pickTitle, styles.pickSabotage)} data-testid="tv-pick-title">
        {t('tv.sabotage.title')}
      </div>
      <div className={styles.pickRule}>{t('tv.sabotage.rule')}</div>
      <div className={styles.prepPills}>
        <span className={styles.pill}>{data.category.label}</span>
        <span className={styles.pill}>{td(`game.kind.${data.round.kind}`)}</span>
      </div>

      <div className={styles.sabRow}>
        <Sticker id="bomb" size={200} className={styles.pop} />
        <div className={styles.sabKinds}>
          {sabotageKinds(data).map((kind) => (
            <span key={kind} className={styles.badge}>
              <PowerIcon id={SABOTAGE_STICKER[kind]} size={44} />
              {td(`sabotage.${kind}`)}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.pickFoot}>
        <PickClock now={now} startAt={startAt} deadlineAt={deadlineAt} />
        <PickTicks done={data.committedCount} total={data.eligibleCount} />
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

/** How long the closed message stays before the TV goes back to its title menu. */
export const CLOSED_RETURN_MS = 4_000;

/**
 * "Room closed". With `onMenu` the TV announces that it is returning to the title menu and does so
 * by itself after `returnAfterMs`; the "Ana menü" button goes at once. Starting a new game cancels
 * the automatic return so it can never tear down the room that is being created.
 */
export function TvClosed({
  message,
  onNew,
  onMenu,
  returnAfterMs = CLOSED_RETURN_MS,
}: {
  message: string;
  onNew: () => void;
  onMenu?: () => void;
  returnAfterMs?: number;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    if (!onMenu || starting) return undefined;
    const timer = window.setTimeout(onMenu, returnAfterMs);
    return () => window.clearTimeout(timer);
  }, [onMenu, starting, returnAfterMs]);
  return (
    <div className={styles.center} data-testid="tv-closed">
      <Sticker id={CLOSE_STICKER} size={200} className={styles.pop} />
      <div className={styles.introTitle}>{t('closed.title')}</div>
      <div className={styles.worth}>{message}</div>
      {onMenu && !starting ? (
        <div className={styles.worth} role="status" data-testid="tv-closed-returning">
          {t('closed.returning')}
        </div>
      ) : null}
      <div className={styles.cta}>
        {onMenu ? (
          <Button ref={ref} size="xl" onClick={onMenu} data-testid="tv-closed-menu">
            {t('closed.mainMenu')}
          </Button>
        ) : null}
        <Button
          ref={onMenu ? undefined : ref}
          size="xl"
          variant={onMenu ? 'violet' : 'gold'}
          onClick={() => {
            setStarting(true);
            onNew();
          }}
          data-testid="tv-closed-new"
        >
          {t('closed.newGame')}
        </Button>
      </div>
    </div>
  );
}
