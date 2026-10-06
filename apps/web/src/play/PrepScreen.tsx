import { useEffect, useRef, useState } from 'react';
import type { Joker, PhaseDataOf, RiskTier, RoomView, SabotageKind } from '@quizparty/protocol';
import type { ClientRequestError } from '@quizparty/controller-client';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { Sticker } from '../ui/Sticker';
import { TimerBar } from '../ui/TimerBar';
import { Spinner } from '../ui/Spinner';
import { categoryIcon } from '../lib/assets';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/audio';
import {
  JOKER_ORDER,
  JOKER_STICKER,
  SABOTAGE_ORDER,
  SABOTAGE_STICKER,
  STAKE_STICKER,
  defaultStake,
  doubleDownState,
  sabotageState,
  sabotageTargets,
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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ddBlock = doubleDownState(data, you);
  const sabBlock = sabotageState(data, you);
  const playersById = new Map(room.players.map((player) => [player.playerId, player]));

  const commit = (): void => {
    if (sending) return;
    setSending(true);
    setError(null);
    sfx.play('tap');
    onCommit({ stake, doubleDown: doubleDown && ddBlock === null, sabotage })
      .catch((cause: unknown) => {
        const code = (cause as ClientRequestError | undefined)?.code ?? 'INTERNAL';
        setError(td(`error.${code}`));
      })
      .finally(() => setSending(false));
  };

  const header = (
    <div className={styles.head}>
      <Sticker id={categoryIcon(data.category.id)} size={72} />
      <div>
        <div className={styles.kicker}>
          {t('game.round.of', { n: data.round.index + 1, total: data.round.total })} ·{' '}
          {td(`game.kind.${data.round.kind}`)}
        </div>
        <div className={styles.category}>{data.category.label}</div>
        <div className={styles.difficulty}>{td(`game.difficulty.${data.difficulty}`)}</div>
      </div>
    </div>
  );

  const timer =
    room.phaseDeadlineAt !== null ? (
      <div className={styles.timer}>
        <TimerBar now={now} startAt={room.phaseEnteredAt} deadlineAt={room.phaseDeadlineAt} />
      </div>
    ) : null;

  if (committed) {
    const target = committed.sabotage ? playersById.get(committed.sabotage.targetId) : undefined;
    return (
      <div className={styles.screen} data-testid="ctl-prep">
        {header}
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
        {timer}
      </div>
    );
  }

  const chosenTarget = sabotage ? playersById.get(sabotage.targetId) : undefined;

  return (
    <div className={styles.screen} data-testid="ctl-prep">
      {header}

      <div className={styles.section}>
        <div className={styles.title}>{t('ctl.prep.title')}</div>
        {data.stakeMandatory ? (
          <div className={styles.mandatory}>{t('ctl.prep.mandatory')}</div>
        ) : null}
        <div className={styles.ladder} role="radiogroup" aria-label={t('ctl.prep.title')}>
          {data.riskLadder.map((rung) => (
            <button
              key={rung.tier}
              type="button"
              role="radio"
              aria-checked={stake === rung.tier}
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
              <Sticker id={STAKE_STICKER[rung.tier]} size={44} />
              <span className={styles.rungName}>{td(`ctl.prep.stake.${rung.tier}`)}</span>
              <span className={styles.rungMult}>×{rung.multiplier}</span>
              <span className={styles.rungLoss}>
                {rung.loss > 0
                  ? t('ctl.prep.stake.loss', { loss: rung.loss })
                  : t('ctl.prep.stake.noLoss')}
              </span>
            </button>
          ))}
        </div>
      </div>

      {data.doubleDownEnabled ? (
        <button
          type="button"
          className={cx(styles.power, doubleDown && ddBlock === null && styles.powerOn)}
          aria-pressed={doubleDown && ddBlock === null}
          disabled={ddBlock !== null}
          onClick={() => {
            sfx.play('tap');
            setDoubleDown(!doubleDown);
          }}
          data-testid="prep-double-down"
          data-focusable
        >
          <Sticker id={JOKER_STICKER.DOUBLE_DOWN} size={46} />
          <span className={styles.powerText}>
            <span className={styles.powerName}>{td('joker.DOUBLE_DOWN')}</span>
            <span className={styles.powerHint}>
              {ddBlock === 'LOCKED'
                ? t('ctl.prep.locked')
                : ddBlock === 'NONE_LEFT'
                  ? t('ctl.prep.none')
                  : t('ctl.prep.doubleDown.hint')}
            </span>
          </span>
          <span className={styles.powerCount}>
            {ddBlock === 'LOCKED' ? (
              <Sticker id="lock" size={30} />
            ) : (
              t('ctl.prep.left', { count: you?.powers?.doubleDown ?? 0 })
            )}
          </span>
        </button>
      ) : null}

      {data.sabotageEnabled ? (
        <button
          type="button"
          className={cx(styles.power, sabotage && styles.powerOn)}
          disabled={sabBlock !== null}
          onClick={() => {
            sfx.play('tap');
            setSheet(true);
          }}
          data-testid="prep-sabotage"
          data-focusable
        >
          <Sticker id="bomb" size={46} />
          <span className={styles.powerText}>
            <span className={styles.powerName}>{t('ctl.prep.sabotage')}</span>
            <span className={styles.powerHint}>
              {sabotage && chosenTarget
                ? t('ctl.prep.sabotageTo', {
                    effect: td(`sabotage.${sabotage.effect}`),
                    name: chosenTarget.nickname,
                  })
                : sabBlock === 'NO_TOKEN'
                  ? you?.powers?.nextTokenAtStreak
                    ? t('ctl.prep.sabotage.noToken', { streak: you.powers.nextTokenAtStreak })
                    : t('ctl.prep.sabotage.noTokenLeft')
                  : t('ctl.prep.sabotage.hint')}
            </span>
          </span>
          <span className={styles.powerCount}>
            {t('ctl.prep.sabotage.tokens', { count: you?.powers?.sabotageTokens ?? 0 })}
          </span>
        </button>
      ) : null}

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
          onClick={commit}
          icon="rocket"
          data-testid="prep-ready"
        >
          {sending ? t('ctl.prep.sending') : t('ctl.prep.ready')}
        </Button>
        {timer}
      </div>

      {sheet ? (
        <SabotageSheet
          players={sabotageTargets(room.players, you?.playerId ?? '')}
          current={sabotage}
          onClose={() => setSheet(false)}
          onPick={(choice) => {
            setSabotage(choice);
            setSheet(false);
          }}
        />
      ) : null}
    </div>
  );
}

type Step = 'who' | 'what' | 'which';

function SabotageSheet({
  players,
  current,
  onPick,
  onClose,
}: {
  players: RoomView['players'];
  current: PrepChoice['sabotage'];
  onPick: (choice: PrepChoice['sabotage']) => void;
  onClose: () => void;
}) {
  const { t, td } = useI18n();
  const [step, setStep] = useState<Step>('who');
  const [targetId, setTargetId] = useState<string | null>(current?.targetId ?? null);
  const [effect, setEffect] = useState<SabotageKind | null>(current?.effect ?? null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, [step]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const finish = (joker?: Joker): void => {
    if (!targetId || !effect) return;
    onPick({ targetId, effect, ...(joker ? { joker } : {}) });
  };

  return (
    <div className={styles.scrim} onClick={onClose} role="presentation">
      <Panel
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        data-testid="sabotage-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.sheetTitle}>
          {step === 'who'
            ? t('ctl.prep.sabotage.who')
            : step === 'what'
              ? t('ctl.prep.sabotage.what')
              : t('ctl.prep.sabotage.which')}
        </div>

        {step === 'who' ? (
          <div className={styles.list}>
            {players.map((player, index) => (
              <button
                key={player.playerId}
                ref={index === 0 ? firstRef : undefined}
                type="button"
                className={styles.row}
                onClick={() => {
                  setTargetId(player.playerId);
                  setStep('what');
                }}
                data-testid={`sabotage-target-${player.nickname}`}
              >
                <Avatar avatarId={player.avatarId} size={46} colorSlot={player.colorSlot} />
                <span className={styles.rowName}>{player.nickname}</span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 'what' ? (
          <div className={styles.list}>
            {SABOTAGE_ORDER.map((kind, index) => (
              <button
                key={kind}
                ref={index === 0 ? firstRef : undefined}
                type="button"
                className={styles.row}
                onClick={() => {
                  setEffect(kind);
                  if (kind === 'LOCKOUT') setStep('which');
                  else if (targetId) onPick({ targetId, effect: kind });
                }}
                data-testid={`sabotage-effect-${kind}`}
              >
                <Sticker id={SABOTAGE_STICKER[kind]} size={44} />
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{td(`sabotage.${kind}`)}</span>
                  <span className={styles.rowHint}>{td(`sabotage.${kind}.desc`)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 'which' ? (
          <div className={styles.list}>
            {JOKER_ORDER.map((joker, index) => (
              <button
                key={joker}
                ref={index === 0 ? firstRef : undefined}
                type="button"
                className={styles.row}
                onClick={() => finish(joker)}
                data-testid={`sabotage-joker-${joker}`}
              >
                <Sticker id={JOKER_STICKER[joker]} size={44} />
                <span className={styles.rowName}>{td(`joker.${joker}`)}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className={styles.sheetActions}>
          {current ? (
            <Button
              size="md"
              variant="danger"
              onClick={() => onPick(null)}
              data-testid="sabotage-remove"
            >
              {t('ctl.prep.sabotage.remove')}
            </Button>
          ) : null}
          <Button size="md" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
