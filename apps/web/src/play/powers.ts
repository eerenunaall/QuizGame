import type { Joker, RiskTier, SabotageKind } from '@quizparty/protocol';
import type { StickerId } from '../lib/assets';

// The rules live in the shared client so the native app uses the very same ones.
export * from '@quizparty/controller-client/powers';

export const SABOTAGE_STICKER: Record<SabotageKind, StickerId> = {
  JAM: 'stopwatch',
  SHUFFLE: 'shuffle',
  FOG: 'fog',
  LOCKOUT: 'lock',
  POINT_TAX: 'coin',
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
