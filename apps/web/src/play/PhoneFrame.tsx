import type { ReactNode } from 'react';
import type { RoomView } from '@quizparty/protocol';
import { Avatar } from '../ui/Avatar';
import { Banner } from '../ui/Banner';
import { Sticker } from '../ui/Sticker';
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
            {entry ? (
              <div className={styles.score} data-testid="phone-score">
                <Sticker id="star" size={26} />
                <span>{entry.score}</span>
              </div>
            ) : null}
          </>
        ) : (
          <span className={styles.name}>Quiz Party</span>
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
      <main className={styles.main}>{children}</main>
    </div>
  );
}
