import { useEffect, useRef } from 'react';
import type { RoomView } from '@quizparty/protocol';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { QrCode } from '../../ui/QrCode';
import { Sticker } from '../../ui/Sticker';
import { useI18n } from '../../lib/i18n';
import { isSimpleRoom, isTeamRoom, teamsCheck } from '../../lib/teams';
import { TvTeamColumns } from './TvTeams';
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
  onOpenUnlock: () => void;
  categoryLabel: string;
  /** Server-synchronised clock for the venue chip. */
  now?: () => number;
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
  onOpenUnlock,
  categoryLabel,
  now,
}: Props) {
  const { t, td } = useI18n();
  const startRef = useRef<HTMLButtonElement>(null);
  const statementCount =
    room.phaseData.phase === 'LOBBY' ? (room.phaseData.statementPlayerIds?.length ?? 0) : 0;
  const whoSaidIt = room.settings.mode === 'WHO_SAID_IT';
  // Who Said It needs a guesser for every statement: two statements are the least that makes a game.
  const teams = isTeamRoom(room);
  const enough =
    room.players.length >= 2 &&
    (!whoSaidIt || statementCount >= 2) &&
    (!teams || teamsCheck(room).ok);
  useEffect(() => {
    startRef.current?.focus();
  }, []);

  const slots = Array.from(
    { length: Math.min(SLOTS, room.maxPlayers) },
    (_, index) => room.players[index] ?? null,
  );
  const difficultyLabel = td(`settings.preset.${room.settings.difficulty}`);

  return (
    <TvFrame room={room} theme="lobby" strip={false} {...(now ? { now } : {})}>
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
          {teams ? (
            <TvTeamColumns room={room} />
          ) : (
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
          )}

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
            {room.tier === 'FREE' || room.settings.mode === 'CLASSIC' ? (
              <Button variant="ghost" size="lg" onClick={onOpenUnlock} data-testid="lobby-unlock">
                {room.tier === 'FREE' ? t('tv.unlock.button') : t('tv.quiz.button')}
              </Button>
            ) : null}
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
          {room.settings.mode !== 'CLASSIC' ? (
            <div className={styles.summary} data-testid="lobby-mode">
              <span>
                {t(`lobby.mode.${room.settings.mode}`, { title: room.settings.contentTitle ?? '' })}
              </span>
            </div>
          ) : null}
          {teams || isSimpleRoom(room) ? (
            <div className={styles.summary} data-testid="lobby-play">
              <span>
                {td(`teams.mode.${room.settings.play ?? 'INDIVIDUAL'}`)} ·{' '}
                {td(`teams.ruleset.${room.settings.ruleset ?? 'FULL'}`)}
              </span>
            </div>
          ) : null}
          {whoSaidIt ? (
            <div className={styles.summary} data-testid="lobby-statements">
              <span>
                {t('whosaidit.tv.count', { count: statementCount, total: room.players.length })} ·{' '}
                {t('whosaidit.tv.hint')}
              </span>
            </div>
          ) : null}
          {!enough && room.players.length < 2 ? (
            <div className={styles.need}>{t('lobby.needMore', { min: 2 })}</div>
          ) : null}
          {error ? <div className={styles.error}>{error}</div> : null}
        </div>
      </div>
    </TvFrame>
  );
}
