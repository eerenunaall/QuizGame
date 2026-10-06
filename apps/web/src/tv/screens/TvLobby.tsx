import { useEffect, useRef } from 'react';
import type { RoomView } from '@quizparty/protocol';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { QrCode } from '../../ui/QrCode';
import { Sticker } from '../../ui/Sticker';
import { useI18n } from '../../lib/i18n';
import { TvFrame } from '../TvFrame';
import styles from './TvLobby.module.css';
import { cx } from '../../lib/cx';

interface Props {
  room: RoomView;
  joinUrl: string;
  /** Host and path of the join page, shown under the QR for people without a camera. */
  joinLabel: string;
  starting: boolean;
  error: string | null;
  onStart: () => void;
  onOpenSettings: () => void;
  categoryLabel: string;
}

const SLOTS = 8;

/** QR + room code on the left, the arriving players on the right, the start button below. */
export function TvLobby({
  room,
  joinUrl,
  joinLabel,
  starting,
  error,
  onStart,
  onOpenSettings,
  categoryLabel,
}: Props) {
  const { t, td } = useI18n();
  const startRef = useRef<HTMLButtonElement>(null);
  const enough = room.players.length >= 2;
  useEffect(() => {
    startRef.current?.focus();
  }, []);

  const slots = Array.from(
    { length: Math.min(SLOTS, room.maxPlayers) },
    (_, index) => room.players[index] ?? null,
  );
  const difficultyLabel = td(`settings.preset.${room.settings.difficulty}`);

  return (
    <TvFrame room={room} theme="lobby" strip={false}>
      <div className={styles.screen}>
        <Panel className={styles.join}>
          <h2 className={styles.joinTitle}>{t('lobby.scanToJoin')}</h2>
          <div className={styles.qr} data-testid="lobby-qr">
            <QrCode value={joinUrl} size={390} label={t('lobby.scanToJoin')} />
          </div>
          <div className={styles.url}>{joinLabel}</div>
          <div className={styles.codeBox} data-testid="lobby-code">
            {room.code}
          </div>
          <div className={styles.fine}>{t('lobby.limits', { max: room.maxPlayers })}</div>
        </Panel>

        <div className={styles.players}>
          <h1 className={styles.title}>{t('lobby.waiting')}</h1>
          <div className={styles.grid} data-testid="lobby-players">
            {slots.map((player, index) =>
              player ? (
                <div key={player.playerId} className={styles.slot}>
                  <Avatar
                    avatarId={player.avatarId}
                    size={150}
                    colorSlot={player.colorSlot}
                    leader={player.isLeader}
                    dim={player.connection === 'DISCONNECTED'}
                    playerId={player.playerId}
                  />
                  <div className={styles.name}>{player.nickname}</div>
                  {player.isLeader ? (
                    <span className={styles.badge}>{t('lobby.leader')}</span>
                  ) : player.ready ? (
                    <span className={cx(styles.badge, styles.ready)}>{t('lobby.ready')}</span>
                  ) : null}
                </div>
              ) : (
                <div key={`empty-${index}`} className={cx(styles.slot, styles.empty)}>
                  <div className={styles.placeholder}>
                    <span>…</span>
                  </div>
                  <div className={styles.waitingName}>{t('lobby.waitingSlot')}</div>
                </div>
              ),
            )}
          </div>

          <div className={styles.actions}>
            <Button
              ref={startRef}
              size="xl"
              onClick={onStart}
              disabled={!enough}
              busy={starting}
              icon="rocket"
              data-testid="lobby-start"
            >
              {t('tv.menu.startGame')}
            </Button>
            <Button
              variant="violet"
              size="lg"
              onClick={onOpenSettings}
              data-testid="lobby-settings"
            >
              {t('lobby.settings')}
            </Button>
          </div>
          <div className={styles.summary} data-testid="lobby-summary">
            <Sticker id="bullseye" size={44} />
            <span>
              {t('lobby.summary', {
                rounds: room.settings.rounds,
                difficulty: difficultyLabel,
                categories: categoryLabel,
              })}
            </span>
          </div>
          {!enough ? <div className={styles.need}>{t('lobby.needMore', { min: 2 })}</div> : null}
          {error ? <div className={styles.error}>{error}</div> : null}
        </div>
      </div>
    </TvFrame>
  );
}
