import { useEffect } from 'react';
import type { Outcome, PhaseDataOf, PowerResolutionItem, RoomView } from '@quizparty/protocol';
import { Avatar } from '../../ui/Avatar';
import { PowerIcon } from '../../ui/PowerIcon';
import { Sticker } from '../../ui/Sticker';
import { hitSoundFor, sfx, type SoundName } from '../../lib/audio';
import { useI18n } from '../../lib/i18n';
import { JOKER_STICKER, RISK_ICON, SABOTAGE_STICKER, STAKE_STICKER } from '../../play/powers';
import styles from './TvPower.module.css';
import { cx } from '../../lib/cx';

type PowerData = PhaseDataOf<'POWER_RESOLUTION'>;

const STEP_MS = 650;

/** Items revealed one after another; the sounds follow the same beat. */
export function itemDelay(index: number): number {
  return 350 + index * STEP_MS;
}

/** The cue of one resolved power: each lifeline and each sabotage kind has its own, all from one family. */
export function powerSound(item: PowerResolutionItem): SoundName {
  switch (item.kind) {
    case 'SABOTAGE':
      return item.blocked ? 'shield' : hitSoundFor(item.effect);
    case 'CUT':
      return 'hitCut';
    case 'FIFTY_FIFTY':
      return 'fifty';
    case 'DOUBLE_DOWN':
      return 'doubleDown';
    case 'STAKE':
    case 'COVER':
    case 'DUEL':
    case 'POT':
      return 'power';
  }
}

/** Cards with two or more faces take a whole row; the rest share a row two by two (TvPower.module.css). */
const WIDE_KINDS: ReadonlySet<PowerResolutionItem['kind']> = new Set([
  'SABOTAGE',
  'POT',
  'DUEL',
  'CUT',
]);
const ROW_PX = 172; // card 150 + margin 22
const GRID_PX = 760;
const MIN_GRID_SCALE = 0.45;

/**
 * How much the card grid shrinks so every row fits under the title. Eight players that all gamble
 * need more than the four rows the roomy layout holds; shrinking keeps every card visible instead
 * of letting the first row slide under the title and the last off the stage.
 */
export function powerGridScale(items: readonly PowerResolutionItem[]): number {
  let rows = 0;
  let halfOpen = false;
  for (const item of items) {
    if (WIDE_KINDS.has(item.kind)) {
      rows += 1;
      halfOpen = false;
    } else if (halfOpen) {
      halfOpen = false;
    } else {
      rows += 1;
      halfOpen = true;
    }
  }
  const natural = rows * ROW_PX;
  return natural <= GRID_PX ? 1 : Math.max(MIN_GRID_SCALE, GRID_PX / natural);
}

function OutcomePill({ outcome }: { outcome: Outcome }) {
  const { t } = useI18n();
  return (
    <span className={cx(styles.outcome, styles[`outcome${outcome}`])}>
      {outcome === 'CORRECT'
        ? t('tv.power.right')
        : outcome === 'INCORRECT'
          ? t('tv.power.wrong')
          : t('tv.power.none')}
    </span>
  );
}

/**
 * POWER_RESOLUTION: after the answer is out, everyone sees who took a stake, doubled down, used 50/50
 * or sabotaged someone, and how it went. This is the first time any of it is public.
 */
export function TvPowerResolution({ room, data }: { room: RoomView; data: PowerData }) {
  const { t, td } = useI18n();
  const players = new Map(room.players.map((player) => [player.playerId, player]));

  useEffect(() => {
    const timers = data.items.map((item, index) =>
      window.setTimeout(() => sfx.play(powerSound(item)), itemDelay(index)),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [data.items]);

  const nameOf = (playerId: string): string => players.get(playerId)?.nickname ?? '?';
  const face = (playerId: string, size = 96) => {
    const player = players.get(playerId);
    return player ? (
      <Avatar avatarId={player.avatarId} size={size} colorSlot={player.colorSlot} />
    ) : null;
  };

  const card = (item: PowerResolutionItem, index: number) => {
    const style = { ['--qp-delay' as string]: `${itemDelay(index)}ms` };
    switch (item.kind) {
      case 'STAKE':
        return (
          <div
            key={`${item.kind}-${item.playerId}`}
            className={cx(styles.card, styles[`stake${item.tier}`])}
            style={style}
            data-testid="power-item"
            data-kind="STAKE"
          >
            {face(item.playerId)}
            <Sticker id={STAKE_STICKER[item.tier]} size={72} className={styles.icon} />
            <span className={styles.text}>
              {t('tv.power.stake', {
                name: nameOf(item.playerId),
                tier: td(`ctl.prep.stake.${item.tier}`),
              })}
            </span>
            <OutcomePill outcome={item.outcome} />
          </div>
        );
      case 'DOUBLE_DOWN':
        return (
          <div
            key={`${item.kind}-${item.playerId}`}
            className={cx(styles.card, styles.double)}
            style={style}
            data-testid="power-item"
            data-kind="DOUBLE_DOWN"
          >
            {face(item.playerId)}
            <Sticker id={JOKER_STICKER.DOUBLE_DOWN} size={72} className={styles.icon} />
            <span className={styles.text}>
              {t('tv.power.double', { name: nameOf(item.playerId) })}
            </span>
            <OutcomePill outcome={item.outcome} />
          </div>
        );
      case 'FIFTY_FIFTY':
        return (
          <div
            key={`${item.kind}-${item.playerId}`}
            className={cx(styles.card, styles.fifty)}
            style={style}
            data-testid="power-item"
            data-kind="FIFTY_FIFTY"
          >
            {face(item.playerId)}
            <Sticker id={JOKER_STICKER.FIFTY_FIFTY} size={72} className={styles.icon} />
            <span className={styles.text}>
              {t('tv.power.fifty', { name: nameOf(item.playerId) })}
            </span>
            <OutcomePill outcome={item.outcome} />
          </div>
        );
      case 'COVER':
        return (
          <div
            key={`${item.kind}-${item.playerId}`}
            className={cx(styles.card, styles.cover)}
            style={style}
            data-testid="power-item"
            data-kind="COVER"
          >
            {face(item.playerId)}
            <PowerIcon id={RISK_ICON.cover} size={72} className={styles.icon} />
            <span className={styles.text}>
              {t('tv.power.cover', { name: nameOf(item.playerId), fee: item.fee })}
              <span className={styles.sub}>
                {item.saved > 0
                  ? t('tv.power.cover.saved', { saved: item.saved })
                  : t('tv.power.cover.paid')}
              </span>
            </span>
            <OutcomePill outcome={item.outcome} />
          </div>
        );
      case 'POT':
        return (
          <div
            key={`${item.kind}-pot`}
            className={cx(styles.card, styles.pot)}
            style={style}
            data-testid="power-item"
            data-kind="POT"
            data-refunded={item.refunded}
          >
            <span className={styles.faces}>
              {item.playerIds.map((playerId) => (
                <span key={playerId} className={styles.miniFace}>
                  {face(playerId, 64)}
                </span>
              ))}
            </span>
            <PowerIcon id={RISK_ICON.pot} size={72} className={styles.icon} />
            <span className={styles.text}>
              {t('tv.power.pot', { size: item.size, count: item.playerIds.length })}
              <span className={styles.sub}>
                {item.refunded
                  ? t('tv.power.pot.refunded')
                  : t('tv.power.pot.winners', {
                      names: item.winnerIds.map((playerId) => nameOf(playerId)).join(', '),
                    })}
              </span>
            </span>
          </div>
        );
      case 'DUEL':
        return (
          <div
            key={`${item.kind}-${item.challengerId}-${item.rivalId}`}
            className={cx(styles.card, styles.duel)}
            style={style}
            data-testid="power-item"
            data-kind="DUEL"
            data-accepted={item.accepted}
          >
            {face(item.challengerId, 84)}
            <PowerIcon id={RISK_ICON.duel} size={64} className={cx(styles.icon, styles.arrow)} />
            {face(item.rivalId, 84)}
            <span className={styles.text}>
              {!item.accepted
                ? t('tv.power.duel.declined', { rival: nameOf(item.rivalId) })
                : item.winnerId
                  ? t('tv.power.duel.won', { name: nameOf(item.winnerId), points: item.points })
                  : t('tv.power.duel.none')}
              <span className={styles.sub}>
                {t('tv.power.duel', {
                  challenger: nameOf(item.challengerId),
                  rival: nameOf(item.rivalId),
                })}
              </span>
            </span>
            {item.accepted && item.winnerId ? (
              <span className={cx(styles.outcome, styles.hitPill)}>+{item.points}</span>
            ) : null}
          </div>
        );
      case 'CUT':
        return (
          <div
            key={`${item.kind}-${item.actorId}-${item.targetId}`}
            className={cx(styles.card, styles.cutPaid)}
            style={style}
            data-testid="power-item"
            data-kind="CUT"
          >
            {face(item.targetId, 84)}
            <PowerIcon
              id={SABOTAGE_STICKER.CUT}
              size={64}
              className={cx(styles.icon, styles.arrow)}
            />
            {face(item.actorId, 84)}
            <span className={styles.text}>
              {t('tv.power.cut', {
                actor: nameOf(item.actorId),
                target: nameOf(item.targetId),
                points: item.points,
              })}
            </span>
            <span className={cx(styles.outcome, styles.hitPill)}>+{item.points}</span>
          </div>
        );
      case 'SABOTAGE':
        return (
          <div
            key={`${item.kind}-${item.actorId}-${item.targetId}`}
            className={cx(styles.card, item.blocked ? styles.blocked : styles.sabotage)}
            style={style}
            data-testid="power-item"
            data-kind="SABOTAGE"
            data-blocked={item.blocked}
          >
            {face(item.actorId, 84)}
            <PowerIcon
              id={SABOTAGE_STICKER[item.effect]}
              size={64}
              className={cx(styles.icon, styles.arrow)}
            />
            {face(item.targetId, 84)}
            <span className={styles.text}>
              {td(`sabotage.${item.effect}`)}
              <span className={styles.sub}>
                {t('tv.power.sabotage', {
                  actor: nameOf(item.actorId),
                  target: nameOf(item.targetId),
                })}
              </span>
            </span>
            <span className={cx(styles.outcome, item.blocked ? styles.shield : styles.hitPill)}>
              {item.blocked ? (
                <>
                  <Sticker id="shield" size={40} /> {t('tv.power.blocked')}
                </>
              ) : (
                t('tv.power.hit')
              )}
            </span>
          </div>
        );
    }
  };

  const scale = powerGridScale(data.items);
  return (
    <div className={styles.screen} data-testid="tv-power">
      <h1 className={styles.title}>{t('tv.power.title')}</h1>
      <div
        className={styles.grid}
        style={scale < 1 ? { transform: `scale(${scale.toFixed(3)})` } : undefined}
      >
        {data.items.map(card)}
      </div>
    </div>
  );
}
