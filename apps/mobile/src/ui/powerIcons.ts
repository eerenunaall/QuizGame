import type { SabotageKind } from '@quizparty/protocol';

/**
 * Pictures of the ADR-0023 risks and sabotages for the native app: system emoji, like its avatars
 * (the browser app draws its own SVGs for the same things). The record is exhaustive, so a new
 * sabotage kind breaks the build here.
 */
export const RISK_EMOJI = { cover: '☂️', duel: '⚔️', pot: '🏺' } as const;

export const SABOTAGE_EMOJI: Record<SabotageKind, string> = {
  JAM: '⏱️',
  SHUFFLE: '🔀',
  FOG: '🌫️',
  LOCKOUT: '🔒',
  POINT_TAX: '🪙',
  STAKE_CAP: '🪜',
  CUT: '✂️',
  BLIND_CLOCK: '🙈',
};
