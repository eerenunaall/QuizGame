import type { PhaseDataOf, RoomView, TeamStanding } from '@quizparty/protocol';
import { Avatar } from '../../ui/Avatar';
import { CountUp } from '../../ui/CountUp';
import { Sticker } from '../../ui/Sticker';
import { TeamBadge } from '../../ui/TeamBadge';
import { useI18n } from '../../lib/i18n';
import {
  membersOf,
  offeredTeams,
  teamCapacity,
  teamColor,
  teamName,
  teamsCheck,
} from '../../lib/teams';
import styles from './TvTeams.module.css';
import { cx } from '../../lib/cx';

/** Width of the lobby's player area (px of the 1920 x 1080 stage) shared out between the teams. */
const AREA_PX = 1120;
const COLUMN_GAP_PX = 20;

/**
 * The lobby in team play (ADR-0026): one column per team with its members, empty seats as dashed
 * circles, and a line that says whether the teams make a game. Replaces the plain player grid.
 */
export function TvTeamColumns({ room }: { room: RoomView }) {
  const { t, td } = useI18n();
  const teams = offeredTeams(room);
  const width = Math.floor((AREA_PX - (teams.length - 1) * COLUMN_GAP_PX) / teams.length);
  const capacity = teamCapacity(room);
  const check = teamsCheck(room);
  return (
    <div data-testid="lobby-teams">
      <div className={styles.columns}>
        {teams.map((teamId) => {
          const members = membersOf(room, teamId);
          return (
            <div
              key={teamId}
              className={styles.column}
              style={{ width, ['--team' as string]: teamColor(teamId) }}
              data-testid={`lobby-team-${teamId}`}
            >
              <div className={styles.head}>
                <TeamBadge
                  teamId={teamId}
                  settings={room.settings}
                  size={64}
                  label={false}
                  decorative
                />
                <div className={styles.headText}>
                  <div className={styles.teamName}>{teamName(room.settings, teamId, t)}</div>
                  <div className={styles.count}>
                    {td('teams.members', { count: members.length })}
                  </div>
                </div>
              </div>
              {Array.from({ length: capacity }, (_, index) => {
                const player = members[index];
                return player ? (
                  <div key={player.playerId} className={styles.member}>
                    <Avatar
                      avatarId={player.avatarId}
                      size={54}
                      colorSlot={player.colorSlot}
                      leader={player.isLeader}
                      dim={player.connection === 'DISCONNECTED'}
                      playerId={player.playerId}
                    />
                    <span className={styles.memberName}>{player.nickname}</span>
                    {player.ready ? <Sticker id="check" size={30} /> : null}
                  </div>
                ) : (
                  <div key={`seat-${index}`} className={cx(styles.member, styles.seat)}>
                    <span className={styles.seatDot} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div
        className={cx(styles.balance, check.ok ? styles.balanceOk : styles.balanceBad)}
        data-testid="lobby-balance"
        data-ok={check.ok}
      >
        {check.ok
          ? t('teams.balance.ok')
          : check.reason === 'FEW'
            ? t('teams.balance.few')
            : t('teams.balance.bad', {
                big: teamName(room.settings, check.big, t),
                small: teamName(room.settings, check.small, t),
              })}
      </div>
      <div className={styles.pickHint}>{t('teams.tv.pick')}</div>
    </div>
  );
}

type Board = readonly TeamStanding[];

/**
 * Team standings after a question (ADR-0026 §4): rank, team, the average per member (what decides the
 * rank) and the total beside it, with the faces of the members and what each earned this question.
 */
export function TvTeamBoard({ room, data }: { room: RoomView; data: PhaseDataOf<'SCORE_UPDATE'> }) {
  const { t, td } = useI18n();
  const board: Board = data.teamBoard ?? [];
  const deltas = new Map(data.deltas.map((delta) => [delta.playerId, delta.delta]));
  return (
    <div className={styles.board} data-testid="tv-team-board">
      {board.map((row, index) => {
        const members = membersOf(room, row.teamId);
        return (
          <div
            key={row.teamId}
            className={cx(styles.boardRow, row.rank === 1 && row.average > 0 && styles.first)}
            style={{
              ['--team' as string]: teamColor(row.teamId),
              ['--qp-delay' as string]: `${index * 70}ms`,
            }}
            data-testid={`team-row-${row.teamId}`}
            data-rank={row.rank}
          >
            <span className={styles.rank}>
              {row.rank === 1 && row.average > 0 ? <Sticker id="crown" size={64} /> : row.rank}
            </span>
            <TeamBadge
              teamId={row.teamId}
              settings={room.settings}
              size={78}
              label={false}
              decorative
            />
            <span className={styles.boardName}>
              <span className={styles.boardTeam}>{teamName(room.settings, row.teamId, t)}</span>
              <span className={styles.boardMembers}>
                {members.map((player) => {
                  const gain = deltas.get(player.playerId);
                  return (
                    <span key={player.playerId} className={styles.face}>
                      <Avatar avatarId={player.avatarId} size={40} colorSlot={player.colorSlot} />
                      {gain !== undefined ? (
                        <span
                          className={cx(
                            styles.gain,
                            gain > 0 ? styles.up : gain < 0 ? styles.down : styles.flat,
                          )}
                        >
                          {gain > 0 ? `+${gain}` : gain < 0 ? String(gain) : '±0'}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </span>
            </span>
            <span className={styles.points}>
              <span className={styles.avgLabel}>{t('teams.avgLabel')}</span>
              <CountUp className={styles.average} value={row.average} from={0} durationMs={900} />
              <span className={styles.total}>{td('teams.total', { points: row.total })}</span>
            </span>
          </div>
        );
      })}
      <div className={styles.rule}>{t('teams.rule.score')}</div>
    </div>
  );
}
