/**
 * The one musical key of the game. Every pitched sound (bells, mallets, pads, even the "bonk") is
 * taken from C major, and every melody from its pentatonic subset (C D E G A, which is also
 * A minor pentatonic). Pentatonic notes never clash with each other or with the C/Am/F/G pads of the
 * lobby ambience, so overlapping cues (a phone and a TV answering at once) always stay consonant.
 */

/** Semitone offsets of the pentatonic degrees inside one octave. */
export const PENTATONIC = [0, 2, 4, 7, 9] as const;
/** Pitch classes (0 = C) of the whole C major scale: the key the pads may use. */
export const C_MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
/** MIDI note of degree 0 (C4). */
export const ROOT_MIDI = 60;
/** Degrees per octave of the melodic scale. */
export const DEGREES_PER_OCTAVE = PENTATONIC.length;

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Pentatonic degree to MIDI note: 0 = C4, 1 = D4, 2 = E4, 3 = G4, 4 = A4, 5 = C5, 10 = C6,
 * negative degrees go down (-1 = A3, -5 = C3).
 */
export function degreeToMidi(degree: number): number {
  const whole = Math.floor(degree / DEGREES_PER_OCTAVE);
  const rest = degree - whole * DEGREES_PER_OCTAVE;
  return ROOT_MIDI + whole * 12 + PENTATONIC[rest]!;
}

/** Frequency of a pentatonic degree. */
export function hz(degree: number): number {
  return midiToHz(degreeToMidi(degree));
}

/** True when the frequency sits (within a few cents) on a note of C major. */
export function isInKey(frequency: number): boolean {
  const midi = 69 + 12 * Math.log2(frequency / 440);
  if (Math.abs(midi - Math.round(midi)) > 0.06) return false;
  const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
  return (C_MAJOR as readonly number[]).includes(pitchClass);
}

/**
 * Notes of the "correct" arpeggio for a correct-answer streak. The base run is C E G C; every extra
 * step of the streak climbs one more rung of the same scale, up to two octaves above the root, so a
 * hot streak literally sounds higher and fuller.
 */
const ARPEGGIO_LADDER = [0, 2, 3, 5, 7, 8, 10, 12] as const;
export const MAX_STREAK_STEPS = ARPEGGIO_LADDER.length - 4;

export function streakSteps(streak: number): number {
  return Math.min(MAX_STREAK_STEPS, Math.max(0, Math.floor(streak) - 1));
}

export function correctArpeggio(streak: number): number[] {
  return ARPEGGIO_LADDER.slice(0, 4 + streakSteps(streak));
}

/** Loudness multiplier of a streak: a little hotter every step, never above +1.6 dB. */
export function streakGain(streak: number): number {
  return 1 + 0.02 * streakSteps(streak);
}

/**
 * Pitch of the countdown tick, as a pentatonic degree. It climbs one rung per second so the last
 * seconds literally rise in tension: 6 s or more sit at C6, 1 s is C7.
 */
export function tickDegree(secondsLeft: number): number {
  if (secondsLeft >= 6) return 10;
  if (secondsLeft <= 1) return 15;
  return 10 + (6 - secondsLeft);
}

/** Degree of the n-th player joining (the joins climb the scale and wrap after an octave). */
export function joinDegree(order: number): number {
  const step = Math.max(0, Math.floor(order)) % DEGREES_PER_OCTAVE;
  return 5 + step;
}
