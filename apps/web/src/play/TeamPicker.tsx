import type { RoomView, TeamId } from '@quizparty/protocol';
import { TeamChip } from '../ui/TeamBadge';
import { useI18n } from '../lib/i18n';
import { sfx } from '../lib/audio';
import { membersOf, offeredTeams, teamCapacity } from '../lib/teams';
import styles from './TeamPicker.module.css';

interface Props {
  room: RoomView;
  /** Whose team this changes: the player themselves, or (host only) somebody the leader manages. */
  subjectId: string;
  onPick: (teamId: TeamId) => void;
  /** Smaller, without the title and hint (the leader's "move this player" row). */
  compact?: boolean;
}

/**
 * "Pick your team": one big chip per offered team (ADR-0026 §2). Names, icons and colours are ours, so the
 * only input is a tap. A full team shows "Full" and cannot be tapped; the server checks again.
 */
export function TeamPicker({ room, subjectId, onPick, compact }: Props) {
  const { t } = useI18n();
  const subject = room.players.find((player) => player.playerId === subjectId);
  const capacity = teamCapacity(room);
  return (
    <div className={styles.picker} data-testid={compact ? 'team-move' : 'team-picker'}>
      {compact ? null : <div className={styles.title}>{t('teams.pick.title')}</div>}
      <div className={styles.chips}>
        {offeredTeams(room).map((teamId) => {
          const count = membersOf(room, teamId).length;
          return (
            <TeamChip
              key={teamId}
              teamId={teamId}
              settings={room.settings}
              count={count}
              selected={subject?.teamId === teamId}
              full={count >= capacity}
              onSelect={() => {
                sfx.play('tap');
                onPick(teamId);
              }}
            />
          );
        })}
      </div>
      {compact ? null : <div className={styles.hint}>{t('teams.pick.hint')}</div>}
    </div>
  );
}
