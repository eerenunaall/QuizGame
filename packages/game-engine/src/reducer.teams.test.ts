import { describe, expect, it } from 'vitest';
import { RoomViewSchema, scanForbiddenKeys, type ServerEvent } from '@quizparty/protocol';
import { type Harness } from './testing';
import {
  assign,
  commitRisk,
  hitTeam,
  lobby,
  playRound,
  refusal,
  set,
  teamGame,
  teamOf,
  teamsOf,
  toRound,
} from './teams.helpers';

/**
 * ADR-0026 §2: team assignment in the lobby. Players still answer and score alone; the teams are fixed
 * by the engine, the host decides how many, and nobody types a team name.
 */
describe('a room that never asked for teams', () => {
  it('looks exactly as before: no team on any player, no team field in any setting', () => {
    const { h } = lobby(3);
    expect(teamsOf(h)).toEqual([undefined, undefined, undefined]);
    const view = h.view({ role: 'DISPLAY' });
    expect(Object.keys(view.settings).sort()).toEqual(
      ['categories', 'contentTitle', 'difficulty', 'mode', 'rounds'].sort(),
    );
    expect(view.players.every((p) => !('teamId' in p))).toBe(true);
    expect(refusal(assign(h, h.state.playerOrder[0]!, 'tiger'))).toBe('TEAM_INVALID');
  });

  it('plays a whole game without a team in any frame', () => {
    const { h } = lobby(3);
    h.start();
    h.runUntil('RESULTS');
    expect(h.state.game!.teams).toBeUndefined();
    const view = h.view({ role: 'DISPLAY' });
    expect(JSON.stringify(view)).not.toMatch(/team/i);
  });
});

describe('turning teams on', () => {
  it('puts everybody in a team at once, dealt out in join order', () => {
    const { h, ids } = lobby(5);
    const before = h.effects.length;
    expect(set(h, { play: 'TEAMS' }).ok).toBe(true);
    expect(teamsOf(h)).toEqual(['tiger', 'owl', 'tiger', 'owl', 'tiger']);
    const events = h.effects
      .slice(before)
      .flatMap((e) => (e.kind === 'emit' ? [e.event] : []))
      .filter((e) => e.type === 'TEAM_CHANGED');
    expect(events).toHaveLength(5);
    expect(events[0]).toEqual({
      type: 'TEAM_CHANGED',
      payload: { playerId: ids[0], teamId: 'tiger' },
    });
    expect(h.view({ role: 'DISPLAY' }).settings.play).toBe('TEAMS');
  });

  it('sends a newcomer to the smallest team, the earlier slot on a tie', () => {
    const { h } = lobby(0, { play: 'TEAMS', teamCount: 3 });
    h.join('A');
    h.join('B');
    h.join('C');
    h.join('D');
    expect(teamsOf(h)).toEqual(['tiger', 'owl', 'fox', 'tiger']);
  });

  it('returns to individual play: teams are cleared and announced as none', () => {
    const { h } = lobby(3, { play: 'TEAMS' });
    const before = h.effects.length;
    set(h, { play: 'INDIVIDUAL' });
    expect(teamsOf(h)).toEqual([undefined, undefined, undefined]);
    const cleared = h.effects
      .slice(before)
      .flatMap((e) => (e.kind === 'emit' ? [e.event] : []))
      .filter(
        (e): e is Extract<ServerEvent, { type: 'TEAM_CHANGED' }> => e.type === 'TEAM_CHANGED',
      );
    expect(cleared.map((e) => e.payload.teamId)).toEqual([null, null, null]);
  });

  it('is the host’s call only', () => {
    const { h, ids } = lobby(3);
    expect(
      refusal(h.command(h.actor(ids[1]!), { type: 'SET_SETTINGS', payload: { play: 'TEAMS' } })),
    ).toBe('NOT_HOST');
  });

  it('changing the number of teams re-deals those who no longer fit, latest joiners first', () => {
    const { h, ids } = lobby(6, { play: 'TEAMS' }); // 3 + 3
    set(h, { teamCount: 4 }); // 2 per team: the latest of each overfull team move to the new slots
    const sizes = new Map<string, number>();
    for (const id of ids) sizes.set(teamOf(h, id)!, (sizes.get(teamOf(h, id)!) ?? 0) + 1);
    expect([...sizes.values()].every((n) => n <= 2)).toBe(true);
    expect(teamOf(h, ids[0]!)).toBe('tiger'); // the earliest joiner keeps their seat
    expect(teamOf(h, ids[1]!)).toBe('owl');
    set(h, { teamCount: 2 }); // fox and lion are gone: their members are re-dealt to tiger and owl
    expect(new Set(teamsOf(h))).toEqual(new Set(['tiger', 'owl']));
  });
});

describe('choosing a team (ASSIGN_TEAM)', () => {
  it('lets a player switch to another team; the same team again changes nothing', () => {
    const { h, ids } = lobby(4, { play: 'TEAMS' });
    expect(teamOf(h, ids[0]!)).toBe('tiger');
    expect(assign(h, ids[0]!, 'owl').ok).toBe(true);
    expect(teamOf(h, ids[0]!)).toBe('owl');
    const version = h.state.version;
    expect(assign(h, ids[0]!, 'owl').ok).toBe(true);
    expect(h.state.version).toBe(version);
  });

  it('refuses a team that is not on offer, or any team when the room is not in teams', () => {
    const { h, ids } = lobby(3, { play: 'TEAMS' }); // two teams offered
    expect(refusal(assign(h, ids[0]!, 'fox'))).toBe('TEAM_INVALID');
    set(h, { play: 'INDIVIDUAL' });
    expect(refusal(assign(h, ids[0]!, 'tiger'))).toBe('TEAM_INVALID');
  });

  it('refuses a full team: a team holds at most its share of the seats', () => {
    const { h, ids } = lobby(8, { play: 'TEAMS' }); // 4 + 4, capacity 4
    expect(refusal(assign(h, ids[1]!, 'tiger'))).toBe('TEAM_FULL');
    expect(teamOf(h, ids[1]!)).toBe('owl');
    set(h, { teamCount: 4 });
    // 8 seats over four teams: two each, all taken
    expect(refusal(assign(h, ids[0]!, 'owl'))).toBe('TEAM_FULL');
  });

  it('lets only the host move somebody else; a player moving a rival is refused', () => {
    const { h, ids } = lobby(4, { play: 'TEAMS' });
    expect(refusal(assign(h, ids[2]!, 'owl', ids[0]))).toBe('NOT_HOST');
    expect(teamOf(h, ids[0]!)).toBe('tiger');
    // the leader (first player) and the TV both may
    expect(assign(h, ids[0]!, 'owl', ids[2]).ok).toBe(true);
    expect(teamOf(h, ids[2]!)).toBe('owl');
    expect(assign(h, 'display', 'tiger', ids[3]).ok).toBe(true);
    expect(teamOf(h, ids[3]!)).toBe('tiger');
  });

  it('needs the TV to say whom it moves, and a seated player to move', () => {
    const { h, ids } = lobby(3, { play: 'TEAMS' });
    expect(refusal(assign(h, 'display', 'owl'))).toBe('TEAM_INVALID');
    expect(refusal(assign(h, 'display', 'owl', 'nobody'))).toBe('PLAYER_NOT_FOUND');
    h.command(h.actor(ids[0]!), { type: 'KICK_PLAYER', payload: { playerId: ids[2]! } });
    expect(refusal(assign(h, 'display', 'owl', ids[2]))).toBe('PLAYER_NOT_FOUND');
  });

  it('works in the lobby and on the results screen only', () => {
    const { h, ids } = lobby(4, { play: 'TEAMS' });
    h.start();
    h.runUntil('QUESTION');
    expect(refusal(assign(h, ids[0]!, 'owl'))).toBe('INVALID_STATE');
    h.runUntil('RESULTS');
    expect(assign(h, ids[0]!, 'owl').ok).toBe(true);
  });

  it('keeps a player’s team across a dropped phone and a return', () => {
    const { h, ids } = lobby(4, { play: 'TEAMS' });
    assign(h, ids[0]!, 'owl');
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[0]!, connected: false });
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[0]!, connected: true });
    expect(teamOf(h, ids[0]!)).toBe('owl');
  });

  it('frees the place of a player who leaves or is kicked', () => {
    const { h, ids } = lobby(8, { play: 'TEAMS' });
    h.command(h.actor(ids[0]!), { type: 'KICK_PLAYER', payload: { playerId: ids[2]! } }); // a tiger
    expect(assign(h, ids[1]!, 'tiger').ok).toBe(true); // the freed seat
    h.command(h.actor(ids[3]!), { type: 'LEAVE_ROOM', payload: {} });
    expect(refusal(assign(h, ids[5]!, 'tiger'))).toBe('TEAM_FULL'); // tiger is full again; owl has a seat
    expect(assign(h, ids[4]!, 'owl').ok).toBe(true);
  });
});

describe('starting a team game', () => {
  it('needs two teams with players', () => {
    const { h, ids } = lobby(3, { play: 'TEAMS' });
    for (const id of ids) assign(h, 'display', 'tiger', id);
    expect(refusal(h.start())).toBe('NOT_ENOUGH_TEAMS');
    expect(h.state.phase).toBe('LOBBY');
  });

  it('refuses teams that differ by more than the allowed imbalance, and the host can fix it', () => {
    const { h, ids } = lobby(5, { play: 'TEAMS' }); // 3 + 2: fine
    expect(h.start().ok).toBe(true);
    expect(ids).toHaveLength(5);

    const split = lobby(5, { play: 'TEAMS' });
    assign(split.h, 'display', 'tiger', split.ids[1]); // 4 + 1
    expect(teamsOf(split.h).filter((t) => t === 'tiger')).toHaveLength(4);
    expect(refusal(split.h.start())).toBe('TEAMS_UNBALANCED');
    expect(split.h.state.phase).toBe('LOBBY');
    // the leader moves one player back and the game starts
    expect(assign(split.h, split.ids[0]!, 'owl', split.ids[1]).ok).toBe(true);
    expect(split.h.start().ok).toBe(true);
  });

  it('lets a venue allow a bigger gap through the config', () => {
    const { h, ids } = lobby(5, { play: 'TEAMS' }, { teams: { maxImbalance: 3 } });
    assign(h, 'display', 'tiger', ids[1]); // 4 v 1
    expect(h.start().ok).toBe(true);
  });

  it('plays with fewer teams than were offered: empty teams are not in the game', () => {
    const { h } = lobby(4, { play: 'TEAMS', teamCount: 4 }); // 4 teams of one
    expect(h.start().ok).toBe(true);
    expect(h.state.game!.teams!.ids).toEqual(['tiger', 'owl', 'fox', 'lion']);
    const small = lobby(2, { play: 'TEAMS', teamCount: 4 });
    expect(small.h.start().ok).toBe(true);
    expect(small.h.state.game!.teams!.ids).toEqual(['tiger', 'owl']);
  });

  it('checks again when the deck arrives: a move made while it was being built still counts', () => {
    const { h, ids } = lobby(5, { play: 'TEAMS' });
    expect(h.start().ok).toBe(true); // 3 + 2, but the deck is not fetched yet in a real server
    const fresh = lobby(5, { play: 'TEAMS' });
    assign(fresh.h, 'display', 'tiger', fresh.ids[1]); // 4 + 1
    // a BEGIN_GAME that slips in with the bad split is refused by the engine, not trusted
    const result = fresh.h.apply({
      kind: 'BEGIN_GAME',
      requestedBy: fresh.h.displayActor(),
      purpose: 'START',
      gameId: '00000000-0000-4000-8000-0000000000aa',
      deck: fresh.h.deckFor({} as never),
    });
    expect(refusal(result)).toBe('TEAMS_UNBALANCED');
    expect(ids).toHaveLength(5);
  });

  it('fixes each player’s team and gives the shield to the team', () => {
    const { h, ids } = teamGame(4);
    const game = h.state.game!;
    expect(game.teams!.ids).toEqual(['tiger', 'owl']);
    expect(game.players[ids[0]!]!.teamId).toBe('tiger');
    expect(game.players[ids[1]!]!.teamId).toBe('owl');
    expect(game.teams!.ledgers.tiger).toEqual({ shield: 1, hits: 0, lastHitRound: null });
    for (const id of ids) expect(game.players[id]!.powers.shield).toBe(0);
    const you = h.view({ role: 'PLAYER', playerId: ids[0]! }).you!;
    expect(you.teamId).toBe('tiger');
    expect(you.powers!.shield).toBe(1); // the team's shield, shown on every member's phone
  });
});

describe('scoring a team game', () => {
  it('ranks the board by the average per member and shows the total beside it', () => {
    // tiger: p1, p3, p5 (one right, two wrong); owl: p2, p4 (both right)
    const { h, ids } = lobby(5, { play: 'TEAMS', ruleset: 'SIMPLE' });
    h.start();
    toRound(h, ids, 0);
    playRound(h, ids, { [ids[2]!]: 'wrong', [ids[4]!]: 'wrong' });
    const board = h.round().scoreUpdate!.teamBoard!;
    const scores = (teamId: string) =>
      ids.filter((id) => teamOf(h, id) === teamId).map((id) => h.state.game!.players[id]!.score);
    const tigerTotal = scores('tiger').reduce((a, b) => a + b, 0);
    const owlTotal = scores('owl').reduce((a, b) => a + b, 0);
    expect(board.find((t) => t.teamId === 'tiger')).toMatchObject({
      total: tigerTotal,
      members: 3,
      average: Math.round(tigerTotal / 3),
    });
    expect(board.find((t) => t.teamId === 'owl')).toMatchObject({
      total: owlTotal,
      members: 2,
      average: Math.round(owlTotal / 2),
    });
    // two right of two beats one right of three on the average, whatever the totals say
    expect(board[0]!.teamId).toBe('owl');
    expect(board[0]!.rank).toBe(1);
    const view = h.view({ role: 'DISPLAY' });
    expect(view.game!.teamBoard).toEqual(board);
  });

  it('keeps every player’s own score exactly as an individual game would give it', () => {
    const individual = lobby(4, { ruleset: 'SIMPLE' });
    const teams = lobby(4, { ruleset: 'SIMPLE', play: 'TEAMS' });
    for (const { h, ids } of [individual, teams]) {
      h.start();
      toRound(h, ids, 0);
      playRound(h, ids, { [ids[1]!]: 'wrong' });
    }
    const scores = (h: Harness) =>
      h.state.playerOrder.map((id) => h.state.game!.players[id]!.score);
    expect(scores(teams.h)).toEqual(scores(individual.h));
  });

  it('shows the final team standings with the individual ranking beside them', () => {
    const { h, ids } = teamGame(4);
    h.runUntil('RESULTS');
    const data = h.view({ role: 'DISPLAY' }).phaseData;
    if (data.phase !== 'RESULTS') throw new Error('no results');
    expect(data.teamRanking).toHaveLength(2);
    expect(data.ranking).toHaveLength(ids.length);
    expect(data.teamRanking![0]!.rank).toBe(1);
    expect(RoomViewSchema.safeParse(h.view({ role: 'DISPLAY' })).success).toBe(true);
  });

  it('keeps the teams for a rematch and for the lobby after the results', () => {
    const { h, ids } = teamGame(4);
    h.runUntil('RESULTS');
    const before = teamsOf(h);
    expect(h.command(h.actor(ids[0]!), { type: 'REMATCH', payload: {} }).ok).toBe(true);
    expect(teamsOf(h)).toEqual(before);
    expect(h.state.game!.teams!.ids).toEqual(['tiger', 'owl']);
    h.runUntil('RESULTS');
    h.command(h.actor(ids[0]!), { type: 'BACK_TO_LOBBY', payload: {} });
    expect(teamsOf(h)).toEqual(before);
  });

  it('a rematch with a lopsided table is refused until the host moves somebody', () => {
    const { h, ids } = teamGame(5);
    h.runUntil('RESULTS');
    assign(h, 'display', 'tiger', ids[1]);
    expect(refusal(h.command(h.actor(ids[0]!), { type: 'REMATCH', payload: {} }))).toBe(
      'TEAMS_UNBALANCED',
    );
  });
});

describe('players leaving a team game', () => {
  it('drops them from the team’s average and total', () => {
    const { h, ids } = teamGame(5);
    toRound(h, ids, 0);
    playRound(h, ids);
    h.runUntil('MICRO_INTERMISSION');
    const tigerBefore = h.state.game!.round!.scoreUpdate!.teamBoard!.find(
      (t) => t.teamId === 'tiger',
    )!;
    const leaver = ids[2]!; // a tiger
    h.command(h.actor(leaver), { type: 'LEAVE_ROOM', payload: {} });
    playRound(
      h,
      ids.filter((id) => id !== leaver),
    );
    const tiger = h.round().scoreUpdate!.teamBoard!.find((t) => t.teamId === 'tiger')!;
    expect(tigerBefore.members).toBe(3);
    expect(tiger.members).toBe(2);
    const sum = ids
      .filter((id) => teamOf(h, id) === 'tiger' && id !== leaver)
      .reduce((s, id) => s + h.state.game!.players[id]!.score, 0);
    expect(tiger.total).toBe(sum);
  });

  it('lets the game go on when a whole team has left, with the others ranked', () => {
    const { h, ids } = teamGame(4);
    toRound(h, ids, 0);
    for (const id of ids.filter((_, i) => i % 2 === 1))
      // all owls
      h.command(h.actor(id), { type: 'LEAVE_ROOM', payload: {} });
    expect(h.state.phase).not.toBe('ROOM_CLOSED');
    h.runUntil('RESULTS');
    const data = h.view({ role: 'DISPLAY' }).phaseData;
    if (data.phase !== 'RESULTS') throw new Error('no results');
    expect(data.teamRanking!.map((t) => t.teamId)).toEqual(['tiger']);
  });

  it('keeps a dropped phone’s seat in the team until the player is gone for good', () => {
    const { h, ids } = teamGame(4);
    toRound(h, ids, 0);
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[1]!, connected: false });
    playRound(
      h,
      ids.filter((id) => id !== ids[1]),
      {},
    );
    const owl = h.round().scoreUpdate!.teamBoard!.find((t) => t.teamId === 'owl')!;
    expect(owl.members).toBe(2);
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[1]!, connected: true });
    expect(h.state.game!.players[ids[1]!]!.teamId).toBe('owl');
  });
});

describe('what a view of a team game may carry', () => {
  it('passes the room schema for every viewer and carries no hidden pick before it is revealed', () => {
    const { h, ids } = teamGame(4);
    toRound(h, ids, 1);
    for (let guard = 0; guard < 400 && h.state.phase !== 'RESULTS'; guard++) {
      if (h.state.phase === 'RISK_PICK') {
        commitRisk(h, ids[0]!, true);
        hitTeam(h, ids[0]!, 'owl');
      }
      for (const viewer of [
        { role: 'DISPLAY' } as const,
        ...ids.map((playerId) => ({ role: 'PLAYER', playerId }) as const),
      ]) {
        const view = h.view(viewer);
        expect(RoomViewSchema.safeParse(view).success).toBe(true);
        const live = ['RISK_PICK', 'QUESTION', 'ANSWERING', 'LOCKED'].includes(view.phase);
        if (live) expect(scanForbiddenKeys(view)).toEqual([]);
        // Other teams’ picks are never in anyone else’s view.
        if (live && viewer.role === 'PLAYER' && viewer.playerId !== ids[0]!)
          expect(view.you!.commitment).toBeNull();
      }
      if (!h.step()) break;
    }
  });
});
