import type { ClientState } from '@quizparty/controller-client';

export type BannerKind = 'RECONNECTING' | 'TV_LOST' | 'RESTORED' | null;

/**
 * Which connection notice (if any) the phone shows. Reconnecting wins over everything; "TV lost" is
 * only meaningful once a game is under way (in the lobby the TV may simply not have connected yet).
 */
export function bannerKind(state: ClientState, showRestored: boolean): BannerKind {
  if (state.transport === 'RECONNECTING') return 'RECONNECTING';
  const room = state.room;
  if (room && !room.displayConnected && room.phase !== 'LOBBY' && room.phase !== 'WAITING')
    return 'TV_LOST';
  return showRestored ? 'RESTORED' : null;
}
