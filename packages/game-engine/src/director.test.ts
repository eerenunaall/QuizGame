import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Rng, rngStateFromSeed } from '@quizparty/shared';
import { ROUND_KINDS, type RoundKind } from '@quizparty/protocol';
import { DEFAULT_GAME_CONFIG, finalStageLength, maxRoundsFor, presetOffset } from './config';
import {
  LEVEL_MAX,
  LEVEL_MIN,
  chooseRoundKind,
  corridorFor,
  direct,
  levelToBucket,
  type DirectorInput,
  type DirectorOutput,
} from './director';

const cfg = DEFAULT_GAME_CONFIG.director;

const start = (overrides: Partial<DirectorInput> = {}): DirectorInput => ({
  roundIndex: 0,
  totalRounds: 10,
  level: cfg.startLevel,
  recentCorrectPermille: [],
  recentAvgAnswerPermille: [],
  recentRiskTakePermille: [],
  chaos: 0,
  finalLength: 1,
  levelOffset: 0,
  ...overrides,
});

/** Plays a whole game with a scripted room performance and returns every output. */
function simulate(
  correctFor: (round: number) => number,
  totalRounds = 10,
  finalLength = 1,
  levelOffset = 0,
): DirectorOutput[] {
  const outputs: DirectorOutput[] = [];
  const correct: number[] = [];
  const speed: number[] = [];
  let level: number = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, cfg.startLevel + levelOffset));
  let chaos = 0;
  for (let round = 0; round < totalRounds; round++) {
    const out = direct(
      {
        roundIndex: round,
        totalRounds,
        level,
        recentCorrectPermille: correct,
        recentAvgAnswerPermille: speed,
        recentRiskTakePermille: [],
        chaos,
        finalLength,
        levelOffset,
      },
      cfg,
    );
    outputs.push(out);
    level = out.level;
    chaos = out.chaos;
    correct.push(correctFor(round));
    speed.push(600);
  }
  return outputs;
}

describe('levelToBucket', () => {
  it('maps milli-levels to buckets at the 1500/2500/3500 boundaries', () => {
    expect(levelToBucket(1000)).toBe('EASY');
    expect(levelToBucket(1499)).toBe('EASY');
    expect(levelToBucket(1500)).toBe('MEDIUM');
    expect(levelToBucket(2499)).toBe('MEDIUM');
    expect(levelToBucket(2500)).toBe('HARD');
    expect(levelToBucket(3499)).toBe('HARD');
    expect(levelToBucket(3500)).toBe('EXPERT');
    expect(levelToBucket(4000)).toBe('EXPERT');
  });
});

describe('direct', () => {
  it('starts easy and ramps over a neutral game', () => {
    const outputs = simulate(() => 550);
    expect(outputs[0]!.bucket).toBe('EASY');
    expect(outputs.at(-1)!.bucket).not.toBe('EASY');
    for (let i = 1; i < outputs.length; i++)
      expect(outputs[i]!.level).toBeGreaterThanOrEqual(outputs[i - 1]!.level);
  });

  it('raises difficulty faster when the room is cruising, slower when it struggles', () => {
    const cruising = simulate(() => 950).at(-1)!.level;
    const struggling = simulate(() => 100).at(-1)!.level;
    expect(cruising).toBeGreaterThan(struggling);
  });

  it('repeated total failure never produces an unplayable or out-of-corridor question', () => {
    const outputs = simulate(() => 0);
    outputs.forEach((out, round) => {
      const [low, high] = corridorFor(cfg, round, 10, 1);
      expect(out.level).toBeGreaterThanOrEqual(low);
      expect(out.level).toBeLessThanOrEqual(high);
      expect(out.level).toBeGreaterThanOrEqual(LEVEL_MIN);
    });
    expect(outputs.at(-1)!.chaos).toBeLessThanOrEqual(cfg.chaosMax);
    // failure raises chaos (comeback events), it does not make questions harder
    expect(outputs.at(-1)!.level).toBeLessThanOrEqual(corridorFor(cfg, 9, 10, 1)[1]);
  });

  it('grows the special-event chance with chaos but never in the first two rounds or the final', () => {
    const outputs = simulate(() => 0);
    expect(outputs[0]!.specialEventPermille).toBe(0);
    expect(outputs[1]!.specialEventPermille).toBe(0);
    expect(outputs[5]!.specialEventPermille).toBeGreaterThan(0);
    expect(outputs[9]!.specialEventPermille).toBe(0);
    expect(outputs[9]!.riskIntensity).toBe(3);
  });

  it('is deterministic and ignores unknown properties on its input', () => {
    const input = start({ roundIndex: 4, level: 2000, recentCorrectPermille: [800, 700, 900] });
    const noisy = {
      ...input,
      playerScores: { a: 9000 },
      leader: 'a',
      nickname: 'x',
    } as DirectorInput;
    expect(direct(noisy, cfg)).toEqual(direct(input, cfg));
    expect(direct(input, cfg)).toEqual(direct(input, cfg));
  });

  it('stays within bounds for arbitrary room histories', () => {
    const permille = fc.integer({ min: 0, max: 1000 });
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: LEVEL_MIN, max: LEVEL_MAX }),
        fc.array(permille, { maxLength: 10 }),
        fc.array(permille, { maxLength: 10 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 5 }),
        fc.constantFrom(-400, 0, 400),
        (totalRounds, roundRaw, level, correct, speed, chaos, finalRaw, levelOffset) => {
          const roundIndex = Math.min(roundRaw, totalRounds - 1);
          const finalLength = Math.min(finalRaw, totalRounds);
          const out = direct(
            {
              roundIndex,
              totalRounds,
              level,
              recentCorrectPermille: correct,
              recentAvgAnswerPermille: speed,
              recentRiskTakePermille: [],
              chaos,
              finalLength,
              levelOffset,
            },
            cfg,
          );
          const [low, high] = corridorFor(cfg, roundIndex, totalRounds, finalLength, levelOffset);
          expect(out.level).toBeGreaterThanOrEqual(low);
          expect(out.level).toBeLessThanOrEqual(high);
          expect(out.level % 1).toBe(0);
          expect(out.bucket).toBe(levelToBucket(out.level));
          expect(out.chaos).toBeGreaterThanOrEqual(0);
          expect(out.chaos).toBeLessThanOrEqual(cfg.chaosMax);
          expect(out.specialEventPermille).toBeGreaterThanOrEqual(0);
          expect(out.specialEventPermille).toBeLessThanOrEqual(cfg.specialMaxPermille);
          expect([0, 1, 2, 3]).toContain(out.riskIntensity);
          expect([0, 1]).toContain(out.varianceBuckets);
          const step = Math.abs(out.level - level);
          expect(step <= cfg.maxStep || out.level === low || out.level === high).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('corridorFor', () => {
  it('scales the corridor table to shorter games and uses the final corridor for the final stage', () => {
    expect(corridorFor(cfg, 9, 10, 1)).toEqual(cfg.finalCorridor);
    expect(corridorFor(cfg, 5, 6, 1)).toEqual(cfg.finalCorridor);
    expect(corridorFor(cfg, 0, 6, 1)).toEqual(cfg.corridors[0]);
    expect(corridorFor(cfg, 4, 6, 1)).toEqual(cfg.corridors.at(-1));
  });

  it('applies the final corridor to every question of a multi-question final stage', () => {
    for (const round of [7, 8, 9])
      expect(corridorFor(cfg, round, 10, 3)).toEqual(cfg.finalCorridor);
    expect(corridorFor(cfg, 6, 10, 3)).toEqual(cfg.corridors.at(-1));
    expect(corridorFor(cfg, 0, 10, 3)).toEqual(cfg.corridors[0]);
    for (const round of [10, 11, 12, 13, 14])
      expect(corridorFor(cfg, round, 15, 5)).toEqual(cfg.finalCorridor);
  });

  it('shifts and clamps corridors by the difficulty preset without inverting them', () => {
    for (let round = 0; round < 10; round++) {
      for (const offset of [-400, 0, 400, 2000, -2000]) {
        const [low, high] = corridorFor(cfg, round, 10, 3, offset);
        expect(low).toBeGreaterThanOrEqual(LEVEL_MIN);
        expect(high).toBeLessThanOrEqual(LEVEL_MAX);
        expect(low).toBeLessThanOrEqual(high);
      }
    }
    const [mediumLow] = corridorFor(cfg, 8, 10, 3, 0);
    expect(corridorFor(cfg, 8, 10, 3, 400)[0]).toBe(mediumLow + 400);
  });
});

describe('difficulty presets', () => {
  const average = (offset: number, correct: number): number => {
    const outputs = simulate(() => correct, 15, 5, offset);
    return outputs.reduce((sum, out) => sum + out.level, 0) / outputs.length;
  };

  it('EASY plays easier than MEDIUM, and MEDIUM easier than HARD, whatever the room does', () => {
    const easy = presetOffset(DEFAULT_GAME_CONFIG, 'EASY');
    const medium = presetOffset(DEFAULT_GAME_CONFIG, 'MEDIUM');
    const hard = presetOffset(DEFAULT_GAME_CONFIG, 'HARD');
    for (const correct of [100, 550, 950]) {
      expect(average(easy, correct)).toBeLessThan(average(medium, correct));
      expect(average(medium, correct)).toBeLessThan(average(hard, correct));
    }
  });

  it('keeps adapting inside the preset band instead of freezing the difficulty', () => {
    const outputs = simulate(() => 950, 15, 5, 400);
    expect(outputs.at(-1)!.level).toBeGreaterThan(outputs[0]!.level);
  });
});

describe('finalStageLength', () => {
  it.each([
    [3, 1],
    [5, 1],
    [6, 2],
    [9, 3],
    [10, 3],
    [12, 4],
    [15, 5],
    [20, 5],
  ])('a %i-question game ends with %i final question(s)', (total, expected) => {
    expect(finalStageLength(total, DEFAULT_GAME_CONFIG)).toBe(expected);
  });

  it('never exceeds the game length and always leaves at least one question outside', () => {
    for (let total = 3; total <= 20; total++) {
      const length = finalStageLength(total, DEFAULT_GAME_CONFIG);
      expect(length).toBeGreaterThanOrEqual(1);
      expect(length).toBeLessThan(total);
    }
  });

  it('caps rounds by tier: free rooms play short games, full rooms up to the hard cap', () => {
    expect(maxRoundsFor(DEFAULT_GAME_CONFIG, 'FREE')).toBe(5);
    expect(maxRoundsFor(DEFAULT_GAME_CONFIG, 'FULL')).toBe(20);
  });
});

describe('chooseRoundKind', () => {
  const pick = (
    history: RoundKind[],
    roundIndex: number,
    totalRounds = 10,
    specialEventPermille = 1000,
    seed = 'k',
    finalLength = 1,
  ) =>
    chooseRoundKind(
      { roundIndex, totalRounds, finalLength, history, specialEventPermille, riskIntensity: 1 },
      cfg,
      new Rng(rngStateFromSeed(seed)),
    );

  it('the last round is always the FINAL and nothing else is', () => {
    expect(pick(['STANDARD'], 9)).toBe('FINAL');
    for (let i = 0; i < 9; i++)
      expect(pick(Array(i).fill('STANDARD') as RoundKind[], i)).not.toBe('FINAL');
  });

  it('keeps the first two rounds standard and never chains two specials', () => {
    expect(pick([], 0)).toBe('STANDARD');
    expect(pick(['STANDARD'], 1)).toBe('STANDARD');
    expect(pick(['STANDARD', 'STANDARD', 'SPEED'], 3)).toBe('STANDARD');
  });

  it('respects per-kind caps over a whole game, for many seeds', () => {
    for (let s = 0; s < 200; s++) {
      const history: RoundKind[] = [];
      for (let round = 0; round < 10; round++) {
        history.push(pick(history, round, 10, 1000, `seed-${s}`));
      }
      expect(history.at(-1)).toBe('FINAL');
      const count = (kind: RoundKind) => history.filter((k) => k === kind).length;
      expect(count('SPEED')).toBeLessThanOrEqual(cfg.maxSpeedRounds);
      expect(count('CROWD')).toBeLessThanOrEqual(cfg.maxCrowdRounds);
      expect(count('RISK')).toBeLessThanOrEqual(cfg.maxRiskRounds);
      expect(count('RISK')).toBeGreaterThanOrEqual(1);
      expect(history.filter((k) => k === 'FINAL')).toHaveLength(1);
      for (let i = 1; i < 9; i++) {
        expect(history[i] !== 'STANDARD' && history[i - 1] !== 'STANDARD').toBe(false);
      }
    }
  });

  it('makes exactly the last `finalLength` questions FINAL, for every game length', () => {
    for (let total = 3; total <= 20; total++) {
      const finalLength = finalStageLength(total, DEFAULT_GAME_CONFIG);
      for (let s = 0; s < 20; s++) {
        const history: RoundKind[] = [];
        for (let round = 0; round < total; round++)
          history.push(pick(history, round, total, 1000, `len-${total}-${s}`, finalLength));
        expect(history.filter((kind) => kind === 'FINAL')).toHaveLength(finalLength);
        expect(history.slice(total - finalLength).every((kind) => kind === 'FINAL')).toBe(true);
        expect(history.slice(0, total - finalLength).some((kind) => kind === 'FINAL')).toBe(false);
      }
    }
  });

  it('only produces known kinds', () => {
    for (let s = 0; s < 50; s++)
      expect(ROUND_KINDS).toContain(pick(['STANDARD', 'STANDARD'], 3, 10, 1000, `s${s}`));
  });
});
