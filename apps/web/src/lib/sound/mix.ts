/**
 * Mix policy: how loud each cue should peak (dBFS, at master 1.0, after the limiter). The values are
 * the intent; `scripts/audio/render.ts --calibrate` measures every cue offline in Chromium and
 * writes the trims that hit them into `trim.generated.ts`. Three tiers, so that a tick never
 * competes with a fanfare but still cuts through a loud room:
 *
 *   UI      taps, ticks, hover-sized cues          -11 dB
 *   MID     joins, locks, dims, hits, powers        -7 dB
 *   MOMENT  reveal hit, correct, go, final, podium  -3 dB
 */
import type { SoundName } from './palette';

const UI = -11;
const MID = -7;
const MOMENT = -3;

export const TARGET_PEAK_DB: Record<SoundName, number> = {
  tap: UI,
  join: MID,
  ready: MID,
  tick: UI,
  tickUrgent: -8,
  countdown: MID,
  go: MOMENT,
  whoosh: MID,
  stinger: MID,
  roundStart: MOMENT,
  question: MID,
  lock: MID,
  drumroll: MID,
  reveal: MOMENT,
  dim: UI,
  revealHit: MOMENT,
  correct: MOMENT,
  wrong: MID,
  combo: MID,
  score: UI,
  rankUp: MID,
  final: MOMENT,
  fanfare: MOMENT,
  podium: MOMENT,
  rematch: MID,
  power: MID,
  fifty: MID,
  doubleDown: MID,
  shield: MID,
  hit: MID,
  sabotage: MID,
  hitJam: MID,
  hitShuffle: MID,
  hitFog: MID,
  hitLockout: MID,
  hitTax: MID,
  hitCap: MID,
  hitCut: MID,
  hitBlind: MID,
};
