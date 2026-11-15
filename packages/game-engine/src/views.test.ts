import { describe, expect, it } from 'vitest';
import {
  RoomViewSchema,
  SERVER_PAYLOADS,
  scanForbiddenKeys,
  type Phase,
  type ServerEvent,
} from '@quizparty/protocol';
import { Harness, makeDeck } from './testing';
import type { Effect } from './types';

/** Phases whose payloads may legitimately contain correctness and score information. */
const POST_REVEAL: ReadonlySet<Phase> = new Set(['REVEAL', 'POWER_RESOLUTION', 'SCORE_UPDATE']);

const currentPhase = (h: Harness): Phase => h.state.phase;

const emitted = (effects: Effect[]): ServerEvent[] =>
  effects.flatMap((effect) => (effect.kind === 'emit' ? [effect.event] : []));

interface Observation {
  phase: Phase;
  events: ServerEvent[];
  views: unknown[];
}

/** Plays a whole game with every player answering, observing events and views at every step. */
function observeGame(h: Harness, stopAt: Phase | null = null): Observation[] {
  const ids = h.state.playerOrder.slice();
  const observations: Observation[] = [];
  const observe = (from: number) => {
    observations.push({
      phase: h.state.phase,
      events: emitted(h.effects.slice(from)),
      views: [
        h.view({ role: 'DISPLAY' }),
        ...ids.map((id) => h.view({ role: 'PLAYER', playerId: id })),
      ],
    });
  };
  for (
    let guard = 0;
    guard < 3000 && h.state.phase !== 'RESULTS' && h.state.phase !== stopAt;
    guard++
  ) {
    const from = h.effects.length;
    if (!h.step()) break;
    observe(from);
    if (h.state.phase === 'ANSWERING') {
      const question = h.round().question!;
      for (const [index, id] of ids.entries()) {
        const mark = h.effects.length;
        h.command(
          h.actor(id),
          {
            type: 'SUBMIT_ANSWER',
            payload: {
              questionId: question.questionId,
              optionId: question.options[index % 4]!.optionId,
            },
          },
          h.now + 100 * (index + 1),
        );
        observe(mark);
      }
    }
  }
  return observations;
}

/** Path of the first difference between two JSON values, or null when they are equal. */
function firstDifference(a: unknown, b: unknown, path = '$'): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const found = firstDifference(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (found) return found;
    }
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`;
}

describe('views: schema conformance', () => {
  it('every view and every emitted event validates against the strict protocol schemas', () => {
    const h = new Harness();
    h.joinPlayers(3);
    h.start();
    const observations = observeGame(h);
    expect(observations.length).toBeGreaterThan(50);
    for (const observation of observations) {
      for (const view of observation.views) {
        const parsed = RoomViewSchema.safeParse(view);
        expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 2))).toBe(true);
        expect((view as { phase: string }).phase).toBe(
          (view as { phaseData: { phase: string } }).phaseData.phase,
        );
      }
      for (const event of observation.events) {
        const schema = SERVER_PAYLOADS[event.type];
        const parsed = schema.safeParse(event.payload);
        expect(
          parsed.success,
          `${event.type}: ${JSON.stringify(parsed.error?.issues.slice(0, 2))}`,
        ).toBe(true);
      }
    }
  });
});

describe('views: nothing secret leaves before the reveal', () => {
  it('no forbidden key appears in any event or view of a pre-reveal phase', () => {
    const h = new Harness();
    h.joinPlayers(4);
    h.start();
    const observations = observeGame(h);
    let preReveal = 0;
    for (const observation of observations) {
      if (POST_REVEAL.has(observation.phase)) continue;
      preReveal += 1;
      expect(scanForbiddenKeys(observation.events), `events in ${observation.phase}`).toEqual([]);
      expect(scanForbiddenKeys(observation.views), `views in ${observation.phase}`).toEqual([]);
    }
    expect(preReveal).toBeGreaterThan(40);
  });

  it('internal identifiers never appear in a view: option keys, session ids, nickname keys, deck, entropy', () => {
    const h = new Harness();
    h.joinPlayers(3);
    h.start();
    const observations = observeGame(h);
    const forbidden = [
      /q\d+-o\d/,
      /s-p\d/,
      /nicknameKey/,
      /"deck"/,
      /entropy/,
      /"rng"/,
      /sessionId/,
    ];
    for (const observation of observations) {
      const text = JSON.stringify([observation.views, observation.events]);
      for (const pattern of forbidden)
        expect(text, `${pattern} in ${observation.phase}`).not.toMatch(pattern);
    }
  });

  it('the display and every phone receive identical public question data (no per-viewer leakage)', () => {
    const h = new Harness();
    h.joinPlayers(3);
    h.start();
    h.runUntil('ANSWERING');
    const display = h.view({ role: 'DISPLAY' }).phaseData;
    for (const id of h.state.playerOrder) {
      expect(h.view({ role: 'PLAYER', playerId: id }).phaseData).toEqual(display);
    }
  });

  it('noninterference: two worlds that differ only in which option is correct are indistinguishable until REVEAL', () => {
    const worldA = new Harness();
    const worldB = new Harness();
    for (const h of [worldA, worldB]) h.joinPlayers(3);
    worldA.startWith(makeDeck(24, { correctIndexOf: (i) => i % 4 }));
    worldB.startWith(makeDeck(24, { correctIndexOf: (i) => (i + 1) % 4 }));

    const drive = (h: Harness) => {
      const log: string[] = [];
      for (let guard = 0; guard < 400 && h.state.phase !== 'REVEAL'; guard++) {
        const from = h.effects.length;
        h.step();
        if (currentPhase(h) === 'REVEAL') break; // the reveal itself legitimately differs between worlds
        log.push(
          JSON.stringify([
            h.state.phase,
            emitted(h.effects.slice(from)),
            h.view({ role: 'DISPLAY' }),
            ...h.state.playerOrder.map((id) => h.view({ role: 'PLAYER', playerId: id })),
          ]),
        );
        if (h.state.phase === 'ANSWERING') {
          const question = h.round().question!;
          for (const [index, id] of h.state.playerOrder.entries()) {
            const mark = h.effects.length;
            h.command(
              h.actor(id),
              {
                type: 'SUBMIT_ANSWER',
                payload: {
                  questionId: question.questionId,
                  optionId: question.options[index % 4]!.optionId,
                },
              },
              h.now + 250 * (index + 1),
            );
            log.push(
              JSON.stringify([
                emitted(h.effects.slice(mark)),
                h.view({ role: 'PLAYER', playerId: id }),
              ]),
            );
          }
        }
      }
      return log;
    };

    const logA = drive(worldA);
    const logB = drive(worldB);
    expect(worldA.state.phase).toBe('REVEAL');
    expect(worldB.state.phase).toBe('REVEAL');
    // The worlds really do differ internally…
    expect(worldA.correctOptionId()).not.toBe(worldB.correctOptionId());
    // …yet everything a client could observe up to the reveal is byte-identical.
    expect(logA.length).toBeGreaterThanOrEqual(7);
    expect(logB.length).toBe(logA.length);
    logA.forEach((entry, index) => {
      expect(
        firstDifference(JSON.parse(logB[index]!), JSON.parse(entry)),
        `observation #${index}`,
      ).toBeNull();
    });
  });

  it('a player sees only their own lock-in; others see only who has answered, never what', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(3) as [string, string, string];
    h.start();
    h.runUntil('ANSWERING');
    const mark = h.effects.length;
    h.answer(a, 'correct');
    const newEvents = h.effects
      .slice(mark)
      .flatMap((effect) => (effect.kind === 'emit' ? [effect] : []));
    const toOthers = newEvents.filter((e) => e.audience.to === 'ALL').map((e) => e.event);
    expect(JSON.stringify(toOthers)).not.toContain(h.correctOptionId());
    expect(toOthers.some((e) => e.type === 'ANSWER_LOCKED')).toBe(true);
    const bView = h.view({ role: 'PLAYER', playerId: b });
    expect(bView.you?.answer).toBeNull();
    expect(h.view({ role: 'PLAYER', playerId: a }).you?.answer?.optionId).toBe(h.correctOptionId());
    expect(h.view({ role: 'DISPLAY' }).you).toBeNull();
  });
});

describe('views: reconnect snapshots', () => {
  it('a snapshot taken mid-question restores the same public state a live client would hold', () => {
    const h = new Harness();
    const ids = h.joinPlayers(3);
    h.start();
    h.runUntil('ANSWERING');
    h.answer(ids[0]!, 'correct');
    const snapshot = h.view({ role: 'PLAYER', playerId: ids[0]! });
    expect(snapshot.phase).toBe('ANSWERING');
    expect(snapshot.you?.answer).toMatchObject({ optionId: h.correctOptionId() });
    expect(snapshot.phaseData).toMatchObject({ phase: 'ANSWERING', answeredPlayerIds: [ids[0]] });
    expect(snapshot.phaseDeadlineAt).toBe(h.state.phaseDeadlineAt);
    expect(RoomViewSchema.safeParse(snapshot).success).toBe(true);
  });
});
