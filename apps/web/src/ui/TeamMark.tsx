import { useSyncExternalStore } from 'react';
import { teamColorSlot, TEAM_IDS, type TeamId } from '@quizparty/protocol';
import { playerColor } from '@quizparty/ui-tokens';
import { Avatar } from './Avatar';

/**
 * The venue's own team marks for this table (ADR-0030 §4), in `TEAM_IDS` order; null / missing = the
 * default animal. Set from the room view by `useVenueLook`, so a mark can only ever be one of this
 * table's own venue's images; cleared when the room has no table.
 */
let current: readonly (string | null)[] = [];
const listeners = new Set<() => void>();
export function setTeamLogos(logos: readonly (string | null)[] | undefined): void {
  const next = logos ?? [];
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTeamLogo = (teamId: TeamId): string | null =>
  useSyncExternalStore(subscribe, () => current[TEAM_IDS.indexOf(teamId)] ?? null);

/** A team's mark: the venue's logo for that slot in a ring of the team colour, else the animal icon. */
export function TeamMark({
  teamId,
  size,
  logo,
}: {
  teamId: TeamId;
  size: number;
  /** Overrides the provided logo (the panel's preview shows unsaved choices). */
  logo?: string | null;
}) {
  const provided = useTeamLogo(teamId);
  const url = logo === undefined ? provided : logo;
  if (!url) return <Avatar avatarId={teamId} size={size} colorSlot={teamColorSlot(teamId)} />;
  return (
    <span
      data-testid={`team-logo-${teamId}`}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        flex: 'none',
        background: 'rgba(255,255,255,0.08)',
        border: `${Math.max(3, Math.round(size * 0.05))}px solid ${playerColor(teamColorSlot(teamId))}`,
        boxSizing: 'border-box',
      }}
    >
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </span>
  );
}
