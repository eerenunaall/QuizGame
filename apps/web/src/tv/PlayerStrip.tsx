import type { PublicPlayer } from '@quizparty/protocol';
import { Avatar } from '../ui/Avatar';
import { CountUp } from '../ui/CountUp';
import { Sticker } from '../ui/Sticker';
import styles from './PlayerStrip.module.css';
import { cx } from '../lib/cx';

interface Props {
  players: readonly PublicPlayer[];
  scoreOf: (player: PublicPlayer) => number;
  /** Player ids who have locked an answer (their choice stays hidden until the reveal). */
  answered?: readonly string[] | undefined;
  results?: Record<string, 'CORRECT' | 'INCORRECT' | 'NO_ANSWER'> | undefined;
}

/** Bottom strip: face, name and running score of every player, with answered / right / wrong badges. */
export function PlayerStrip({ players, scoreOf, answered, results }: Props) {
  return (
    <div className={styles.strip} role="list">
      {players.map((player) => {
        const done = answered?.includes(player.playerId) ?? false;
        const result = results?.[player.playerId];
        return (
          <div
            key={player.playerId}
            className={cx(styles.tile, player.connection === 'DISCONNECTED' && styles.offline)}
            role="listitem"
          >
            <div className={styles.face}>
              <Avatar
                avatarId={player.avatarId}
                size={92}
                colorSlot={player.colorSlot}
                leader={player.isLeader}
                dim={player.connection === 'DISCONNECTED'}
                pulseKey={done ? 'answered' : undefined}
                playerId={player.playerId}
              />
              {result === 'CORRECT' ? (
                <Sticker id="check" size={48} className={styles.badge} />
              ) : result === 'INCORRECT' || result === 'NO_ANSWER' ? (
                <Sticker id="cross" size={48} className={styles.badge} />
              ) : done ? (
                <Sticker id="check" size={44} className={cx(styles.badge, styles.pending)} />
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
