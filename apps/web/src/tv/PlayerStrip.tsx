import type { PublicPlayer } from '@quizparty/protocol';
import { Avatar } from '../ui/Avatar';
import { CountUp } from '../ui/CountUp';
import { Sticker } from '../ui/Sticker';
import { StreakFlame } from '../ui/anim/StreakFlame';
import { useI18n } from '../lib/i18n';
import styles from './PlayerStrip.module.css';
import { cx } from '../lib/cx';

interface Props {
  players: readonly PublicPlayer[];
  scoreOf: (player: PublicPlayer) => number;
  /** Player ids who have locked an answer (their choice stays hidden until the reveal). */
  answered?: readonly string[] | undefined;
  results?: Record<string, 'CORRECT' | 'INCORRECT' | 'NO_ANSWER'> | undefined;
  /** Correct answers in a row per player; from the second one a flame sits on the face. */
  streakOf?: ((player: PublicPlayer) => number) | undefined;
  /** Reveal choreography: the result badges land this many ms after the phase begins (the drum hit). */
  revealAt?: number | undefined;
}

/** Bottom strip: face, name and running score of every player, with answered / right / wrong badges. */
export function PlayerStrip({ players, scoreOf, answered, results, streakOf, revealAt }: Props) {
  const { t } = useI18n();
  return (
    <div className={styles.strip} role="list">
      {players.map((player, index) => {
        const streak = streakOf?.(player) ?? 0;
        const done = answered?.includes(player.playerId) ?? false;
        const result = results?.[player.playerId];
        const badgeStyle =
          revealAt !== undefined && result !== undefined
            ? { animationDelay: `${revealAt + index * 70}ms` }
            : undefined;
        return (
          <div
            key={player.playerId}
            className={cx(styles.tile, player.connection === 'DISCONNECTED' && styles.offline)}
            role="listitem"
          >
            <div className={styles.face}>
              <Avatar
                avatarId={player.avatarId}
                size={72}
                colorSlot={player.colorSlot}
                leader={player.isLeader}
                dim={player.connection === 'DISCONNECTED'}
                pulseKey={done ? 'answered' : undefined}
                playerId={player.playerId}
              />
              {streak >= 2 ? (
                <StreakFlame
                  streak={streak}
                  size={46}
                  className={styles.flame}
                  label={t('streak.label', { n: streak })}
                />
              ) : null}
              {result === 'CORRECT' ? (
                <Sticker
                  id="check"
                  size={42}
                  className={cx(styles.badge, badgeStyle && styles.delayed)}
                  style={badgeStyle}
                />
              ) : result === 'INCORRECT' || result === 'NO_ANSWER' ? (
                <Sticker
                  id="cross"
                  size={42}
                  className={cx(styles.badge, badgeStyle && styles.delayed)}
                  style={badgeStyle}
                />
              ) : done ? (
                <Sticker id="check" size={38} className={cx(styles.badge, styles.pending)} />
              ) : null}
            </div>
            <div className={styles.name}>{player.nickname}</div>
            <CountUp className={styles.score} value={scoreOf(player)} />
          </div>
        );
      })}
    </div>
  );
}
