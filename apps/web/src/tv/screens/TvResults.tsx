import { useEffect, useRef } from 'react';
import type { PhaseDataOf, PublicPlayer, RoomView } from '@quizparty/protocol';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { CountUp } from '../../ui/CountUp';
import { AnimatedSticker, Sticker } from '../../ui/Sticker';
import { cannons, shower } from '../../lib/confetti';
import { useI18n } from '../../lib/i18n';
import styles from './TvResults.module.css';
import { cx } from '../../lib/cx';

type ResultsData = PhaseDataOf<'RESULTS'>;

interface Props {
  room: RoomView;
  data: ResultsData;
  onRematch: () => void;
  onLobby: () => void;
  onEnd: () => void;
  busy: boolean;
}

const AWARD_STICKER = {
  SHARPSHOOTER: 'bullseye',
  FASTEST_FINGER: 'bolt',
  STREAK_MASTER: 'fire',
  COMEBACK: 'rocket',
} as const;

/** Podium for the top three, the rest in a list, awards, and the rematch controls. */
export function TvResults({ room, data, onRematch, onLobby, onEnd, busy }: Props) {
  const { t, td } = useI18n();
  const rematchRef = useRef<HTMLButtonElement>(null);
  const players = new Map<string, PublicPlayer>(
    room.players.map((player) => [player.playerId, player]),
  );
  const ranked = data.ranking
    .map((entry) => ({ entry, player: players.get(entry.playerId) }))
    .filter((row): row is typeof row & { player: PublicPlayer } => row.player !== undefined);
  const podium = ranked.filter((row) => row.entry.rank <= 3);
  const rest = ranked.filter((row) => row.entry.rank > 3);
  const order = [2, 1, 3]; // silver, gold, bronze on screen

  useEffect(() => {
    const stop = (() => {
      cannons();
      return shower(4500);
    })();
    rematchRef.current?.focus();
    return stop;
  }, []);

  return (
    <div className={styles.screen} data-testid="tv-results">
      <h1 className={styles.title}>{t('results.title')}</h1>

      <div className={styles.podium}>
        {order.map((place) => {
          const rows = podium.filter((row) => row.entry.rank === place);
          return rows.map(({ entry, player }) => (
            <div
              key={player.playerId}
              className={cx(styles.step, styles[`place${place}`])}
              data-testid={`podium-${place}`}
            >
              <div className={styles.who}>
                <div className={styles.face}>
                  {place === 1 ? (
                    <AnimatedSticker id="trophy" size={120} className={styles.trophy} />
                  ) : null}
                  <Avatar
                    avatarId={player.avatarId}
                    size={place === 1 ? 176 : 140}
                    colorSlot={player.colorSlot}
                    leader={place === 1}
                    playerId={player.playerId}
                  />
                </div>
                <div className={styles.name}>{player.nickname}</div>
                <CountUp className={styles.score} value={entry.score} from={0} durationMs={1600} />
              </div>
              <div className={styles.block}>
                <Sticker
                  id={place === 1 ? 'medal-gold' : place === 2 ? 'medal-silver' : 'medal-bronze'}
                  size={84}
                />
                <span className={styles.place}>{place}</span>
              </div>
            </div>
          ));
        })}
      </div>

      <div className={styles.side}>
        {rest.length > 0 ? (
          <div className={styles.rest}>
            {rest.map(({ entry, player }) => (
              <div key={player.playerId} className={styles.restRow}>
                <span className={styles.restRank}>{entry.rank}</span>
                <Avatar avatarId={player.avatarId} size={52} colorSlot={player.colorSlot} />
                <span className={styles.restName}>{player.nickname}</span>
                <span className={styles.restScore}>{entry.score}</span>
              </div>
            ))}
          </div>
        ) : null}

        {data.awards.length > 0 ? (
          <div className={styles.awards}>
            {data.awards.map((award) => {
              const player = players.get(award.playerId);
              return player ? (
                <div key={`${award.kind}-${award.playerId}`} className={styles.award}>
                  <Sticker id={AWARD_STICKER[award.kind]} size={56} />
                  <span>
                    <strong>{td(`results.award.${award.kind}`)}</strong> · {player.nickname}
                  </span>
                </div>
              ) : null;
            })}
          </div>
        ) : null}
      </div>

      <div className={styles.actions}>
        <Button
          ref={rematchRef}
          size="lg"
          icon="party-popper"
          busy={busy}
          onClick={onRematch}
          data-testid="tv-rematch"
        >
          {t('results.rematch')}
        </Button>
        <Button variant="violet" size="md" onClick={onLobby} data-testid="tv-back-lobby">
          {t('results.backToLobby')}
        </Button>
        <Button variant="ghost" size="md" onClick={onEnd} data-testid="tv-end">
          {t('results.endRoom')}
        </Button>
      </div>
    </div>
  );
}
