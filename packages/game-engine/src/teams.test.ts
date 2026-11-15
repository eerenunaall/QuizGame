import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AVATAR_IDS, TEAM_IDS, teamColorSlot, type TeamId } from '@quizparty/protocol';
import { rankTeams, teamCapacity, type TeamMemberScore } from './teams';

/** ADR-0026 §4: teams are ranked by average points per active member, exactly and without randomness. */
const member = (score: number, correctCount = 0, totalRemainingMs = 0): TeamMemberScore => ({
  score,
  correctCount,
  totalRemainingMs,
});

describe('team slots', () => {
  it('every team icon is an avatar the artwork exists for, and the colour slot is its position', () => {
    for (const id of TEAM_IDS) expect(AVATAR_IDS).toContain(id);
    expect(new Set(TEAM_IDS).size).toBe(TEAM_IDS.length);
    expect(TEAM_IDS.map(teamColorSlot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('shares the seats of the room evenly, rounded up, so no team can hold the whole room', () => {
    expect(teamCapacity(8, 2)).toBe(4);
    expect(teamCapacity(8, 3)).toBe(3);
    expect(teamCapacity(8, 4)).toBe(2);
    expect(teamCapacity(5, 2)).toBe(3);
    for (let max = 2; max <= 8; max++)
      for (let teams = 2; teams <= 4; teams++) {
        expect(teamCapacity(max, teams) * teams).toBeGreaterThanOrEqual(max);
        expect(teamCapacity(max, teams)).toBeLessThan(max);
      }
  });
});

describe('rankTeams', () => {
  it('ranks by the average, not by the total: a small strong team beats a large weak one', () => {
    const board = rankTeams([
      { teamId: 'tiger', members: [member(300), member(250), member(250)] }, // 800 / 3 = 267
      { teamId: 'owl', members: [member(500), member(400)] }, // 900 / 2 = 450
    ]);
    expect(board.map((t) => [t.teamId, t.rank, t.total, t.average, t.members])).toEqual([
      ['owl', 1, 900, 450, 2],
      ['tiger', 2, 800, 267, 3],
    ]);
  });

  it('rounds the average half up and shows the total beside it', () => {
    const [only] = rankTeams([{ teamId: 'fox', members: [member(1), member(2)] }]);
    expect(only).toMatchObject({ total: 3, average: 2 }); // 1.5 -> 2
    const [third] = rankTeams([{ teamId: 'fox', members: [member(1), member(0), member(0)] }]);
    expect(third).toMatchObject({ total: 1, average: 0 }); // 0.33 -> 0
  });

  it('leaves out a team without members and ranks a one-player team like any other', () => {
    const board = rankTeams([
      { teamId: 'tiger', members: [] },
      { teamId: 'owl', members: [member(120)] },
      { teamId: 'fox', members: [member(100), member(100)] },
    ]);
    expect(board.map((t) => t.teamId)).toEqual(['owl', 'fox']);
    expect(board[0]).toMatchObject({ rank: 1, average: 120, members: 1 });
  });

  it('breaks an equal average by correct answers per member, then by time left per member', () => {
    const byCorrect = rankTeams([
      { teamId: 'tiger', members: [member(100, 1), member(100, 1)] }, // 1 correct each
      { teamId: 'owl', members: [member(100, 3)] }, // 3 correct each
    ]);
    expect(byCorrect.map((t) => [t.teamId, t.rank])).toEqual([
      ['owl', 1],
      ['tiger', 2],
    ]);
    const byTime = rankTeams([
      { teamId: 'tiger', members: [member(100, 2, 1000)] },
      { teamId: 'owl', members: [member(100, 2, 9000), member(100, 2, 9000)] },
    ]);
    expect(byTime.map((t) => t.teamId)).toEqual(['owl', 'tiger']);
  });

  it('shares a rank only when average, correct and time left per member are all equal', () => {
    const board = rankTeams([
      { teamId: 'fox', members: [member(50, 1, 100)] },
      { teamId: 'owl', members: [member(50, 1, 100)] },
      { teamId: 'tiger', members: [member(10, 0, 0)] },
    ]);
    expect(board.map((t) => [t.teamId, t.rank])).toEqual([
      ['owl', 1],
      ['fox', 1],
      ['tiger', 3],
    ]);
  });

  it('ranks the two teams of a two-team game', () => {
    const board = rankTeams([
      { teamId: 'tiger', members: [member(0), member(0)] },
      { teamId: 'owl', members: [member(0), member(0)] },
    ]);
    expect(board.map((t) => t.rank)).toEqual([1, 1]);
    expect(board.map((t) => t.teamId)).toEqual(['tiger', 'owl']); // slot order is the list order only
  });

  it('never depends on the order the teams or the members are listed in', () => {
    const teamArb = fc.record({
      teamId: fc.constantFrom(...TEAM_IDS),
      members: fc.array(
        fc.record({
          score: fc.integer({ min: 0, max: 4000 }),
          correctCount: fc.integer({ min: 0, max: 20 }),
          totalRemainingMs: fc.integer({ min: 0, max: 300_000 }),
        }),
        { maxLength: 4 },
      ),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(teamArb, { selector: (t) => t.teamId, minLength: 1, maxLength: 4 }),
        fc.nat(),
        (teams, shift) => {
          const a = rankTeams(teams);
          const rotated = [
            ...teams.slice(shift % teams.length),
            ...teams.slice(0, shift % teams.length),
          ];
          const reversed = rotated.map((t) => ({ ...t, members: [...t.members].reverse() }));
          expect(rankTeams(reversed)).toEqual(a);
        },
      ),
    );
  });

  it('keeps total, average, rank and order consistent for any scores', () => {
    const arb = fc.uniqueArray(
      fc.record({
        teamId: fc.constantFrom<TeamId>(...TEAM_IDS),
        members: fc.array(
          fc.record({
            score: fc.integer({ min: 0, max: 5000 }),
            correctCount: fc.integer({ min: 0, max: 20 }),
            totalRemainingMs: fc.integer({ min: 0, max: 300_000 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
      }),
      { selector: (t) => t.teamId, minLength: 1, maxLength: 4 },
    );
    fc.assert(
      fc.property(arb, (teams) => {
        const board = rankTeams(teams);
        expect(board).toHaveLength(teams.length);
        // Totals are conserved: what the teams show adds up to what the members have.
        expect(board.reduce((sum, t) => sum + t.total, 0)).toBe(
          teams.reduce((sum, t) => sum + t.members.reduce((s, m) => s + m.score, 0), 0),
        );
        for (const row of board) {
          const source = teams.find((t) => t.teamId === row.teamId)!;
          expect(row.members).toBe(source.members.length);
          expect(Math.abs(row.average - row.total / row.members)).toBeLessThanOrEqual(0.5);
        }
        board.forEach((row, index) => {
          const prev = board[index - 1];
          if (!prev) return expect(row.rank).toBe(1);
          expect(prev.average).toBeGreaterThanOrEqual(row.average);
          expect(row.rank).toBeGreaterThanOrEqual(prev.rank);
          if (prev.average > row.average) expect(row.rank).toBe(index + 1);
        });
      }),
    );
  });
});
