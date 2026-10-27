import { useEffect, useRef } from 'react';
import {
  teamColorSlot,
  type PhaseDataOf,
  type PublicPlayer,
  type RoomView,
} from '@quizparty/protocol';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { CountUp } from '../../ui/CountUp';
import { Mascot } from '../../ui/Mascot';
import { AnimatedSticker, Sticker } from '../../ui/Sticker';
import { burst, cannons, shower } from '../../lib/confetti';
import { PODIUM_PLAN } from '../../lib/sound/timeline';
import { useI18n } from '../../lib/i18n';
import { teamName } from '../../lib/teams';
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
  const individuals = data.ranking
    .map((entry) => ({ entry, player: players.get(entry.playerId) }))
    .filter((row): row is typeof row & { player: PublicPlayer } => row.player !== undefined);
  // Team play (ADR-0026 §4): the podium is for the teams, in the same shapes as players so one layout serves
  // both; the points on it are the averages. The players move to the list on the right.
  const teamMode = data.teamRanking !== undefined && data.teamRanking.length > 0;
  const teamRows = (data.teamRanking ?? []).map((row) => ({
    entry: { ...row, playerId: `team-${row.teamId}`, score: row.average },
    player: {
      playerId: `team-${row.teamId}`,
      avatarId: row.teamId,
      nickname: teamName(room.settings, row.teamId, t),
      colorSlot: teamColorSlot(row.teamId),
    },
    total: row.total,
  }));
  const ranked = teamMode ? teamRows : individuals;
  const podium = ranked.filter((row) => row.entry.rank <= 3);
  const rest = ranked.filter((row) => row.entry.rank > 3);
  const order = [2, 1, 3]; // silver, gold, bronze on screen
  const winners = teamRows.filter((row) => row.entry.rank === 1);

  // The ceremony: third place lands, then second, a drum roll, then the winner with the cannons. The
  // same plan times the sounds (useTvSounds -> playPodium), so the picture lands on the drum hits.
  useEffect(() => {
    const timers: number[] = [];
    let stopShower: (() => void) | null = null;
    timers.push(window.setTimeout(() => burst(0.3, 0.75, 50), PODIUM_PLAN.placeAt[3]));
    timers.push(window.setTimeout(() => burst(0.5, 0.75, 70), PODIUM_PLAN.placeAt[2]));
    timers.push(
      window.setTimeout(() => {
        cannons();
        stopShower = shower(4500);
      }, PODIUM_PLAN.celebrateAt),
    );
    rematchRef.current?.focus();
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      stopShower?.();
    };
  }, []);

  return (
    <div className={styles.screen} data-testid="tv-results">
      <h1 className={styles.title}>
        {teamMode && winners.length === 1
          ? t('teams.results.winner', { team: winners[0]!.player.nickname })
          : t('results.title')}
      </h1>

      <div className={styles.podium}>
        {order.map((place) => {
          const rows = podium.filter((row) => row.entry.rank === place);
          return rows.map(({ entry, player }) => (
            <div
              key={player.playerId}
              className={cx(styles.step, styles[`place${place}`])}
              style={{
                ['--qp-block-delay' as string]: `${PODIUM_PLAN.placeAt[place as 1 | 2 | 3]}ms`,
                ['--qp-who-delay' as string]: `${PODIUM_PLAN.placeAt[place as 1 | 2 | 3] + 380}ms`,
              }}
              data-testid={`podium-${place}`}
            >
              {place === 1 ? (
                <span className={cx(styles.spot, 'qp-deco')} aria-hidden="true" />
              ) : null}
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
                <CountUp
                  className={styles.score}
                  value={entry.score}
                  from={0}
                  durationMs={1400}
                  delayMs={PODIUM_PLAN.placeAt[place as 1 | 2 | 3] + 380}
                />
                {teamMode ? (
                  <div className={styles.teamSub}>
                    {td('teams.total', {
                      points:
                        teamRows.find((row) => row.player.playerId === player.playerId)?.total ?? 0,
                    })}
                  </div>
                ) : null}
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

        {teamMode ? (
          <div className={styles.players} data-testid="tv-results-players">
            <div className={styles.playersTitle}>{t('teams.results.players')}</div>
            {individuals.map(({ entry, player }) => (
              <div key={player.playerId} className={styles.playerRow}>
                <span className={styles.restRank}>{entry.rank}</span>
                <Avatar avatarId={player.avatarId} size={40} colorSlot={player.colorSlot} />
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

      {teamMode ? null : (
        <div className={styles.mascot} data-testid="tv-results-mascot">
          <Mascot height={190} mood="cheer" />
        </div>
      )}

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
