import { useRef, useState } from 'react';
import type { PhaseDataOf, RiskTier, RoomView } from '@quizparty/protocol';
import type { ClientRequestError } from '@quizparty/controller-client';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { Sticker } from '../ui/Sticker';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/audio';
import { PickHeader, PickTicks } from './PickParts';
import {
  JOKER_STICKER,
  STAKE_STICKER,
  defaultStake,
  doubleDownState,
  stakeExcludesDoubleDown,
  type RiskChoice,
} from './powers';
import styles from './PickScreen.module.css';
import { cx } from '../lib/cx';

type RiskData = PhaseDataOf<'RISK_PICK'>;

interface Props {
  room: RoomView;
  data: RiskData;
  now: () => number;
  onCommit: (choice: RiskChoice) => Promise<void>;
}

/**
 * RISK_PICK on the phone (ADR-0022): the category is known, the question is not. The stake and
 * Double Down are chosen here and committed together; after that they cannot be changed (ADR-0010).
 * Sabotage has its own screen afterwards.
 */
export function RiskScreen({ room, data, now, onCommit }: Props) {
  const { t, td } = useI18n();
  const you = room.you;
  const committed = you?.commitment ?? null;
  const [stake, setStake] = useState<RiskTier>(() => defaultStake(data));
  const [doubleDown, setDoubleDown] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const ddBlock = doubleDownState(data, you);
  // One big gamble per question: Double Down and the top stakes exclude each other (ADR-0021).
  const ddConflict = stakeExcludesDoubleDown(data, stake);
  const ddOn = doubleDown && ddBlock === null && !ddConflict;

  // The latest choice, read when the button is pressed.
  const latest = useRef({ stake, ddOn });
  latest.current = { stake, ddOn };

  const send = (): void => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    sfx.play('tap');
    onCommit({ stake: latest.current.stake, doubleDown: latest.current.ddOn })
      .catch((cause: unknown) => {
        const code = (cause as ClientRequestError | undefined)?.code ?? 'INTERNAL';
        setError(td(`error.${code}`));
      })
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  const header = (
    <PickHeader
      room={room}
      data={data}
      now={now}
      title={t('tv.risk.title')}
      rule={t('ctl.risk.rule')}
      kind="risk"
    />
  );

  if (committed) {
    return (
      <div className={styles.screen} data-testid="ctl-risk">
        {header}
        <Panel className={styles.done} tone="glass" data-testid="ctl-risk-committed">
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
          </div>
          <PickTicks done={data.committedCount} total={data.eligibleCount} />
        </Panel>
      </div>
    );
  }

  const powers = you?.powers ?? null;

  return (
    <div className={styles.screen} data-testid="ctl-risk">
      {header}

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
          onClick={send}
          icon="rocket"
          data-testid="prep-ready"
        >
          {sending ? t('ctl.prep.sending') : t('ctl.prep.ready')}
        </Button>
      </div>
    </div>
  );
}
