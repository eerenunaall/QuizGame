/**
 * The sound palette of the game, as data. Every cue is a short list of events (a bell here, a
 * thump there) in one key (`scale.ts`) and one timbre family:
 *
 *   bell    glassy glockenspiel: sine + octave + a short inharmonic shimmer (the "sparkle" of the brand)
 *   mallet  marimba / woodblock: a triangle through a closing low-pass (taps, ticks, plucks)
 *   pad     warm detuned saw through a slow low-pass (fanfares, ambience, "mood")
 *   thump   sine body with a pitch drop (kicks, toms, the soft "bonk")
 *   noise   band-passed noise sweeps (whooshes, risers, cymbal-ish crashes, drum-roll)
 *   click   a 15 ms noise tick (transient that makes a sound read through a noisy room)
 *
 * Pitches come from `hz(degree)` so nothing can leave the key. `engine.ts` turns events into a
 * Web Audio graph; this file stays pure so it can be unit-tested and measured offline.
 */
import {
  correctArpeggio,
  hz,
  joinDegree,
  midiToHz,
  streakGain,
  streakSteps,
  tickDegree,
} from './scale';
import type { SabotageKind } from '@quizparty/protocol';
import { TRIM_DB } from './trim.generated';
export { TRIM_DB };
import { PODIUM_PLAN, type PodiumPlan, type RevealPlan } from './timeline';

export type Voice = 'bell' | 'mallet' | 'pad' | 'thump' | 'noise' | 'click';

export interface SoundEvent {
  /** Seconds after the start of the cue. */
  at: number;
  voice: Voice;
  /** Pitch in Hz; for `noise` the start of the band sweep, for `click` its centre. */
  hz: number;
  /** Glide target (Hz) or the end of the noise band. */
  to?: number;
  dur: number;
  /** 0..1 before the per-sound trim. */
  gain: number;
  /** Reverb send, 0..1. */
  wet?: number;
}

/** Cues that exist as `sfx.play('<name>')`. The first twenty are the original keys and keep working. */
export const SOUND_NAMES = [
  // original keys
  'tap',
  'join',
  'tick',
  'tickUrgent',
  'countdown',
  'go',
  'whoosh',
  'question',
  'lock',
  'reveal',
  'correct',
  'wrong',
  'score',
  'rankUp',
  'final',
  'fanfare',
  'power',
  'shield',
  'hit',
  'sabotage',
  // additive keys
  'ready',
  'stinger',
  'roundStart',
  'drumroll',
  'dim',
  'revealHit',
  'combo',
  'fifty',
  'doubleDown',
  'hitJam',
  'hitShuffle',
  'hitFog',
  'hitLockout',
  'hitTax',
  'hitCap',
  'hitCut',
  'hitBlind',
  'podium',
  'rematch',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/** Optional shape of a cue: which tick, which streak, which place. */
export interface SoundParams {
  /** Correct-answer streak (correct, combo). */
  streak?: number;
  /** Seconds left on the clock (tick, tickUrgent) or the number shown (countdown). */
  step?: number;
  /** How many players are in the room already (join). */
  order?: number;
  /** Podium place 1..3 (podium) or the index of a dimmed option (dim). */
  place?: number;
  /** Length of a drum roll in seconds. */
  length?: number;
}

type Recipe = (p: SoundParams) => SoundEvent[];

const bell = (at: number, hzValue: number, dur: number, gain: number, wet = 0.3): SoundEvent => ({
  at,
  voice: 'bell',
  hz: hzValue,
  dur,
  gain,
  wet,
});
const mallet = (
  at: number,
  hzValue: number,
  dur: number,
  gain: number,
  to?: number,
  wet = 0.2,
): SoundEvent => ({ at, voice: 'mallet', hz: hzValue, ...(to ? { to } : {}), dur, gain, wet });
const pad = (at: number, hzValue: number, dur: number, gain: number, wet = 0.4): SoundEvent => ({
  at,
  voice: 'pad',
  hz: hzValue,
  dur,
  gain,
  wet,
});
const thump = (
  at: number,
  from: number,
  to: number,
  dur: number,
  gain: number,
  wet = 0.1,
): SoundEvent => ({ at, voice: 'thump', hz: from, to, dur, gain, wet });
const noise = (
  at: number,
  from: number,
  to: number,
  dur: number,
  gain: number,
  wet = 0.2,
): SoundEvent => ({ at, voice: 'noise', hz: from, to, dur, gain, wet });
const click = (at: number, centre: number, gain: number): SoundEvent => ({
  at,
  voice: 'click',
  hz: centre,
  dur: 0.018,
  gain,
  wet: 0,
});

/** A snare-ish drum roll: bursts that get closer together and louder, ending right at `length`. */
function roll(at: number, length: number, peak: number): SoundEvent[] {
  const events: SoundEvent[] = [];
  const hits = Math.max(6, Math.round(length * 26));
  for (let i = 0; i < hits; i++) {
    const t = i / (hits - 1);
    // accelerate: later hits are closer together
    const when = at + length * (1 - (1 - t) ** 1.6) * 0.96;
    const level = peak * (0.28 + 0.72 * t);
    events.push(noise(when, 2600, 1500, 0.05, level, 0.12));
    if (i % 2 === 0) events.push(thump(when, 190, 140, 0.07, level * 0.5, 0.05));
  }
  return events;
}

/** Streak-scaled "correct": a rising arpeggio that ends in a held chord, hotter with the streak. */
function correct(p: SoundParams): SoundEvent[] {
  const streak = p.streak ?? 1;
  const notes = correctArpeggio(streak);
  const boost = streakGain(streak);
  const step = 0.07 - Math.min(0.02, streakSteps(streak) * 0.005);
  const events: SoundEvent[] = [];
  notes.forEach((degree, index) => {
    const last = index === notes.length - 1;
    events.push(
      bell(
        index * step,
        hz(degree),
        last ? 0.9 : 0.28,
        (last ? 0.62 : 0.5) * boost,
        last ? 0.5 : 0.3,
      ),
    );
    events.push(mallet(index * step, hz(degree), 0.09, 0.28 * boost, undefined, 0.1));
  });
  const end = notes.length * step;
  // soft thump under the downbeat: weight on small speakers
  events.push(thump(0, 130, 90, 0.18, 0.5, 0.05));
  if (streakSteps(streak) >= 2)
    events.push(noise(end - step, 3500, 9000, 0.4, 0.14 + 0.02 * streakSteps(streak), 0.4));
  if (streakSteps(streak) >= 3) {
    events.push(pad(end - step, hz(0) / 2, 0.9, 0.22, 0.5));
    events.push(pad(end - step, hz(3) / 2, 0.9, 0.18, 0.5));
  }
  return events;
}

const RECIPES: Record<SoundName, Recipe> = {
  tap: () => [mallet(0, hz(10), 0.06, 0.4, hz(8), 0.1), click(0, 3200, 0.22)],
  join: (p) => {
    const root = joinDegree(p.order ?? 0);
    return [
      bell(0, hz(root), 0.35, 0.55),
      bell(0.09, hz(root + 3), 0.7, 0.55, 0.45),
      mallet(0.09, hz(root + 8), 0.1, 0.25),
    ];
  },
  ready: () => [
    mallet(0, hz(7), 0.1, 0.5),
    bell(0.07, hz(10), 0.5, 0.55, 0.4),
    click(0, 3000, 0.2),
  ],
  tick: (p) => {
    const degree = tickDegree(p.step ?? 9);
    return [mallet(0, hz(degree), 0.045, 0.3, undefined, 0.05), click(0, 2600, 0.3)];
  },
  tickUrgent: (p) => {
    const degree = tickDegree(p.step ?? 3);
    return [
      mallet(0, hz(degree), 0.08, 0.55, undefined, 0.1),
      bell(0, hz(degree), 0.12, 0.2, 0.1),
      click(0, 4200, 0.4),
    ];
  },
  countdown: (p) => {
    const degree = [0, 9, 8, 7][Math.min(3, Math.max(1, p.step ?? 1))] ?? 9;
    return [
      bell(0, hz(degree), 0.35, 0.8, 0.35),
      mallet(0, hz(degree - 5), 0.12, 0.5),
      thump(0, 170, 85, 0.2, 0.6),
      click(0, 3000, 0.3),
    ];
  },
  go: () => [
    bell(0, hz(5), 1.0, 0.55, 0.5),
    bell(0, hz(7), 1.0, 0.5, 0.5),
    bell(0, hz(8), 1.0, 0.5, 0.5),
    bell(0.02, hz(10), 1.1, 0.6, 0.5),
    mallet(0.02, hz(15), 0.15, 0.35),
    thump(0, 100, 45, 0.45, 0.85),
    noise(0, 500, 6000, 0.35, 0.3, 0.4),
  ],
  whoosh: () => [noise(0, 250, 3600, 0.42, 0.6, 0.3), thump(0.28, 110, 60, 0.25, 0.25)],
  stinger: () => [
    noise(0, 500, 3000, 0.22, 0.3, 0.25),
    mallet(0.1, hz(7), 0.1, 0.4),
    bell(0.17, hz(10), 0.5, 0.5, 0.45),
  ],
  roundStart: () => [
    noise(0, 300, 4200, 0.4, 0.35, 0.35),
    thump(0.34, 120, 55, 0.4, 0.8),
    bell(0.36, hz(5), 0.8, 0.55, 0.5),
    bell(0.36, hz(8), 0.8, 0.5, 0.5),
    bell(0.5, hz(10), 0.9, 0.55, 0.55),
    mallet(0.5, hz(12), 0.12, 0.3),
    pad(0.34, hz(0), 0.8, 0.25, 0.5),
  ],
  question: () => [
    mallet(0, hz(7), 0.12, 0.45),
    mallet(0.12, hz(10), 0.14, 0.5),
    bell(0.12, hz(12), 0.45, 0.45, 0.4),
  ],
  lock: () => [
    thump(0, 190, 80, 0.16, 0.7, 0.05),
    click(0, 2200, 0.6),
    mallet(0, hz(10), 0.09, 0.7, hz(7), 0.05),
    mallet(0.045, hz(12), 0.06, 0.4, undefined, 0.05),
  ],
  drumroll: (p) => [
    ...roll(0, p.length ?? 0.5, 0.55),
    noise(0, 800, 5000, p.length ?? 0.5, 0.18, 0.3),
  ],
  reveal: () => [
    ...roll(0, 0.5, 0.55),
    noise(0, 800, 5000, 0.5, 0.18, 0.3),
    thump(0.52, 120, 50, 0.4, 0.9),
    bell(0.54, hz(5), 0.7, 0.4, 0.5),
  ],
  dim: (p) => {
    const place = Math.min(3, Math.max(0, p.place ?? 0));
    const degree = 9 - place * 2;
    return [mallet(0, hz(degree), 0.11, 0.5, hz(degree - 2), 0.15), click(0, 2600, 0.5)];
  },
  revealHit: () => [
    thump(0, 130, 48, 0.45, 0.95),
    bell(0.01, hz(5), 0.9, 0.5, 0.5),
    bell(0.01, hz(8), 0.9, 0.45, 0.5),
    noise(0, 900, 6500, 0.45, 0.28, 0.45),
  ],
  correct,
  wrong: () => [
    // Soft bonk: a low, round thud and a small falling minor third, no sharp edges.
    thump(0, 118, 74, 0.34, 0.7, 0.15),
    mallet(0.02, hz(7), 0.3, 0.7, hz(5), 0.25),
    mallet(0.05, hz(2), 0.36, 0.55, hz(0), 0.25),
    click(0, 2400, 0.55),
    bell(0.02, hz(7), 0.25, 0.22, 0.2),
  ],
  combo: (p) => {
    const lift = streakSteps(p.streak ?? 2);
    return [
      noise(0, 700, 5200, 0.32, 0.3, 0.35),
      bell(0.12, hz(10 + lift), 0.5, 0.5, 0.5),
      bell(0.2, hz(12 + lift), 0.8, 0.5, 0.55),
      mallet(0.2, hz(15), 0.1, 0.25),
    ];
  },
  score: () =>
    [10, 12, 13, 15].map((degree, i) => mallet(i * 0.06, hz(degree), 0.1, 0.22, undefined, 0.25)),
  rankUp: () => [
    mallet(0, hz(7), 0.14, 0.5, hz(8)),
    bell(0.1, hz(9), 0.35, 0.5, 0.4),
    bell(0.18, hz(12), 0.7, 0.55, 0.5),
    noise(0, 600, 3200, 0.22, 0.14, 0.3),
  ],
  final: () => [
    ...roll(0, 1.05, 0.7),
    noise(0, 200, 6500, 1.1, 0.34, 0.35),
    thump(0, 90, 40, 0.9, 0.7),
    thump(1.08, 110, 38, 0.8, 1.0),
    pad(1.08, hz(-1) / 2, 1.0, 0.3, 0.5),
    pad(1.08, hz(0), 1.0, 0.3, 0.5),
    bell(1.08, hz(5), 1.2, 0.55, 0.55),
    bell(1.08, hz(7), 1.2, 0.5, 0.55),
    bell(1.1, hz(10), 1.4, 0.55, 0.6),
    mallet(1.1, hz(12), 0.2, 0.3),
  ],
  fanfare: () => {
    const chord = (at: number, degrees: number[], dur: number, gain: number): SoundEvent[] =>
      degrees.flatMap((degree) => [
        bell(at, hz(degree), dur, gain, 0.5),
        pad(at, hz(degree) / 2, dur * 0.8, gain * 0.5, 0.45),
      ]);
    return [
      thump(0, 130, 55, 0.35, 0.7),
      ...chord(0, [3, 5], 0.18, 0.4),
      ...chord(0.2, [5, 7], 0.18, 0.4),
      ...chord(0.4, [7, 8], 0.18, 0.42),
      thump(0.58, 120, 50, 0.5, 0.95),
      ...chord(0.6, [5, 7, 8, 10], 1.3, 0.5),
      bell(0.62, hz(12), 1.2, 0.4, 0.6),
      bell(0.72, hz(13), 1.2, 0.35, 0.6),
      noise(0.58, 1200, 8000, 0.8, 0.22, 0.5),
    ];
  },
  podium: (p) => {
    const place = p.place === 2 || p.place === 3 ? p.place : 1;
    if (place === 3)
      return [thump(0, 120, 55, 0.35, 0.8), bell(0, hz(7), 0.6, 0.5, 0.45), click(0, 2600, 0.3)];
    if (place === 2)
      return [
        thump(0, 125, 52, 0.4, 0.9),
        bell(0, hz(8), 0.8, 0.5, 0.5),
        bell(0.04, hz(10), 0.8, 0.5, 0.5),
        noise(0, 1000, 5000, 0.3, 0.2, 0.4),
      ];
    return [
      thump(0, 135, 45, 0.6, 1.0),
      bell(0, hz(5), 1.4, 0.55, 0.55),
      bell(0, hz(8), 1.4, 0.5, 0.55),
      bell(0.03, hz(10), 1.5, 0.55, 0.55),
      bell(0.06, hz(12), 1.5, 0.5, 0.6),
      pad(0, hz(0), 1.4, 0.3, 0.5),
      noise(0, 900, 9000, 0.9, 0.3, 0.55),
    ];
  },
  rematch: () => [
    ...[5, 7, 8, 10, 12].map((degree, i) => bell(i * 0.05, hz(degree), 0.5, 0.5, 0.4)),
    noise(0, 400, 4500, 0.35, 0.25, 0.3),
    thump(0.25, 110, 60, 0.3, 0.6),
  ],
  power: () => [
    thump(0, 70, 140, 0.45, 0.75),
    noise(0, 400, 4500, 0.55, 0.3, 0.35),
    bell(0.34, hz(4), 0.5, 0.45, 0.45),
    bell(0.4, hz(9), 0.7, 0.5, 0.5),
  ],
  fifty: () => [
    click(0, 5200, 0.5),
    mallet(0.01, hz(12), 0.12, 0.45, hz(8)),
    mallet(0.08, hz(10), 0.12, 0.4, hz(5)),
    noise(0.02, 5000, 1500, 0.12, 0.18, 0.2),
    bell(0.16, hz(8), 0.5, 0.4, 0.45),
  ],
  doubleDown: () => [
    thump(0, 130, 70, 0.2, 0.7),
    bell(0, hz(7), 0.2, 0.55, 0.3),
    thump(0.11, 130, 70, 0.2, 0.7),
    bell(0.11, hz(7), 0.2, 0.55, 0.3),
    bell(0.24, hz(12), 0.9, 0.6, 0.55),
    bell(0.24, hz(9), 0.9, 0.45, 0.55),
    noise(0.2, 1500, 7000, 0.4, 0.2, 0.4),
  ],
  shield: () => [
    bell(0, hz(12), 0.3, 0.55, 0.5),
    bell(0.07, hz(15), 0.9, 0.5, 0.6),
    noise(0.02, 6000, 9000, 0.4, 0.14, 0.5),
    pad(0.05, hz(5), 0.6, 0.2, 0.5),
    thump(0, 160, 90, 0.18, 0.4),
  ],
  hit: () => [
    thump(0, 210, 52, 0.32, 0.7),
    noise(0, 3000, 400, 0.28, 0.55, 0.2),
    click(0, 1800, 0.5),
    mallet(0, hz(5), 0.12, 0.5, hz(0)),
  ],
  // Sabotage "launch" heard on the TV: warm falling minor-third wobble, a nudge rather than a buzz.
  sabotage: () => [
    mallet(0, hz(8), 0.15, 0.7, hz(7)),
    mallet(0.12, hz(7), 0.15, 0.7, hz(5)),
    mallet(0.24, hz(2), 0.34, 0.7, hz(0)),
    click(0.24, 2600, 0.5),
    thump(0.24, hz(-5), hz(-5) / 2, 0.34, 0.32),
    noise(0.2, 2400, 500, 0.3, 0.2, 0.2),
  ],
  // One hit cue per sabotage kind: same family (thump + mallet), different gesture.
  hitJam: () => [
    ...[0, 0.075, 0.14, 0.195].map((at, i) =>
      mallet(at, hz(13), 0.05, 0.5 - i * 0.07, hz(12), 0.05),
    ),
    click(0, 3200, 0.4),
    thump(0.24, 160, 60, 0.3, 0.5),
    mallet(0.24, hz(5), 0.14, 0.55, hz(0)),
  ],
  hitShuffle: () => [
    ...[10, 7, 12, 8, 5, 13].map((degree, i) =>
      mallet(i * 0.05, hz(degree), 0.08, 0.4, undefined, 0.2),
    ),
    noise(0, 800, 4200, 0.3, 0.2, 0.25),
    thump(0.32, 150, 65, 0.25, 0.4),
    mallet(0.32, hz(5), 0.14, 0.5, hz(2)),
  ],
  hitFog: () => [
    pad(0, hz(0), 0.7, 0.55, 0.6),
    pad(0, hz(3) / 2, 0.7, 0.45, 0.6),
    noise(0, 2200, 400, 0.6, 0.5, 0.5),
    bell(0.1, hz(5), 0.6, 0.35, 0.7),
    thump(0.05, 110, 60, 0.4, 0.4),
  ],
  hitLockout: () => [
    click(0, 2400, 0.7),
    thump(0, 180, 70, 0.22, 0.6),
    bell(0.02, hz(3), 0.7, 0.55, 0.4),
    bell(0.06, hz(5), 0.5, 0.45, 0.4),
    mallet(0.1, hz(3), 0.14, 0.5, hz(0)),
  ],
  hitTax: () => [
    ...[15, 13, 12].map((degree, i) => bell(i * 0.07, hz(degree), 0.28, 0.45, 0.35)),
    thump(0.22, 140, 70, 0.3, 0.7),
    click(0.01, 5000, 0.3),
  ],
  hitCap: () => [
    thump(0, 170, 60, 0.28, 0.6),
    mallet(0.02, hz(8), 0.14, 0.65, hz(5)),
    thump(0.14, 150, 55, 0.3, 0.6),
    mallet(0.16, hz(5), 0.16, 0.6, hz(0)),
    click(0, 2600, 0.5),
    click(0.14, 2600, 0.5),
  ],
  hitCut: () => [
    noise(0, 5500, 900, 0.2, 0.55, 0.2),
    click(0, 4500, 0.6),
    mallet(0.05, hz(10), 0.2, 0.65, hz(3)),
    bell(0.05, hz(10), 0.2, 0.3, 0.2),
    thump(0.2, 130, 55, 0.3, 0.3),
  ],
  hitBlind: () => [
    noise(0, 2400, 400, 0.7, 0.5, 0.5),
    pad(0.02, hz(0), 0.8, 0.5, 0.6),
    pad(0.02, hz(2), 0.8, 0.4, 0.6),
    bell(0.05, hz(3), 0.7, 0.35, 0.7),
    thump(0, 120, 50, 0.45, 0.5),
  ],
};

/** The events of a cue, ready for the engine. */
export function eventsFor(name: SoundName, params: SoundParams = {}): SoundEvent[] {
  return RECIPES[name](params);
}

/** Moves a cue in time and applies its trim, so a cue inside a longer score is as loud as on its own. */
function shifted(
  events: readonly SoundEvent[],
  by: number,
  name?: SoundName,
  scale = 1,
): SoundEvent[] {
  const trim = (name ? 10 ** ((TRIM_DB[name] ?? 0) / 20) : 1) * scale;
  return events.map((event) => ({ ...event, at: event.at + by, gain: event.gain * trim }));
}

/**
 * The whole reveal as one score: drum roll, one soft tick per dimming wrong option (falling in
 * pitch), the hit when the right card lights up, then the outcome (arpeggio or bonk). Times come
 * from the same `RevealPlan` the CSS delays are derived from.
 */
export function revealEvents(
  plan: RevealPlan,
  outcome: { correct: boolean; streak?: number },
): SoundEvent[] {
  const events: SoundEvent[] = shifted(
    RECIPES.drumroll({ length: plan.rollMs / 1000 }),
    0,
    'drumroll',
  );
  let place = 0;
  for (const at of plan.dimAt) {
    if (at === null) continue;
    events.push(...shifted(RECIPES.dim({ place: place++ }), at / 1000, 'dim'));
  }
  const hit = plan.hitAt / 1000;
  events.push(...shifted(RECIPES.revealHit({}), hit, 'revealHit', 0.55));
  events.push(
    ...shifted(
      outcome.correct ? correct({ streak: outcome.streak ?? 1 }) : RECIPES.wrong({}),
      hit + 0.12,
      outcome.correct ? 'correct' : 'wrong',
      0.55,
    ),
  );
  return events;
}

/** The results ceremony: third place, second place, a drum roll, then the winner and the fanfare. */
export function podiumEvents(places: number, plan: PodiumPlan = PODIUM_PLAN): SoundEvent[] {
  const events: SoundEvent[] = [];
  for (const place of [3, 2] as const)
    if (places >= place)
      events.push(...shifted(RECIPES.podium({ place }), plan.placeAt[place] / 1000, 'podium'));
  if (places >= 1) {
    events.push(
      ...shifted(
        RECIPES.drumroll({ length: (plan.celebrateAt - plan.rollAt) / 1000 }),
        plan.rollAt / 1000,
        'drumroll',
        0.6,
      ),
    );
    events.push(...shifted(RECIPES.podium({ place: 1 }), plan.placeAt[1] / 1000, 'podium', 0.4));
    events.push(...shifted(RECIPES.fanfare({}), plan.celebrateAt / 1000 + 0.05, 'fanfare', 0.45));
  }
  return events;
}

/** Total length of a cue in seconds, including tails (used to release the audio graph). */
export function durationOf(events: readonly SoundEvent[]): number {
  return events.reduce((end, event) => Math.max(end, event.at + event.dur), 0);
}

/** Which hit cue belongs to a sabotage kind. */
export function hitSoundFor(kind: SabotageKind): SoundName {
  switch (kind) {
    case 'JAM':
      return 'hitJam';
    case 'SHUFFLE':
      return 'hitShuffle';
    case 'FOG':
      return 'hitFog';
    case 'LOCKOUT':
      return 'hitLockout';
    case 'POINT_TAX':
      return 'hitTax';
    case 'STAKE_CAP':
      return 'hitCap';
    case 'CUT':
      return 'hitCut';
    case 'BLIND_CLOCK':
      return 'hitBlind';
  }
}

/** Pitch helper for the engine's ambience voices. */
export const midiHz = midiToHz;
