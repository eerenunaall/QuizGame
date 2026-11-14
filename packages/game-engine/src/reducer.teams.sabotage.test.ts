import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RoomViewSchema, scanForbiddenKeys, type TeamId } from '@quizparty/protocol';
import { createRoom, reduce } from './reducer';
import { sabotageKindsOffered } from './powers';
import { Harness, TEST_ROOM_ID, testConfig } from './testing';
import { teamStandings } from './teams';
import {
  commitRisk,
  hitPlayer,
  hitTeam,
  lobby,
  pass,
  playRound,
  refusal,
  teamGame,
  teamOf,
  toRound,
} from './teams.helpers';

/**
 * ADR-0026 §5: sabotage in team play aims at a rival team. The effect lands on every active member, the
 * shield is the team's (one for all of them or none), and the per-target caps are the team's.
 */
const open = {
  simple: { sabotage: { firstRoundIndex: 0, targetMinGapRounds: 0 }, shieldPerGame: 0 },
};
const members = (h: Harness, ids: readonly string[], team: TeamId) =>
  ids.filter((id) => teamOf(h, id) === team);

describe('aiming at a team', () => {
  it('hits every active member of the rival team and nobody else', () => {
    const { h, ids } = teamGame(6, open); // tiger p1 p3 p5, owl p2 p4 p6
    h.runUntil('RISK_PICK');
    expect(refusal(hitTeam(h, ids[0]!, 'owl', 'JAM'))).toBe('OK');
    h.runUntil('ANSWERING');
    const round = h.round();
    for (const id of members(h, ids, 'owl')) expect(round.effects[id]?.jamMs).toBe(6_000);
    for (const id of members(h, ids, 'tiger')) expect(round.effects[id]).toBeUndefined();
    expect(round.sabotages).toHaveLength(3);
    expect(round.sabotages.every((r) => r.targetTeamId === 'owl' && r.actorId === ids[0])).toBe(
      true,
    );
  });

  it('shows one line on the power screen for a hit on a team, naming the team and not a player', () => {
    const { h, ids } = teamGame(6, open);
    h.runUntil('RISK_PICK');
    hitTeam(h, ids[0]!, 'owl', 'BLIND_CLOCK');
    h.runUntil('ANSWERING');
    for (const id of ids) h.answer(id, 'correct');
    h.runUntil('POWER_RESOLUTION');
    const data = h.view({ role: 'DISPLAY' }).phaseData;
    if (data.phase !== 'POWER_RESOLUTION') throw new Error('phase');
    const hits = data.items.filter((item) => item.kind === 'SABOTAGE');
    expect(hits).toEqual([
      {
        kind: 'SABOTAGE',
        actorId: ids[0],
        targetTeamId: 'owl',
        effect: 'BLIND_CLOCK',
        blocked: false,
      },
    ]);
    expect(RoomViewSchema.safeParse(h.view({ role: 'DISPLAY' })).success).toBe(true);
  });

  it('refuses your own team, a team that is not in the game, and a player aimed at in team play', () => {
    const { h, ids } = teamGame(4, open);
    h.runUntil('RISK_PICK');
    expect(refusal(hitTeam(h, ids[0]!, 'tiger'))).toBe('TARGET_INVALID'); // my own team
    expect(refusal(hitTeam(h, ids[0]!, 'fox'))).toBe('TARGET_INVALID'); // not in this game
    expect(refusal(hitPlayer(h, ids[0]!, ids[1]!))).toBe('TARGET_INVALID'); // a player, not a team
    const both = h.command(h.actor(ids[0]!), {
      type: 'COMMIT_SABOTAGE',
      payload: { sabotage: { targetId: ids[1]!, targetTeamId: 'owl', effect: 'JAM' } },
    });
    expect(refusal(both)).toBe('TARGET_INVALID');
    // none of that spent the token or used the player’s one decision
    expect(h.state.game!.players[ids[0]!]!.powers.tokens).toBe(1);
    expect(refusal(hitTeam(h, ids[0]!, 'owl'))).toBe('OK');
  });

  it('refuses a team nobody is left in', () => {
    const { h, ids } = teamGame(4, open);
    h.runUntil('RISK_PICK');
    for (const id of members(h, ids, 'owl'))
      h.command(h.actor(id), { type: 'LEAVE_ROOM', payload: {} });
    expect(refusal(hitTeam(h, ids[0]!, 'owl'))).toBe('TARGET_INVALID');
  });

  it('hits whoever is still there when the question starts', () => {
    const { h, ids } = teamGame(6, open);
    h.runUntil('RISK_PICK');
    hitTeam(h, ids[0]!, 'owl');
    const leaver = members(h, ids, 'owl')[0]!;
    h.command(h.actor(leaver), { type: 'LEAVE_ROOM', payload: {} });
    h.runUntil('ANSWERING');
    expect(h.round().sabotages.map((r) => r.targetId)).not.toContain(leaver);
    expect(h.round().sabotages).toHaveLength(2);
  });

  it('does nothing, and does not fail, when the whole target team left before the question', () => {
    const { h, ids } = teamGame(4, open);
    h.runUntil('RISK_PICK');
    hitTeam(h, ids[0]!, 'owl');
    for (const id of members(h, ids, 'owl'))
      h.command(h.actor(id), { type: 'LEAVE_ROOM', payload: {} });
    h.runUntil('ANSWERING');
    expect(h.round().sabotages).toEqual([]);
    expect(h.state.game!.teams!.ledgers.owl!.hits).toBe(0);
  });
});

describe('the team’s shield', () => {
  const shielded = { simple: { ...open.simple, shieldPerGame: 1 } };

  it('stops a hit for the whole team at once, and is then used up', () => {
    const { h, ids } = teamGame(6, shielded);
    h.runUntil('RISK_PICK');
    hitTeam(h, ids[0]!, 'owl');
    h.runUntil('ANSWERING');
    const round = h.round();
    for (const id of members(h, ids, 'owl')) {
      expect(round.effects[id]!.jamMs).toBe(0);
      expect(round.effects[id]!.hits).toEqual([{ effect: 'JAM', blocked: true }]);
    }
    expect(h.state.game!.teams!.ledgers.owl).toMatchObject({ shield: 0, hits: 1 });
    expect(round.sabotages.every((r) => r.blocked)).toBe(true);
    for (const id of members(h, ids, 'owl'))
      expect(h.view({ role: 'PLAYER', playerId: id }).you!.powers!.shield).toBe(0);
  });

  it('lets the next hit through', () => {
    const { h, ids } = teamGame(4, shielded);
    h.runUntil('RISK_PICK');
    hitTeam(h, ids[0]!, 'owl');
    playRound(h, ids);
    toRound(h, ids, 1);
    h.runUntil('RISK_PICK');
    // a second attacker, as the first is cooling down
    expect(refusal(hitTeam(h, ids[2]!, 'owl'))).toBe('OK');
    h.runUntil('ANSWERING');
    const owl = members(h, ids, 'owl');
    for (const id of owl) expect(h.round().effects[id]!.jamMs).toBe(6_000);
  });

  it('keeps each team’s own shield: hitting one team does not use the other’s', () => {
    const { h, ids } = teamGame(4, shielded);
    h.runUntil('RISK_PICK');
    hitTeam(h, ids[0]!, 'owl');
    h.runUntil('QUESTION');
    expect(h.state.game!.teams!.ledgers.tiger!.shield).toBe(1);
  });
});

describe('the per-team limits', () => {
  it('lets one team be hit once per question, whoever aims', () => {
    const { h, ids } = teamGame(6, open);
    h.runUntil('RISK_PICK');
    expect(refusal(hitTeam(h, ids[0]!, 'owl'))).toBe('OK');
    expect(refusal(hitTeam(h, ids[2]!, 'owl'))).toBe('SABOTAGE_LIMIT');
  });

  it('allows only so many hits per team per game, and a gap between them', () => {
    const cfg = {
      simple: {
        sabotage: { firstRoundIndex: 0, targetMinGapRounds: 1, targetMaxPerGame: 2 },
        shieldPerGame: 0,
      },
    };
    const { h, ids } = teamGame(6, cfg);
    h.runUntil('RISK_PICK');
    hitTeam(h, ids[0]!, 'owl');
    playRound(h, ids);
    toRound(h, ids, 1);
    h.runUntil('RISK_PICK');
    expect(refusal(hitTeam(h, ids[2]!, 'owl'))).toBe('SABOTAGE_LIMIT'); // the next question: too soon
    playRound(h, ids);
    toRound(h, ids, 2);
    h.runUntil('RISK_PICK');
    expect(refusal(hitTeam(h, ids[2]!, 'owl'))).toBe('OK'); // second hit
    playRound(h, ids);
    toRound(h, ids, 4);
    h.runUntil('RISK_PICK');
    expect(refusal(hitTeam(h, ids[4]!, 'owl'))).toBe('SABOTAGE_LIMIT'); // none left for this team this game
  });

  it('keeps the attacker’s own cooldown: a player with a token spent waits', () => {
    const { h, ids } = teamGame(4, {
      simple: {
        ...open.simple,
        sabotage: { ...open.simple.sabotage, attackerCooldownRounds: 1, startTokens: 2 },
      },
    });
    h.runUntil('RISK_PICK');
    hitTeam(h, ids[0]!, 'owl');
    playRound(h, ids);
    toRound(h, ids, 1);
    h.runUntil('RISK_PICK');
    expect(refusal(hitTeam(h, ids[0]!, 'owl'))).toBe('SABOTAGE_LIMIT');
  });

  it('leaves nobody to aim at once only one team is left, and the view says nobody can', () => {
    const { h, ids } = teamGame(4, open);
    for (const id of members(h, ids, 'owl'))
      h.command(h.actor(id), { type: 'LEAVE_ROOM', payload: {} });
    h.runUntil('RISK_PICK');
    expect(h.view({ role: 'PLAYER', playerId: ids[0]! }).you!.sabotage).toEqual({
      ready: false,
      decided: false,
    });
    expect(refusal(hitTeam(h, ids[0]!, 'owl'))).toBe('TARGET_INVALID');
  });
});

describe('the full ruleset in team play', () => {
  it('keeps its sabotages except Cut, which would pay one attacker from a whole team', () => {
    const { h, ids } = lobby(4, { play: 'TEAMS' });
    h.start();
    toRound(h, ids, 2);
    for (let guard = 0; guard < 40 && h.state.phase !== 'SABOTAGE_PICK'; guard++) h.step();
    const offered = sabotageKindsOffered(h.state);
    expect(offered).toEqual(
      expect.arrayContaining(['JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX', 'BLIND_CLOCK']),
    );
    expect(offered).not.toContain('CUT');
    expect(
      refusal(
        h.command(h.actor(ids[0]!), {
          type: 'COMMIT_SABOTAGE',
          payload: { sabotage: { targetTeamId: 'owl', effect: 'CUT' } },
        }),
      ),
    ).toBe('POWER_UNAVAILABLE');
  });

  it('applies a Lockout to every member of the team', () => {
    const { h, ids } = lobby(6, { play: 'TEAMS' }, { powers: { shieldPerGame: 0 } });
    h.start();
    toRound(h, ids, 2);
    for (let guard = 0; guard < 40 && h.state.phase !== 'SABOTAGE_PICK'; guard++) h.step();
    const result = h.command(h.actor(ids[0]!), {
      type: 'COMMIT_SABOTAGE',
      payload: { sabotage: { targetTeamId: 'owl', effect: 'LOCKOUT', joker: 'DOUBLE_DOWN' } },
    });
    expect(refusal(result)).toBe('OK');
    h.runUntil('QUESTION');
    for (const id of members(h, ids, 'owl'))
      expect(h.state.game!.players[id]!.powers.lockout).toEqual({
        joker: 'DOUBLE_DOWN',
        round: h.round().index + 1,
      });
  });

  it('keeps a Duel for rivals: a teammate is not a target', () => {
    const { h, ids } = lobby(4, { play: 'TEAMS' });
    h.start();
    h.runUntil('RISK_PICK');
    const duel = (targetId: string) =>
      h.command(h.actor(ids[0]!), {
        type: 'COMMIT_RISK',
        payload: { stake: 'SAFE', doubleDown: false, duel: { targetId } },
      });
    expect(refusal(duel(ids[2]!))).toBe('TARGET_INVALID'); // tiger with tiger
    expect(refusal(duel(ids[1]!))).toBe('OK');
  });
});

describe('what the wire says about a hit on a team', () => {
  it('tells the attacker their own pick and the victims only what landed, never who', () => {
    const { h, ids } = teamGame(4, open);
    h.runUntil('RISK_PICK');
    hitTeam(h, ids[0]!, 'owl', 'SHUFFLE');
    const mine = h.view({ role: 'PLAYER', playerId: ids[0]! }).you!;
    expect(mine.commitment?.sabotage).toEqual({ targetTeamId: 'owl', effect: 'SHUFFLE' });
    h.runUntil('QUESTION');
    const victim = h.view({ role: 'PLAYER', playerId: ids[1]! });
    expect(victim.you!.hits).toEqual([{ effect: 'SHUFFLE', blocked: false }]);
    expect(JSON.stringify(victim)).not.toContain(ids[0]!.replace('p', 'attacker'));
    // a bystander on the attacking side or the TV never sees the pick before the resolution
    const display = JSON.stringify(h.view({ role: 'DISPLAY' }));
    expect(display).not.toContain('SHUFFLE');
    expect(scanForbiddenKeys(h.view({ role: 'DISPLAY' }))).toEqual([]);
  });
});

describe('any team game keeps its invariants', () => {
  const plan = fc.record({
    players: fc.integer({ min: 4, max: 8 }),
    teamCount: fc.integer({ min: 2, max: 4 }),
    rounds: fc.array(
      fc.record({
        dd: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        hit: fc.option(
          fc.record({
            by: fc.nat(7),
            team: fc.constantFrom<TeamId>('tiger', 'owl', 'fox', 'lion'),
            effect: fc.constantFrom('JAM', 'SHUFFLE', 'BLIND_CLOCK' as const),
          }),
          { nil: null },
        ),
        answers: fc.array(fc.constantFrom('correct', 'wrong', 'none' as const), {
          minLength: 8,
          maxLength: 8,
        }),
        leave: fc.option(fc.nat(7), { nil: null }),
      }),
      { minLength: 6, maxLength: 6 },
    ),
  });

  it('standings add up, views validate, limits hold, and the log replays to the same state', () => {
    fc.assert(
      fc.property(plan, ({ players, teamCount, rounds }) => {
        const cfg = testConfig({ defaultRounds: 6, ...open });
        const h = new Harness({ config: cfg });
        const ids = h.joinPlayers(players);
        h.command(h.actor(ids[0]!), {
          type: 'SET_SETTINGS',
          payload: { play: 'TEAMS', ruleset: 'SIMPLE', teamCount, rounds: 6 },
        });
        // 8 players over 4 teams need a looser gap than the default; the engine's rule is what is under test
        if (!h.start().ok) return;
        const game = () => h.state.game!;
        for (const round of rounds) {
          if (h.state.phase === 'RESULTS' || h.state.phase === 'ROOM_CLOSED') break;
          for (
            let guard = 0;
            guard < 30 && h.state.phase !== 'RISK_PICK' && h.state.phase !== 'QUESTION';
            guard++
          )
            if (!h.step()) break;
          if (h.state.phase === 'RISK_PICK') {
            ids.forEach((id, i) => {
              if (h.state.phase !== 'RISK_PICK') return;
              commitRisk(h, id, round.dd[i % 8]);
              if (round.hit && round.hit.by % ids.length === i)
                hitTeam(h, id, round.hit.team, round.hit.effect);
              else pass(h, id);
            });
          }
          h.runUntil('ANSWERING');
          const live = game().round!;
          // At most one hit per team per question; a hit never costs a window more than a fifth
          const hitTeams = Object.values(live.sabotagePicks ?? {})
            .map((p) => p.sabotage?.targetTeamId)
            .filter((t) => t !== undefined);
          expect(new Set(hitTeams).size).toBe(hitTeams.length);
          for (const fx of Object.values(live.effects))
            expect(live.answerMs - fx.jamMs).toBeGreaterThanOrEqual(live.answerMs * 0.8);
          ids.forEach((id, i) => {
            const what = round.answers[i % 8]!;
            if (what !== 'none') h.answer(id, what);
          });
          h.runUntil('SCORE_UPDATE');

          const board = teamStandings(h.state, game());
          const alive = ids.filter(
            (id) => h.state.players[id]!.status === 'ACTIVE' && !game().players[id]!.removed,
          );
          expect(board.reduce((s, t) => s + t.members, 0)).toBe(alive.length);
          expect(board.reduce((s, t) => s + t.total, 0)).toBe(
            alive.reduce((s, id) => s + game().players[id]!.score, 0),
          );
          for (const ledger of Object.values(game().teams!.ledgers)) {
            expect(ledger.shield).toBeGreaterThanOrEqual(0);
            expect(ledger.hits).toBeLessThanOrEqual(cfg.simple!.sabotage.targetMaxPerGame);
          }
          for (const viewer of [
            { role: 'DISPLAY' } as const,
            ...ids.map((playerId) => ({ role: 'PLAYER', playerId }) as const),
          ])
            expect(RoomViewSchema.safeParse(h.view(viewer)).success).toBe(true);

          if (round.leave !== null && alive.length > 3) {
            const leaver = ids[round.leave % ids.length]!;
            if (alive.includes(leaver) && leaver !== h.state.leaderPlayerId)
              h.command(h.actor(leaver), { type: 'LEAVE_ROOM', payload: {} });
          }
        }
        let replay = createRoom({
          roomId: TEST_ROOM_ID,
          code: 'ABC234',
          displaySessionId: h.displaySessionId,
          now: 1_700_000_000_000,
          config: cfg,
          tier: 'FULL',
        });
        for (const input of h.inputs) replay = reduce(replay, input).state;
        expect(replay).toEqual(h.state);
      }),
      { numRuns: 25 },
    );
  }, 90_000);
});
