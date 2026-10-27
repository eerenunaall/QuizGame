import { describe, expect, it } from 'vitest';
import { SABOTAGE_KINDS } from '@quizparty/protocol';
import { TARGET_PEAK_DB } from './mix';
import {
  SOUND_NAMES,
  durationOf,
  eventsFor,
  hitSoundFor,
  podiumEvents,
  revealEvents,
  type SoundEvent,
} from './palette';
import {
  C_MAJOR,
  correctArpeggio,
  degreeToMidi,
  hz,
  isInKey,
  joinDegree,
  midiToHz,
  streakGain,
  tickDegree,
} from './scale';
import {
  AMBIENCE_BAR_SECONDS,
  AmbienceScheduler,
  PODIUM_PLAN,
  REVEAL_ROLL_MS,
  ambienceBar,
  mulberry32,
  revealPlan,
  tickPlan,
} from './timeline';

describe('scale', () => {
  it('maps pentatonic degrees to C D E G A in every octave', () => {
    expect([0, 1, 2, 3, 4, 5].map(degreeToMidi)).toEqual([60, 62, 64, 67, 69, 72]);
    expect(degreeToMidi(-1)).toBe(57); // A3
    expect(degreeToMidi(-5)).toBe(48); // C3
    expect(hz(5)).toBeCloseTo(523.25, 1);
    expect(midiToHz(69)).toBe(440);
  });

  it('knows which frequencies belong to C major', () => {
    expect(isInKey(hz(3))).toBe(true);
    expect(isInKey(midiToHz(65))).toBe(true); // F, the pad's colour tone
    expect(isInKey(midiToHz(66))).toBe(false); // F#
    expect(isInKey(midiToHz(61))).toBe(false);
  });

  it('turns a streak into a longer, higher, louder arpeggio that never leaves the key', () => {
    expect(correctArpeggio(0)).toEqual(correctArpeggio(1));
    expect(correctArpeggio(1)).toHaveLength(4);
    expect(correctArpeggio(3).length).toBeGreaterThan(correctArpeggio(1).length);
    expect(correctArpeggio(99)).toHaveLength(8);
    const top = (streak: number): number => Math.max(...correctArpeggio(streak));
    expect(top(5)).toBeGreaterThan(top(2));
    for (const streak of [1, 2, 3, 5, 8]) {
      const run = correctArpeggio(streak);
      expect([...run].sort((a, b) => a - b)).toEqual(run);
      for (const degree of run) expect(isInKey(hz(degree))).toBe(true);
    }
    expect(streakGain(1)).toBe(1);
    expect(streakGain(99)).toBeLessThanOrEqual(1.1);
    expect(streakGain(4)).toBeGreaterThan(streakGain(2));
  });

  it('raises the tick pitch one rung per second over the last five', () => {
    expect(tickDegree(9)).toBe(10);
    expect(tickDegree(6)).toBe(10);
    const pitches = [5, 4, 3, 2, 1].map(tickDegree);
    expect(pitches).toEqual([...pitches].sort((a, b) => a - b));
    expect(new Set(pitches).size).toBe(5);
    expect(tickDegree(0)).toBe(tickDegree(1));
  });

  it('lets each arriving player climb the scale and wraps after an octave', () => {
    expect([0, 1, 2, 3, 4, 5].map(joinDegree)).toEqual([5, 6, 7, 8, 9, 5]);
  });
});

describe('palette', () => {
  const PITCHED = new Set(['bell', 'mallet', 'pad']);

  it('has a recipe, a mix target and well-formed events for every cue', () => {
    for (const name of SOUND_NAMES) {
      const events = eventsFor(name);
      expect(events.length, name).toBeGreaterThan(0);
      expect(TARGET_PEAK_DB[name], name).toBeLessThan(0);
      for (const event of events) {
        expect(event.at, name).toBeGreaterThanOrEqual(0);
        expect(event.dur, name).toBeGreaterThan(0);
        expect(event.gain, name).toBeGreaterThan(0);
        expect(event.gain, name).toBeLessThanOrEqual(1);
        expect(Number.isFinite(event.hz), name).toBe(true);
      }
      // a cue is short enough never to hold up a phase (the longest is the 2.5 s final sting)
      expect(durationOf(events), name).toBeLessThan(3);
    }
  });

  it('keeps every pitched voice (and its glide target) inside C major', () => {
    const check = (name: string, events: SoundEvent[]): void => {
      for (const event of events) {
        if (!PITCHED.has(event.voice)) continue;
        expect(isInKey(event.hz), `${name} ${event.voice} ${event.hz}`).toBe(true);
        if (event.to !== undefined)
          expect(isInKey(event.to), `${name} glide ${event.to}`).toBe(true);
      }
    };
    for (const name of SOUND_NAMES) check(name, eventsFor(name));
    for (const streak of [1, 2, 4, 6]) {
      check(`correct@${streak}`, eventsFor('correct', { streak }));
      check(`combo@${streak}`, eventsFor('combo', { streak }));
    }
    for (const order of [0, 1, 2, 3, 4, 5, 6]) check(`join@${order}`, eventsFor('join', { order }));
    for (const step of [9, 5, 4, 3, 2, 1]) check(`tick@${step}`, eventsFor('tick', { step }));
    for (let n = 0; n < 8; n++)
      for (const note of ambienceBar(n, mulberry32(n))) {
        expect(C_MAJOR as readonly number[]).toContain(note.midi % 12);
      }
  });

  it('makes a hot streak sound bigger than a first correct answer', () => {
    const first = eventsFor('correct', { streak: 1 });
    const hot = eventsFor('correct', { streak: 5 });
    expect(hot.length).toBeGreaterThan(first.length);
    expect(Math.max(...hot.map((e) => e.hz))).toBeGreaterThan(Math.max(...first.map((e) => e.hz)));
  });

  it('gives every sabotage kind its own hit cue from one family', () => {
    const cues = SABOTAGE_KINDS.map(hitSoundFor);
    expect(new Set(cues).size).toBe(SABOTAGE_KINDS.length);
    for (const cue of cues) expect(SOUND_NAMES).toContain(cue);
  });

  it('keeps the original keys', () => {
    for (const key of [
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
    ])
      expect(SOUND_NAMES).toContain(key);
  });

  it('renders the same events every time (no hidden randomness)', () => {
    for (const name of SOUND_NAMES) expect(eventsFor(name)).toEqual(eventsFor(name));
  });
});

describe('revealPlan', () => {
  it('dims the wrong options one after another, then lights the right one', () => {
    const plan = revealPlan(4, 2);
    expect(plan.dimAt[2]).toBeNull();
    const dims = plan.dimAt.filter((at): at is number => at !== null);
    expect(dims).toHaveLength(3);
    expect(dims[0]).toBe(REVEAL_ROLL_MS);
    expect([...dims].sort((a, b) => a - b)).toEqual(dims);
    expect(new Set(dims).size).toBe(3);
    expect(plan.hitAt).toBeGreaterThan(dims[2]!);
    expect(plan.totalMs).toBeGreaterThan(plan.hitAt);
  });

  it('stays quick: the build-up finishes before the explanation card takes over at 1.8 s', () => {
    for (const count of [2, 3, 4, 6, 8]) {
      for (let correct = 0; correct < count; correct++)
        expect(revealPlan(count, correct).hitAt, `${count}/${correct}`).toBeLessThan(1500);
    }
  });

  it('handles an unknown correct option and tiny inputs', () => {
    expect(revealPlan(0, 0).dimAt).toEqual([]);
    expect(revealPlan(1, 0).dimAt).toEqual([null]);
    expect(revealPlan(3, -1).dimAt.every((at) => at !== null)).toBe(true);
  });

  it('turns the plan into one score with the hit at the planned time', () => {
    const plan = revealPlan(4, 1);
    const events = revealEvents(plan, { correct: true, streak: 3 });
    const hit = events.filter(
      (e) => e.voice === 'thump' && Math.abs(e.at - plan.hitAt / 1000) < 0.001,
    );
    expect(hit.length).toBeGreaterThan(0);
    // outcome follows the hit, never precedes it
    const bells = events.filter((e) => e.voice === 'bell').map((e) => e.at);
    expect(Math.min(...bells)).toBeGreaterThanOrEqual(plan.hitAt / 1000);
    const wrong = revealEvents(plan, { correct: false });
    expect(Math.max(...wrong.map((e) => e.hz))).toBeLessThan(Math.max(...events.map((e) => e.hz)));
  });
});

describe('tickPlan', () => {
  it('speeds up as the clock runs out', () => {
    expect(tickPlan(9).offsets).toEqual([0]);
    expect(tickPlan(5).offsets).toEqual([0, 0.5]);
    expect(tickPlan(4).offsets).toEqual([0, 0.5]);
    expect(tickPlan(3).offsets).toEqual([0, 0.25, 0.5, 0.75]);
    expect(tickPlan(1).offsets).toHaveLength(4);
    expect(tickPlan(0).offsets).toEqual([]);
    const density = [9, 5, 3].map((s) => tickPlan(s).offsets.length);
    expect(density).toEqual([...density].sort((a, b) => a - b));
  });
});

describe('podiumEvents', () => {
  it('lands third, second, then the winner, and skips places nobody holds', () => {
    const times = (places: number): number[] =>
      podiumEvents(places)
        .filter((e) => e.voice === 'thump' && e.gain > 0.2)
        .map((e) => e.at);
    expect(Math.min(...times(3))).toBeGreaterThanOrEqual(PODIUM_PLAN.placeAt[3] / 1000 - 0.001);
    expect(podiumEvents(1).length).toBeLessThan(podiumEvents(3).length);
    expect(podiumEvents(0)).toEqual([]);
    expect(PODIUM_PLAN.placeAt[3]).toBeLessThan(PODIUM_PLAN.placeAt[2]);
    expect(PODIUM_PLAN.placeAt[2]).toBeLessThan(PODIUM_PLAN.placeAt[1]);
    expect(PODIUM_PLAN.rollAt).toBeGreaterThan(PODIUM_PLAN.placeAt[2]);
  });
});

describe('ambience', () => {
  it('walks C, Am, F, G and wraps', () => {
    const roots = [0, 1, 2, 3, 4].map(
      (bar) =>
        ambienceBar(bar, () => 1)
          .filter((n) => n.kind === 'pad')
          .map((n) => n.midi % 12)[0],
    );
    expect(roots).toEqual([0, 9, 5, 7, 0]);
  });

  it('is repeatable for a given seed', () => {
    expect(ambienceBar(2, mulberry32(7))).toEqual(ambienceBar(2, mulberry32(7)));
  });

  it('schedules bars ahead of the clock without gaps or repeats', () => {
    let now = 10;
    const scheduled: { bar: number; at: number }[] = [];
    let bar = 0;
    const scheduler = new AmbienceScheduler(
      () => now,
      (_notes, at) => scheduled.push({ bar: bar++, at }),
      mulberry32(1),
      3,
    );
    scheduler.tick();
    scheduler.tick();
    const first = scheduled.length;
    expect(first).toBeGreaterThanOrEqual(1);
    expect(scheduled[0]!.at).toBeGreaterThanOrEqual(10);
    now += 30;
    scheduler.tick();
    expect(scheduled.length).toBeGreaterThan(first);
    for (let i = 1; i < scheduled.length; i++)
      expect(scheduled[i]!.at - scheduled[i - 1]!.at).toBeCloseTo(AMBIENCE_BAR_SECONDS, 6);
    // the last scheduled bar starts within the lookahead window
    expect(scheduled[scheduled.length - 1]!.at).toBeLessThan(now + 3);
    expect(scheduled[scheduled.length - 1]!.at + AMBIENCE_BAR_SECONDS).toBeGreaterThanOrEqual(
      now + 3,
    );
  });
});
