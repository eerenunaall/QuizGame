import { useRef, useState } from 'react';
import type { PhaseDataOf, RiskTier, RoomView } from '@quizparty/protocol';
import type { ClientRequestError } from '@quizparty/controller-client';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { PowerIcon } from '../ui/PowerIcon';
import { Sticker } from '../ui/Sticker';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/audio';
import { PickHeader, PickTicks } from './PickParts';
import {
  JOKER_STICKER,
  RISK_ICON,
  STAKE_STICKER,
  acceptBlock,
  bigStake,
  coverBlock,
  coverFee,
  defaultStake,
  doubleDownState,
  duelBlock,
  duelRivals,
  potBlock,
  stakeCapOf,
  stakeCapped,
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
  /** Accept or decline a Duel challenge (ADR-0023). Rejects with the server's code. */
  onRespond?: (challengerId: string, accept: boolean) => Promise<void>;
}

/**
 * RISK_PICK on the phone (ADR-0022, ADR-0023): the category is known, the question is not. The stake,
 * Double Down and the extras (Cover, Pot, a Duel challenge) are chosen here and committed together;
 * after that they cannot be changed (ADR-0010). A Duel challenge aimed at this player is answered here
 * too, any time before the phase ends. Sabotage has its own screen afterwards.
 */
export function RiskScreen({ room, data, now, onCommit, onRespond }: Props) {
  const { t, td } = useI18n();
  const you = room.you;
  const committed = you?.commitment ?? null;
  const [stake, setStake] = useState<RiskTier>(() => defaultStake(data));
  const [doubleDown, setDoubleDown] = useState(false);
  const [cover, setCover] = useState(false);
  const [pot, setPot] = useState(false);
  const [rivalId, setRivalId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const board = room.game?.scoreboard ?? [];
  const playerCount = Math.max(board.length, room.players.length);
  const myScore = board.find((entry) => entry.playerId === you?.playerId)?.score ?? 0;
  const rivals = duelRivals(room.players, you?.playerId ?? '');
  const accepted = (you?.duelInvites ?? []).some((invite) => invite.answer === 'ACCEPTED');

  const ddBlock = doubleDownState(data, you);
  // One big gamble per question: Double Down, the top stakes and a Duel exclude each other (ADR-0021, ADR-0023).
  const ddStakeConflict = stakeExcludesDoubleDown(data, stake);
  const ddBase = doubleDown && ddBlock === null && !ddStakeConflict && !accepted;
  const duelReason =
    duelBlock(data, you, { stake, doubleDown: ddBase }, rivals.length, playerCount) ??
    (accepted ? 'BIG_GAMBLE' : null);
  const rival = rivals.find((player) => player.playerId === rivalId);
  const duelOn = rival !== undefined && duelReason === null;
  const ddOn = ddBase && !duelOn;
  const coverReason = coverBlock(data, you, { stake, doubleDown: ddOn });
  const coverOn = cover && coverReason === null;
  const potReason = potBlock(data, you, myScore, playerCount);
  const potOn = pot && potReason === null;
  const bigLocked = duelOn || accepted;

  // The latest choice, read when the button is pressed.
  const latest = useRef<RiskChoice>({ stake, doubleDown: ddOn });
  latest.current = {
    stake,
    doubleDown: ddOn,
    ...(coverOn ? { cover: true } : {}),
    ...(potOn ? { pot: true } : {}),
    ...(duelOn && rival ? { duel: { targetId: rival.playerId } } : {}),
  };

  const send = (): void => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    sfx.play('tap');
    onCommit(latest.current)
      .catch((cause: unknown) => {
        const code = (cause as ClientRequestError | undefined)?.code ?? 'INTERNAL';
        setError(td(`error.${code}`));
      })
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  const respond = (challengerId: string, accept: boolean): void => {
    if (!onRespond) return;
    sfx.play('tap');
    setError(null);
    onRespond(challengerId, accept).catch((cause: unknown) => {
      const code = (cause as ClientRequestError | undefined)?.code ?? 'INTERNAL';
      setError(td(`error.${code}`));
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

  const playerName = (playerId: string): string =>
    room.players.find((player) => player.playerId === playerId)?.nickname ?? '?';

  const inviteBox =
    (you?.duelInvites ?? []).length > 0 && data.risks?.duel ? (
      <div className={styles.invites} data-testid="duel-invites">
        {(you?.duelInvites ?? []).map((invite) => {
          const name = playerName(invite.challengerId);
          const block = acceptBlock(data, you, committed);
          return (
            <div
              key={invite.challengerId}
              className={styles.invite}
              role="group"
              aria-label={t('ctl.duel.invite', { name })}
              data-testid="duel-invite"
              data-answer={invite.answer ?? 'OPEN'}
            >
              <PowerIcon id={RISK_ICON.duel} size={44} />
              <span className={styles.inviteText}>
                <span className={styles.powerName}>{t('ctl.duel.invite', { name })}</span>
                <span className={styles.powerHint}>
                  {invite.answer === 'ACCEPTED'
                    ? t('ctl.duel.accepted')
                    : invite.answer === 'DECLINED'
                      ? t('ctl.duel.declined')
                      : t('ctl.duel.inviteRule', {
                          win: data.risks!.duel!.win,
                          bothRight: data.risks!.duel!.bothRight,
                        })}
                </span>
                {invite.answer === null && block !== null && block !== 'OFF' ? (
                  <span className={cx(styles.powerHint, styles.conflict)}>
                    {td(`risk.block.${block}`)}
                  </span>
                ) : null}
              </span>
              {invite.answer === null ? (
                <span className={styles.inviteBtns}>
                  <Button
                    size="md"
                    disabled={block !== null}
                    onClick={() => respond(invite.challengerId, true)}
                    data-testid="duel-accept"
                  >
                    {t('ctl.duel.accept')}
                  </Button>
                  <Button
                    size="md"
                    variant="ghost"
                    onClick={() => respond(invite.challengerId, false)}
                    data-testid="duel-decline"
                  >
                    {t('ctl.duel.decline')}
                  </Button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    ) : null;

  if (committed) {
    return (
      <div className={styles.screen} data-testid="ctl-risk">
        {header}
        {inviteBox}
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
            {committed.cover ? (
              <span className={styles.chip} data-testid="chip-cover">
                <PowerIcon id={RISK_ICON.cover} size={30} />
                {t('ctl.prep.cover.chip')}
              </span>
            ) : null}
            {committed.pot ? (
              <span className={styles.chip} data-testid="chip-pot">
                <PowerIcon id={RISK_ICON.pot} size={30} />
                {t('ctl.prep.pot.chip')}
              </span>
            ) : null}
            {committed.duel ? (
              <span className={styles.chip} data-testid="chip-duel">
                <PowerIcon id={RISK_ICON.duel} size={30} />
                {t('ctl.prep.duel.chip', { name: playerName(committed.duel.targetId) })}
              </span>
            ) : null}
          </div>
          {error ? (
            <div className={styles.error} role="alert" data-testid="prep-error">
              {error}
            </div>
          ) : null}
          <PickTicks done={data.committedCount} total={data.eligibleCount} />
        </Panel>
      </div>
    );
  }

  const powers = you?.powers ?? null;
  const cap = stakeCapOf(you);
  const risks = data.risks;
  const extraRows = [
    risks?.cover
      ? {
          id: 'cover' as const,
          on: coverOn,
          reason: coverReason,
          left: powers?.cover ?? 0,
          hint: t('risk.cover.hint', { fee: coverFee(data, { stake, doubleDown: ddOn }) }),
          toggle: () => setCover(!cover),
        }
      : null,
    risks?.pot
      ? {
          id: 'pot' as const,
          on: potOn,
          reason: potReason,
          left: powers?.pot ?? 0,
          hint: t('risk.pot.hint', { ante: risks.pot.ante }),
          toggle: () => setPot(!pot),
        }
      : null,
    risks?.duel
      ? {
          id: 'duel' as const,
          on: duelOn,
          reason: duelReason,
          left: powers?.duel ?? 0,
          hint:
            duelOn && rival
              ? t('ctl.duel.rival', { name: rival.nickname })
              : t('risk.duel.hint', { win: risks.duel.win }),
          toggle: () => setPicking(!picking),
        }
      : null,
  ];

  return (
    <div className={styles.screen} data-testid="ctl-risk">
      {header}
      {inviteBox}

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
        {cap ? (
          <div className={styles.capNote} role="status" data-testid="stake-cap-note">
            {t('ctl.prep.stakeCap', { tier: td(`ctl.prep.stake.${cap}`) })}
          </div>
        ) : null}
        <div className={styles.ladder} role="radiogroup" aria-label={t('ctl.prep.title')}>
          {data.riskLadder.map((rung) => {
            const capped = stakeCapped(you, rung.tier);
            const ddBlocked = ddOn && stakeExcludesDoubleDown(data, rung.tier);
            const bigBlocked = bigLocked && bigStake(data, rung.tier);
            const blocked = capped || ddBlocked || bigBlocked;
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
                {capped ? (
                  <span className={cx(styles.rungLoss, styles.conflict)}>
                    {t('ctl.prep.stake.capped')}
                  </span>
                ) : bigBlocked ? (
                  <span className={cx(styles.rungLoss, styles.conflict)}>
                    {t('risk.block.BIG_GAMBLE')}
                  </span>
                ) : ddBlocked ? (
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
          disabled={ddBlock !== null || ddStakeConflict || bigLocked}
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
            <span
              className={cx(styles.powerHint, (ddStakeConflict || bigLocked) && styles.conflict)}
            >
              {ddBlock === 'LOCKED'
                ? t('ctl.prep.locked')
                : ddBlock === 'NONE_LEFT'
                  ? t('ctl.prep.none')
                  : bigLocked
                    ? t('risk.block.BIG_GAMBLE')
                    : ddStakeConflict
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

      {extraRows.map((row) =>
        row ? (
          <button
            key={row.id}
            type="button"
            className={cx(styles.power, row.on && styles.powerOn)}
            aria-pressed={row.on}
            disabled={row.reason !== null}
            onClick={() => {
              sfx.play('tap');
              row.toggle();
            }}
            data-testid={`risk-${row.id}`}
            data-focusable
          >
            <PowerIcon id={RISK_ICON[row.id]} size={44} />
            <span className={styles.powerText}>
              <span className={styles.powerName}>{t(`risk.${row.id}`)}</span>
              <span className={cx(styles.powerHint, row.reason !== null && styles.conflict)}>
                {row.reason !== null
                  ? td(`risk.block.${row.reason}`, { ante: risks?.pot?.ante ?? 0 })
                  : row.hint}
              </span>
            </span>
            <span className={styles.powerCount}>{t('ctl.prep.left', { count: row.left })}</span>
          </button>
        ) : null,
      )}

      {picking && risks?.duel ? (
        <div
          className={styles.rivals}
          role="radiogroup"
          aria-label={t('ctl.duel.pick')}
          data-testid="duel-picker"
        >
          <div className={styles.title}>{t('ctl.duel.pick')}</div>
          <div className={styles.rivalFaces}>
            {rivals.map((player) => (
              <button
                key={player.playerId}
                type="button"
                role="radio"
                aria-checked={rivalId === player.playerId}
                className={cx(styles.rival, rivalId === player.playerId && styles.rivalOn)}
                onClick={() => {
                  sfx.play('tap');
                  setRivalId(player.playerId);
                  setPicking(false);
                }}
                data-testid={`duel-rival-${player.nickname}`}
                data-focusable
              >
                <Avatar avatarId={player.avatarId} size={56} colorSlot={player.colorSlot} />
                <span className={styles.rivalName}>{player.nickname}</span>
              </button>
            ))}
          </div>
          {rivalId ? (
            <Button
              size="md"
              variant="ghost"
              onClick={() => {
                setRivalId(null);
                setPicking(false);
              }}
              data-testid="duel-clear"
            >
              {t('ctl.sabotage.skip')}
            </Button>
          ) : null}
        </div>
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
