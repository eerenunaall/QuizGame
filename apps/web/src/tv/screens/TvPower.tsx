import { useEffect } from 'react';
import type { Outcome, PhaseDataOf, PowerResolutionItem, RoomView } from '@quizparty/protocol';
import { Avatar } from '../../ui/Avatar';
import { Sticker } from '../../ui/Sticker';
import { sfx } from '../../lib/audio';
import { useI18n } from '../../lib/i18n';
import { JOKER_STICKER, SABOTAGE_STICKER, STAKE_STICKER } from '../../play/powers';
import styles from './TvPower.module.css';
import { cx } from '../../lib/cx';

type PowerData = PhaseDataOf<'POWER_RESOLUTION'>;

const STEP_MS = 650;

/** Items revealed one after another; the sounds follow the same beat. */
export function itemDelay(index: number): number {
  return 350 + index * STEP_MS;
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
      window.setTimeout(
        () => sfx.play(item.kind === 'SABOTAGE' ? (item.blocked ? 'shield' : 'hit') : 'power'),
        itemDelay(index),
      ),
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
            <Sticker
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

  return (
    <div className={styles.screen} data-testid="tv-power">
      <h1 className={styles.title}>{t('tv.power.title')}</h1>
      <div className={styles.grid}>{data.items.map(card)}</div>
    </div>
  );
}
