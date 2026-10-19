import { useEffect, useRef, useState } from 'react';
import type { PhaseDataOf, RiskTier, RoomView } from '@quizparty/protocol';
import type { ClientRequestError } from '@quizparty/controller-client';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { Sticker } from '../ui/Sticker';
import { TimerBar } from '../ui/TimerBar';
import { Spinner } from '../ui/Spinner';
import { categoryIcon } from '../lib/assets';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/audio';
import { SabotageSheet } from './SabotageSheet';
import {
  JOKER_STICKER,
  SABOTAGE_STICKER,
  STAKE_STICKER,
  defaultStake,
  doubleDownState,
  sabotageState,
  sabotageTargets,
  stakeExcludesDoubleDown,
  type PrepChoice,
} from './powers';
import styles from './PrepScreen.module.css';
import { cx } from '../lib/cx';

type PrepData = PhaseDataOf<'QUESTION_PREP'>;

interface Props {
  room: RoomView;
  data: PrepData;
  now: () => number;
  onCommit: (choice: PrepChoice) => Promise<void>;
}

/** How long a sabotage can still be taken back before it goes out (the server's commit is final). */
export const SABOTAGE_UNDO_MS = 2000;
/** With less than this left of the prep window the sabotage goes out at once: an undo would eat the commit. */
const UNDO_MIN_REMAINING_MS = SABOTAGE_UNDO_MS + 1200;
/** Refusals that mean "this sabotage cannot go", not "something else is wrong". */
const SABOTAGE_REFUSALS = new Set(['SABOTAGE_LIMIT', 'TARGET_INVALID', 'POWER_UNAVAILABLE']);

/**
 * QUESTION_PREP on the phone: the category is known, the question is not. Stake, Double Down and one
 * sabotage are chosen here and committed together; after that they cannot be changed (ADR-0010).
 */
export function PrepScreen({ room, data, now, onCommit }: Props) {
  const { t, td } = useI18n();
  const you = room.you;
  const committed = you?.commitment ?? null;
  const [stake, setStake] = useState<RiskTier>(() => defaultStake(data));
  const [doubleDown, setDoubleDown] = useState(false);
  const [sabotage, setSabotage] = useState<PrepChoice['sabotage']>(null);
  const [sheet, setSheet] = useState(false);
  // The sabotage was confirmed and is about to go out; "undo" is possible until it does.
  const [undoable, setUndoable] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const ddBlock = doubleDownState(data, you);
  const sabBlock = sabotageState(data, you);
  // One big gamble per question: Double Down and the top stakes exclude each other (ADR-0021).
  const ddConflict = stakeExcludesDoubleDown(data, stake);
  const ddOn = doubleDown && ddBlock === null && !ddConflict;
  const playersById = new Map(room.players.map((player) => [player.playerId, player]));

  // The latest choice, for the timer that sends a sabotage after its undo window.
  const latest = useRef({ stake, ddOn, sabotage });
  latest.current = { stake, ddOn, sabotage };

  const send = (withSabotage: PrepChoice['sabotage']): void => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setUndoable(false);
    setError(null);
    sfx.play('tap');
    onCommit({
      stake: latest.current.stake,
      doubleDown: latest.current.ddOn,
      sabotage: withSabotage,
    })
      .catch((cause: unknown) => {
        const code = (cause as ClientRequestError | undefined)?.code ?? 'INTERNAL';
        // A refused sabotage must not hold the rest of the prep hostage: drop it, keep the rest.
        if (withSabotage && SABOTAGE_REFUSALS.has(code)) {
          setSabotage(null);
          if (code === 'SABOTAGE_LIMIT') setCoolingDown(true);
        }
        setError(td(`error.${code}`));
      })
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  // The undo window: the sabotage goes out by itself once it is over.
  useEffect(() => {
    if (!undoable) return undefined;
    const timer = window.setTimeout(() => send(latest.current.sabotage), SABOTAGE_UNDO_MS);
    return () => window.clearTimeout(timer);
    // `send` only reads refs and stable setters; the timer must restart only with the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoable]);

  const confirmSabotage = (choice: NonNullable<PrepChoice['sabotage']>): void => {
    setSabotage(choice);
    setSheet(false);
    latest.current = { ...latest.current, sabotage: choice };
    const remaining = room.phaseDeadlineAt === null ? Infinity : room.phaseDeadlineAt - now();
    if (remaining < UNDO_MIN_REMAINING_MS) send(choice);
    else setUndoable(true);
  };

  const undoSabotage = (): void => {
    setUndoable(false);
    setSabotage(null);
  };

  const stakeSummary = `${td(`ctl.prep.stake.${stake}`)}${ddOn ? ` + ${td('joker.DOUBLE_DOWN')}` : ''}`;

  const header = (
    <div className={styles.head}>
      <Sticker id={categoryIcon(data.category.id)} size={60} />
      <div className={styles.headText}>
        <div className={styles.kicker}>
          {t('game.round.of', { n: data.round.index + 1, total: data.round.total })} ·{' '}
          {td(`game.kind.${data.round.kind}`)}
        </div>
        <div className={styles.category}>{data.category.label}</div>
      </div>
      <div className={styles.difficulty}>{td(`game.difficulty.${data.difficulty}`)}</div>
    </div>
  );

  const timer =
    room.phaseDeadlineAt !== null ? (
      <div className={styles.timer}>
        <TimerBar
          size="lg"
          now={now}
          startAt={room.phaseEnteredAt}
          deadlineAt={room.phaseDeadlineAt}
        />
      </div>
    ) : null;

  if (committed) {
    const target = committed.sabotage ? playersById.get(committed.sabotage.targetId) : undefined;
    return (
      <div className={styles.screen} data-testid="ctl-prep">
        {header}
        {timer}
        <Panel className={styles.done} tone="glass" data-testid="ctl-prep-committed">
          <Sticker id="check" size={84} className={styles.doneIcon} />
          <div className={styles.doneTitle}>{t('ctl.prep.committed')}</div>
          <div className={styles.chips}>
            <span className={styles.chip}>
              <Sticker id={STAKE_STICKER[committed.stake]} size={30} />
              {td(`ctl.prep.stake.${committed.stake}`)}
            </span>
            {committed.doubleDown ? (
              <span className={styles.chip}>
                <Sticker id={JOKER_STICKER.DOUBLE_DOWN} size={30} />
                {td('joker.DOUBLE_DOWN')}
              </span>
            ) : null}
            {committed.sabotage && target ? (
              <span className={styles.chip}>
                <Sticker id={SABOTAGE_STICKER[committed.sabotage.effect]} size={30} />
                {t('ctl.prep.sabotageTo', {
                  effect: td(`sabotage.${committed.sabotage.effect}`),
                  name: target.nickname,
                })}
              </span>
            ) : null}
          </div>
          <div className={styles.waiting}>
            <Spinner size={22} />
            <span>
              {t('ctl.prep.waiting', {
                done: data.committedCount,
                total: Math.max(data.eligibleCount, data.committedCount),
              })}
            </span>
          </div>
        </Panel>
      </div>
    );
  }

  const chosenTarget = sabotage ? playersById.get(sabotage.targetId) : undefined;
  const powers = you?.powers ?? null;
  // Why the sabotage chip is grey, in one line (the server stays the judge of the rest).
  const sabotageWhy =
    sabBlock === 'CLOSED'
      ? data.round.kind === 'FINAL'
        ? t('ctl.prep.sabotage.final')
        : t('ctl.prep.sabotage.closed')
      : sabBlock === 'NO_TOKEN'
        ? powers?.nextTokenAtStreak
          ? t('ctl.prep.sabotage.noToken', { streak: powers.nextTokenAtStreak })
          : t('ctl.prep.sabotage.noTokenLeft')
        : coolingDown
          ? t('ctl.prep.sabotage.cooldown')
          : null;
  const sabotageOff = sabotageWhy !== null;

  return (
    <div className={styles.screen} data-testid="ctl-prep">
      {header}
      {timer}

      <div className={styles.section}>
        <div className={styles.titleRow}>
          <div className={styles.title}>{t('ctl.prep.title')}</div>
          {powers ? (
            <div className={styles.stock} data-testid="prep-stock">
              <span className={styles.stockItem}>
                <Sticker id={JOKER_STICKER.FIFTY_FIFTY} size={22} />
                {td('joker.FIFTY_FIFTY')} ×{powers.fiftyFifty}
              </span>
              <span className={styles.stockItem}>
                <Sticker id="shield" size={22} />
                {t('ctl.power.shield')} ×{powers.shield}
              </span>
            </div>
          ) : null}
        </div>
        {data.stakeMandatory ? (
          <div className={styles.mandatory}>{t('ctl.prep.mandatory')}</div>
        ) : null}
        <div className={styles.ladder} role="radiogroup" aria-label={t('ctl.prep.title')}>
          {data.riskLadder.map((rung) => {
            const blocked =
              doubleDown && ddBlock === null && stakeExcludesDoubleDown(data, rung.tier);
            return (
              <button
                key={rung.tier}
                type="button"
                role="radio"
                aria-checked={stake === rung.tier}
                disabled={blocked}
                className={cx(
                  styles.rung,
                  styles[`rung${rung.tier}`],
                  stake === rung.tier && styles.picked,
                )}
                onClick={() => {
                  sfx.play('tap');
                  setStake(rung.tier);
                }}
                data-testid={`stake-${rung.tier}`}
                data-focusable
              >
                <Sticker id={STAKE_STICKER[rung.tier]} size={40} />
                <span className={styles.rungName}>{td(`ctl.prep.stake.${rung.tier}`)}</span>
                <span className={styles.rungMult}>×{rung.multiplier}</span>
                <span className={styles.rungLoss}>
                  {rung.loss > 0
                    ? t('ctl.prep.stake.loss', { loss: rung.loss })
                    : t('ctl.prep.stake.noLoss')}
                </span>
                {blocked ? (
                  <span className={cx(styles.rungLoss, styles.conflict)}>
                    {t('ctl.prep.stake.conflict')}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {data.doubleDownEnabled ? (
        <button
          type="button"
          className={cx(styles.power, ddOn && styles.powerOn)}
          aria-pressed={ddOn}
          disabled={ddBlock !== null || ddConflict}
          onClick={() => {
            sfx.play('tap');
            setDoubleDown(!doubleDown);
          }}
          data-testid="prep-double-down"
          data-focusable
        >
          <Sticker id={JOKER_STICKER.DOUBLE_DOWN} size={44} />
          <span className={styles.powerText}>
            <span className={styles.powerName}>{td('joker.DOUBLE_DOWN')}</span>
            <span className={cx(styles.powerHint, ddConflict && styles.conflict)}>
              {ddBlock === 'LOCKED'
                ? t('ctl.prep.locked')
                : ddBlock === 'NONE_LEFT'
                  ? t('ctl.prep.none')
                  : ddConflict
                    ? t('ctl.prep.doubleDown.conflict')
                    : t('ctl.prep.doubleDown.hint')}
            </span>
          </span>
          <span className={styles.powerCount}>
            {ddBlock === 'LOCKED' ? (
              <Sticker id="lock" size={30} />
            ) : (
              t('ctl.prep.left', { count: powers?.doubleDown ?? 0 })
            )}
          </span>
        </button>
      ) : null}

      {undoable && sabotage && chosenTarget ? (
        <div className={styles.going} role="status" data-testid="sabotage-going">
          <Sticker id={SABOTAGE_STICKER[sabotage.effect]} size={40} />
          <span className={styles.goingText}>
            {t('ctl.prep.sabotage.going', {
              effect: td(`sabotage.${sabotage.effect}`),
              name: chosenTarget.nickname,
            })}
          </span>
          <Button
            size="md"
            variant="ghost"
            onClick={undoSabotage}
            className={styles.undo}
            data-testid="sabotage-undo"
          >
            {t('ctl.prep.sabotage.undo')}
          </Button>
          <span
            className={styles.goingBar}
            style={{ animationDuration: `${SABOTAGE_UNDO_MS}ms` }}
            aria-hidden="true"
          />
        </div>
      ) : (
        <button
          type="button"
          className={cx(styles.sab, sabotage && styles.sabArmed, sabotageOff && styles.sabOff)}
          disabled={sabotageOff}
          onClick={() => {
            sfx.play('tap');
            setSheet(true);
          }}
          data-testid="prep-sabotage"
          data-focusable
        >
          <Sticker id="bomb" size={40} />
          <span className={styles.powerText}>
            <span className={styles.powerName}>{t('ctl.prep.sabotage')}</span>
            <span className={cx(styles.powerHint, sabotageOff && styles.why)}>
              {sabotage && chosenTarget
                ? t('ctl.prep.sabotageTo', {
                    effect: td(`sabotage.${sabotage.effect}`),
                    name: chosenTarget.nickname,
                  })
                : (sabotageWhy ?? t('ctl.prep.sabotage.hint'))}
            </span>
          </span>
          {sabBlock !== 'CLOSED' ? (
            <span className={styles.tokens}>
              {t('ctl.prep.sabotage.tokens', { count: powers?.sabotageTokens ?? 0 })}
            </span>
          ) : (
            <Sticker id="lock" size={28} />
          )}
        </button>
      )}

      {error ? (
        <div className={styles.error} role="alert" data-testid="prep-error">
          {error}
        </div>
      ) : null}

      <div className={styles.footer}>
        <Button
          size="xl"
          block
          busy={sending}
          onClick={() => send(latest.current.sabotage)}
          icon="rocket"
          data-testid="prep-ready"
        >
          {sending ? t('ctl.prep.sending') : t('ctl.prep.ready')}
        </Button>
      </div>

      {sheet ? (
        <SabotageSheet
          players={sabotageTargets(room.players, you?.playerId ?? '')}
          current={sabotage}
          recap={stakeSummary}
          onClose={() => setSheet(false)}
          onConfirm={confirmSabotage}
          onRemove={() => {
            setSabotage(null);
            setSheet(false);
          }}
        />
      ) : null}
    </div>
  );
}
