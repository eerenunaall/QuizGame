/**
 * Timing shared by sound and picture. The reveal, the countdown and the podium are choreographed
 * on one timeline: the CSS reads these numbers as animation delays and the audio engine schedules
 * its events at the same offsets, so what you hear lands on what you see. Pure: no clock, no DOM.
 */
import { degreeToMidi } from './scale';

/** Small deterministic PRNG (mulberry32): noise, ambience and any "random" detail are repeatable. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───────── answer reveal ───────── */

export interface RevealPlan {
  /** Length of the drum roll before the first wrong option dims. */
  rollMs: number;
  /** Per option (display order): when it dims; `null` for the correct one. */
  dimAt: (number | null)[];
  /** When the correct card is lit: the drum hits, the card pops, the faces appear. */
  hitAt: number;
  /** Delay of the n-th chooser face / badge after the hit (a short stagger, in ms). */
  popStepMs: number;
  /** Everything has landed by this offset. */
  totalMs: number;
}

export const REVEAL_ROLL_MS = 480;
const DIM_SPAN_MS = 640;
const DIM_STEP_MIN_MS = 110;
const DIM_STEP_MAX_MS = 230;
const HIT_GAP_MS = 140;
const POP_STEP_MS = 70;

/**
 * Wrong options dim one by one (in display order, the correct one is skipped), then the correct
 * card lights up. The whole build-up stays under ~1.3 s so the explanation card (which takes over
 * at 1.8 s) never waits for it.
 */
export function revealPlan(optionCount: number, correctIndex: number): RevealPlan {
  const count = Math.max(0, Math.floor(optionCount));
  const wrong = Math.max(0, count - (correctIndex >= 0 && correctIndex < count ? 1 : 0));
  const step =
    wrong === 0 ? 0 : Math.min(DIM_STEP_MAX_MS, Math.max(DIM_STEP_MIN_MS, DIM_SPAN_MS / wrong));
  let n = 0;
  const dimAt = Array.from({ length: count }, (_, index) =>
    index === correctIndex ? null : REVEAL_ROLL_MS + step * n++,
  );
  const hitAt = REVEAL_ROLL_MS + step * wrong + HIT_GAP_MS;
  return { rollMs: REVEAL_ROLL_MS, dimAt, hitAt, popStepMs: POP_STEP_MS, totalMs: hitAt + 600 };
}

/* ───────── countdown ticks ───────── */

export interface TickPlan {
  /** Offsets (seconds after the whole second begins) of each tick inside that second. */
  offsets: number[];
  /** Which of them carries the accent (the downbeat). */
  accent: number;
}

/**
 * The ticks inside the second that starts with `secondsLeft` on the clock. Above 5 s: one soft tick
 * per second. 5 and 4 s: two (every half second). The last 3 s: four, a quarter second apart, so the
 * pulse audibly speeds up when it matters. Offsets are relative to the start of the second.
 */
export function tickPlan(secondsLeft: number): TickPlan {
  if (secondsLeft > 5) return { offsets: [0], accent: 0 };
  if (secondsLeft > 3) return { offsets: [0, 0.5], accent: 0 };
  if (secondsLeft >= 1) return { offsets: [0, 0.25, 0.5, 0.75], accent: 0 };
  return { offsets: [], accent: 0 };
}

/* ───────── podium ───────── */

export interface PodiumPlan {
  /** When each place lands, in ms (third first, the winner last). */
  placeAt: Record<1 | 2 | 3, number>;
  /** The drum roll that leads into the winner starts here. */
  rollAt: number;
  /** Confetti cannons and the fanfare fire here (the winner lands). */
  celebrateAt: number;
}

export const PODIUM_PLAN: PodiumPlan = {
  placeAt: { 3: 350, 2: 1250, 1: 2500 },
  rollAt: 1650,
  celebrateAt: 2500,
};

/* ───────── lobby ambience ───────── */

export interface AmbienceNote {
  /** Seconds after the start of the bar. */
  at: number;
  kind: 'pad' | 'twinkle';
  /** MIDI note (all of them inside C major). */
  midi: number;
  dur: number;
}

/** C, Am, F, G as MIDI chords: low root, then a close voicing that moves by step between chords. */
const PROGRESSION: readonly (readonly number[])[] = [
  [48, 55, 64, 67], // C  : C3 G3 E4 G4
  [45, 55, 64, 69], // Am : A2 G3 E4 A4
  [41, 57, 65, 69], // F  : F2 A3 F4 A4
  [43, 55, 62, 67], // G  : G2 G3 D4 G4
];

/** Tempo of the ambience: 66 bpm, 4 beats per bar. */
export const AMBIENCE_BAR_SECONDS = (60 / 66) * 4;

/**
 * One bar of lobby ambience: a sustained pad on the chord of the bar and, now and then, a soft music
 * box twinkle from the pentatonic set. `rng` makes the twinkles repeatable in tests.
 */
export function ambienceBar(barIndex: number, rng: () => number): AmbienceNote[] {
  const chord =
    PROGRESSION[((barIndex % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length]!;
  const notes: AmbienceNote[] = chord.map((midi, index) => ({
    at: index * 0.04,
    kind: 'pad',
    midi,
    dur: AMBIENCE_BAR_SECONDS * 1.15,
  }));
  const beat = AMBIENCE_BAR_SECONDS / 4;
  for (let i = 0; i < 4; i++) {
    if (rng() < 0.45) {
      notes.push({
        at: i * beat + beat * 0.5,
        kind: 'twinkle',
        midi: degreeToMidi(10 + Math.floor(rng() * 6)),
        dur: 1.4,
      });
    }
  }
  return notes;
}

/**
 * Keeps a few seconds of ambience scheduled ahead of the audio clock. `tick()` is called from a
 * timer; the scheduler only ever looks at the clock it is given, so tests drive it by hand.
 */
export class AmbienceScheduler {
  private nextBar = 0;
  private nextBarAt = 0;
  private started = false;

  private readonly clock: () => number;
  private readonly schedule: (notes: AmbienceNote[], at: number) => void;
  private readonly rng: () => number;
  private readonly lookaheadSeconds: number;

  constructor(
    clock: () => number,
    schedule: (notes: AmbienceNote[], at: number) => void,
    rng: () => number,
    lookaheadSeconds = 3,
  ) {
    this.clock = clock;
    this.schedule = schedule;
    this.rng = rng;
    this.lookaheadSeconds = lookaheadSeconds;
  }

  tick(): void {
    const now = this.clock();
    if (!this.started) {
      this.started = true;
      this.nextBarAt = now + 0.05;
    }
    while (this.nextBarAt < now + this.lookaheadSeconds) {
      this.schedule(ambienceBar(this.nextBar, this.rng), this.nextBarAt);
      this.nextBar += 1;
      this.nextBarAt += AMBIENCE_BAR_SECONDS;
    }
  }
}
