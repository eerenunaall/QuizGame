import { describe, expect, it } from 'vitest';
import type { Phase, RoundPublic } from '@quizparty/protocol';
import { DIFFICULTIES } from '@quizparty/protocol';
import { finalStageLength } from './config';
import { Harness, makeDeck, testConfig } from './testing';

/** Plays a whole game where `answer` decides, per round, what each player does. */
function playGame(
  h: Harness,
  total: number,
  answer?: (h: Harness, playerId: string, round: number) => void,
): { phases: Phase[]; rounds: RoundPublic[] } {
  const ids = Object.keys(h.state.players);
  const rounds: RoundPublic[] = [];
  for (let i = 0; i < total; i++) {
    h.runUntil('ANSWERING');
    const data = h.view({ role: 'DISPLAY' }).phaseData;
    if (data.phase === 'ANSWERING') rounds.push(data.round);
    if (answer) for (const id of ids) answer(h, id, i);
    h.runUntil(i === total - 1 ? 'RESULTS' : 'MICRO_INTERMISSION');
  }
  return { phases: h.phaseEvents(), rounds };
}

describe('lobby settings', () => {
  it('accepts up to 20 rounds on a full room, clamps free rooms and records the difficulty', () => {
    const full = new Harness({ tier: 'FULL' });
    const [leader] = full.joinPlayers(2) as [string, string];
    expect(full.state.settings).toMatchObject({ rounds: 10, difficulty: 'MEDIUM' });
    expect(
      full.command(full.actor(leader), {
        type: 'SET_SETTINGS',
        payload: { rounds: 20, difficulty: 'HARD' },
      }).ok,
    ).toBe(true);
    expect(full.state.settings).toMatchObject({ rounds: 20, difficulty: 'HARD' });
    expect(full.events('SETTINGS_CHANGED').at(-1)?.payload).toMatchObject({
      settings: { rounds: 20, difficulty: 'HARD' },
    });
    expect(full.view({ role: 'DISPLAY' }).limits).toEqual({ maxRounds: 20 });

    const free = new Harness({ tier: 'FREE' });
    const [freeLeader] = free.joinPlayers(2) as [string, string];
    free.command(free.actor(freeLeader), { type: 'SET_SETTINGS', payload: { rounds: 15 } });
    expect(free.state.settings.rounds).toBe(5);
    expect(free.view({ role: 'DISPLAY' }).limits).toEqual({ maxRounds: 5 });
  });

  it('changing only the difficulty keeps the rounds and categories', () => {
    const h = new Harness();
    const [leader] = h.joinPlayers(2) as [string, string];
    h.command(h.actor(leader), { type: 'SET_SETTINGS', payload: { rounds: 15 } });
    h.command(h.actor(leader), { type: 'SET_SETTINGS', payload: { difficulty: 'EASY' } });
    expect(h.state.settings).toMatchObject({ rounds: 15, difficulty: 'EASY', categories: 'ALL' });
  });
});

describe('final stage', () => {
  it.each([5, 10, 15, 20])(
    'a %i-question game ends with the configured number of final questions',
    (total) => {
      const h = new Harness({ config: testConfig() });
      const [leader] = h.joinPlayers(2) as [string, string];
      h.command(h.actor(leader), { type: 'SET_SETTINGS', payload: { rounds: total } });
      h.fulfilDeckRequests(makeDeck(60));
      h.command(h.actor(leader), { type: 'START_GAME', payload: {} });
      h.fulfilDeckRequests(makeDeck(60));
      const length = finalStageLength(total, h.state.config);
      expect(h.state.game!.totalRounds).toBe(total);
      expect(h.state.game!.finalLength).toBe(length);

      const { phases, rounds } = playGame(h, total);
      const finals = rounds.filter((round) => round.isFinal);
      expect(finals).toHaveLength(length);
      expect(rounds.slice(0, total - length).every((round) => !round.isFinal)).toBe(true);
      expect(finals.map((round) => round.finalStage)).toEqual(
        Array.from({ length }, (_, i) => ({ position: i + 1, length })),
      );
      expect(
        rounds.filter((round) => !round.isFinal).every((round) => round.finalStage === null),
      ).toBe(true);
      // the "Final" splash plays once, before the first final question only
      expect(phases.filter((phase) => phase === 'FINAL')).toHaveLength(1);
      const splashAt = phases.indexOf('FINAL');
      expect(phases.slice(0, splashAt).filter((phase) => phase === 'ANSWERING')).toHaveLength(
        total - length,
      );
      expect(phases.at(-1)).toBe('RESULTS');
    },
  );

  it('pays the final base and speed points on every final question', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(2) as [string, string];
    h.start();
    const { rounds } = playGame(h, 10, (harness, id, round) => {
      if (id === a && round !== 1) harness.answer(id, 'correct');
    });
    const standard = rounds.find((round) => !round.isFinal)!;
    for (const final of rounds.filter((round) => round.isFinal)) {
      expect(final.basePoints).toBe(standard.basePoints * 2);
      expect(final.speedMax).toBeGreaterThan(standard.speedMax);
    }
    expect(h.state.game!.players[a]!.score).toBeGreaterThan(0);
  });

  it('only the last final question puts points at stake by default', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(2) as [string, string];
    h.start();
    const deltas: number[] = [];
    for (let i = 0; i < 10; i++) {
      h.runUntil('ANSWERING');
      const before = h.state.game!.players[a]!.score;
      h.answer(a, i >= 7 ? 'wrong' : 'correct'); // right through question 7, wrong in the whole final
      h.runUntil(i === 9 ? 'RESULTS' : 'MICRO_INTERMISSION');
      deltas.push(h.state.game!.players[a]!.score - before);
    }
    expect(deltas.slice(0, 7).every((delta) => delta > 0)).toBe(true);
    expect(deltas[7]).toBe(0); // first final question: wrong costs nothing
    expect(deltas[8]).toBe(0); // second final question: wrong costs nothing
    expect(deltas[9]).toBeLessThan(0); // last question: the mandatory stake is lost
  });

  it('a player who stays silent loses nothing in the early final questions either', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    h.start();
    for (let i = 0; i < 10; i++) {
      h.runUntil('ANSWERING');
      h.answer(a, 'correct');
      h.runUntil(i === 9 ? 'RESULTS' : 'MICRO_INTERMISSION');
    }
    expect(h.state.game!.players[b]!.score).toBe(0); // never answered: nothing gained, nothing lost
  });
});

describe('difficulty preset', () => {
  const averageLevel = (preset: 'EASY' | 'MEDIUM' | 'HARD'): number => {
    const h = new Harness({ config: testConfig() });
    const [leader] = h.joinPlayers(2) as [string, string];
    h.command(h.actor(leader), {
      type: 'SET_SETTINGS',
      payload: { rounds: 15, difficulty: preset },
    });
    h.start();
    const buckets: number[] = [];
    for (let i = 0; i < 15; i++) {
      h.runUntil('ANSWERING');
      buckets.push(DIFFICULTIES.indexOf(h.round().question!.difficulty));
      for (const id of Object.keys(h.state.players)) h.answer(id, 'correct');
      h.runUntil(i === 14 ? 'RESULTS' : 'MICRO_INTERMISSION');
    }
    return buckets.reduce((sum, value) => sum + value, 0) / buckets.length;
  };

  it('hands out easier questions on EASY than MEDIUM than HARD, from the same deck', () => {
    const easy = averageLevel('EASY');
    const medium = averageLevel('MEDIUM');
    const hard = averageLevel('HARD');
    expect(easy).toBeLessThan(medium);
    expect(medium).toBeLessThan(hard);
  });

  it('is fixed when the game starts: changing the lobby setting later does not alter a running game', () => {
    const h = new Harness();
    const [leader] = h.joinPlayers(2) as [string, string];
    h.command(h.actor(leader), { type: 'SET_SETTINGS', payload: { difficulty: 'HARD' } });
    h.start();
    const offset = h.state.game!.director.levelOffset;
    expect(offset).toBe(400);
    expect(
      h.command(h.actor(leader), { type: 'SET_SETTINGS', payload: { difficulty: 'EASY' } }).ok,
    ).toBe(false);
    expect(h.state.game!.director.levelOffset).toBe(offset);
  });
});
