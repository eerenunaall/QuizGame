import type { Joker, RiskTier, SabotageKind } from '@quizparty/protocol';
import type { StickerId } from '../lib/assets';
import type { OwnIconId, PowerIconId } from '../ui/PowerIcon';

// The rules live in the shared client so the native app uses the very same ones.
export * from '@quizparty/controller-client/powers';

export const SABOTAGE_STICKER: Record<SabotageKind, PowerIconId> = {
  JAM: 'stopwatch',
  SHUFFLE: 'shuffle',
  FOG: 'fog',
  LOCKOUT: 'lock',
  POINT_TAX: 'coin',
  STAKE_CAP: 'stake-cap',
  CUT: 'cut',
  BLIND_CLOCK: 'blind-clock',
};

/** Pictures of the ADR-0023 risks (the sabotages above carry theirs). */
export const RISK_ICON: Record<'cover' | 'duel' | 'pot', OwnIconId> = {
  cover: 'cover',
  duel: 'duel',
  pot: 'pot',
};

export const STAKE_STICKER: Record<RiskTier, StickerId> = {
  SAFE: 'shield',
  RISK: 'bolt',
  HIGH: 'hot-face',
  ALL_IN: 'rocket',
};

export const JOKER_STICKER: Record<Joker, StickerId> = {
  FIFTY_FIFTY: 'light-bulb',
  DOUBLE_DOWN: 'fire',
};
