import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { RoomView } from '@quizparty/protocol';
import { Avatar } from '../ui/Avatar';
import { Banner } from '../ui/Banner';
import { Sticker } from '../ui/Sticker';
import { StreakFlame } from '../ui/anim/StreakFlame';
import { usePhaseEntrance } from '../ui/anim/usePhaseEntrance';
import { useI18n } from '../lib/i18n';
import styles from './PhoneFrame.module.css';

interface Props {
  room: RoomView | null;
  reconnecting: boolean;
  tvLost: boolean;
  restored: boolean;
  children: ReactNode;
}

/** Header (who am I, score) plus connection banners around every controller screen. */
export function PhoneFrame({ room, reconnecting, tvLost, restored, children }: Props) {
  const { t } = useI18n();
  const me = room?.you
    ? room.players.find((player) => player.playerId === room.you?.playerId)
    : undefined;
  const entry = room?.game?.scoreboard.find((row) => row.playerId === room?.you?.playerId);
  // One scroll container serves every screen: a phase must not inherit the previous one's scroll
  // (a risk screen scrolled to the Pot row would open the next question below its clock).
  const mainRef = useRef<HTMLElement>(null);
  const phase = room?.phase ?? null;
  usePhaseEntrance(mainRef, phase);
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [phase]);
  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        {me ? (
          <>
            <Avatar
              avatarId={me.avatarId}
              size={52}
              colorSlot={me.colorSlot}
              leader={me.isLeader}
            />
            <div className={styles.who}>
              <span className={styles.name} data-testid="phone-name">
                {me.nickname}
              </span>
              <span className={styles.room}>{room?.code}</span>
            </div>
            {entry && entry.streak >= 2 ? (
              <StreakFlame
                streak={entry.streak}
                size={40}
                className={styles.flame}
                label={t('streak.label', { n: entry.streak })}
              />
            ) : null}
            {entry ? (
              <div className={styles.score} data-testid="phone-score">
                <Sticker id="star" size={26} />
                <span>{entry.score}</span>
              </div>
            ) : null}
          </>
        ) : (
          <span className={styles.name}>QuizNight</span>
        )}
      </header>
      <div className={styles.banners}>
        {reconnecting ? (
          <Banner tone="warning" busy testId="net-reconnecting">
            {t('ctl.reconnecting')}
          </Banner>
        ) : tvLost ? (
          <Banner tone="info" busy testId="net-tv-lost">
            {t('ctl.tvLost')}
          </Banner>
        ) : restored ? (
          <Banner tone="success" testId="net-restored">
            {t('ctl.restored')}
          </Banner>
        ) : null}
      </div>
      <main ref={mainRef} className={styles.main}>
        {children}
      </main>
    </div>
  );
}
