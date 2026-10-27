import type { TeamId } from '@quizparty/protocol';
import { Avatar } from './Avatar';
import { teamColor, teamName } from '../lib/teams';
import { useI18n } from '../lib/i18n';
import styles from './TeamBadge.module.css';
import { cx } from '../lib/cx';
import type { LobbySettings } from '@quizparty/protocol';
import { teamColorSlot } from '@quizparty/protocol';

interface BadgeProps {
  teamId: TeamId;
  settings: Pick<LobbySettings, 'teamNames'>;
  /** Edge of the icon in px. */
  size?: number;
  /** Show the name beside the icon. */
  label?: boolean;
  /** The name is already written next to the badge: add nothing for screen readers (no double reading). */
  decorative?: boolean;
  className?: string;
}

/**
 * A team's mark: its animal in a ring of its colour, and optionally its name. Colour is never the only
 * cue (icon and name stay), same rule as the answer colours (THEMES.md §2).
 */
export function TeamBadge({
  teamId,
  settings,
  size = 56,
  label = true,
  decorative = false,
  className,
}: BadgeProps) {
  const { t } = useI18n();
  const name = teamName(settings, teamId, t);
  return (
    <span
      className={cx(styles.badge, className)}
      style={{ ['--team' as string]: teamColor(teamId) }}
      data-testid={`team-badge-${teamId}`}
      data-team={teamId}
    >
      <Avatar avatarId={teamId} size={size} colorSlot={teamColorSlot(teamId)} />
      {label ? (
        <span className={styles.name} style={{ fontSize: Math.round(size * 0.52) }}>
          {name}
        </span>
      ) : decorative ? null : (
        <span className={styles.sr}>{name}</span>
      )}
    </span>
  );
}

interface ChipProps {
  teamId: TeamId;
  settings: Pick<LobbySettings, 'teamNames'>;
  count: number;
  selected: boolean;
  full: boolean;
  disabled?: boolean;
  onSelect: () => void;
  testId?: string;
}

/** The phone's team chip: one big tap target with the team's icon, name and how many are in it. */
export function TeamChip({
  teamId,
  settings,
  count,
  selected,
  full,
  disabled,
  onSelect,
  testId,
}: ChipProps) {
  const { t, td } = useI18n();
  const name = teamName(settings, teamId, t);
  return (
    <button
      type="button"
      className={cx(styles.chip, selected && styles.chipOn, full && !selected && styles.chipFull)}
      style={{ ['--team' as string]: teamColor(teamId) }}
      onClick={onSelect}
      disabled={disabled || (full && !selected)}
      aria-pressed={selected}
      aria-label={`${name}, ${td('teams.members', { count })}${full && !selected ? `, ${t('teams.full')}` : ''}`}
      data-testid={testId ?? `team-chip-${teamId}`}
      data-focusable
    >
      <Avatar avatarId={teamId} size={52} colorSlot={teamColorSlot(teamId)} />
      <span className={styles.chipText}>
        <span className={styles.chipName}>{name}</span>
        <span className={styles.chipCount}>
          {full && !selected ? t('teams.full') : td('teams.members', { count })}
        </span>
      </span>
    </button>
  );
}
