import type { ReactNode } from 'react';
import type { PublicPlayer, RoomView } from '@quizparty/protocol';
import { Backdrop, type BackdropTheme } from '../ui/Backdrop';
import { ConfettiLayer } from '../ui/ConfettiLayer';
import { PhaseSweep } from '../ui/anim/PhaseSweep';
import { useI18n } from '../lib/i18n';
import { PlayerStrip } from './PlayerStrip';
import styles from './TvFrame.module.css';
import { cx } from '../lib/cx';
import { VenueLogo } from '../ui/VenueLogo';
import { VenueChip } from '../venue/VenueChip';

interface Props {
  room: RoomView;
  theme?: BackdropTheme;
  /** Round pill in the top bar ("SORU 3 / 10"). */
  round?: { index: number; total: number; isFinal: boolean };
  /** Show the scores/answered strip at the bottom. */
  strip?:
    | false
    | {
        answered?: readonly string[];
        results?: Record<string, 'CORRECT' | 'INCORRECT' | 'NO_ANSWER'>;
        /** Reveal choreography: when the right/wrong badges land (ms after the phase starts). */
        revealAt?: number;
      };
  /** Overlay content rendered above everything (banners). */
  overlay?: ReactNode;
  celebrate?: boolean;
  /** Server-synchronised clock for the venue chip (ADR-0024); the wall clock when absent. */
  now?: () => number;
  children: ReactNode;
}

const scoreOf = (room: RoomView, player: PublicPlayer): number =>
  room.game?.scoreboard.find((entry) => entry.playerId === player.playerId)?.score ?? 0;

const streakOf = (room: RoomView, player: PublicPlayer): number =>
  room.game?.scoreboard.find((entry) => entry.playerId === player.playerId)?.streak ?? 0;

/** Common TV chrome: backdrop, top bar (round + room code), bottom player strip. */
export function TvFrame({
  room,
  theme = 'game',
  round,
  strip,
  overlay,
  celebrate,
  now,
  children,
}: Props) {
  const { t } = useI18n();
  return (
    <div className={styles.frame}>
      <Backdrop theme={theme} />
      <div className={styles.top}>
        <div className={styles.slot}>
          <VenueLogo className={styles.venueLogo} />
          {round ? (
            <span className={cx(styles.roundPill, round.isFinal && styles.final)}>
              {round.isFinal
                ? t('game.final.title')
                : t('game.round.of', { n: round.index + 1, total: round.total })}
            </span>
          ) : null}
        </div>
        <div className={styles.slotEnd}>
          {room.venue ? <VenueChip venue={room.venue} {...(now ? { now } : {})} /> : null}
          <span className={styles.code}>
            <span className={styles.codeLabel}>{t('lobby.roomCode')}</span>
            <span className={styles.codeValue} data-testid="room-code">
              {room.code}
            </span>
          </span>
        </div>
      </div>
      <div className={styles.content}>{children}</div>
      {strip === false ? null : (
        <PlayerStrip
          players={room.players}
          scoreOf={(player) => scoreOf(room, player)}
          answered={strip?.answered}
          results={strip?.results}
          streakOf={(player) => streakOf(room, player)}
          revealAt={strip?.revealAt}
        />
      )}
      <PhaseSweep phase={room.phase} />
      {overlay ? <div className={styles.overlay}>{overlay}</div> : null}
      {celebrate ? <ConfettiLayer /> : null}
    </div>
  );
}
