import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PhaseData, RoomView, ServerMessage, TeamId } from '@quizparty/protocol';
import { TestClient } from '../helpers/client';
import { closeParty, createParty, type Party } from '../helpers/party';
import { correctOptionId, liveRoom } from '../helpers/oracle';
import { preRevealLeaks } from '../helpers/scan';
import { FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

/**
 * ADR-0026 over real sockets: team assignment in the lobby, a whole team game of the simple ruleset (two
 * teams, then three), reconnects, a player who leaves, a sabotage on a team and what each screen is told.
 */
const WINDOW = { STANDARD: 2000, SPEED: 2000, RISK: 2000, CROWD: 2000, FINAL: 2000 };
const TEAM_GAME = {
  ...FAST_GAME_CONFIG,
  defaultRounds: 5,
  simple: { answerMs: WINDOW, prepMs: 2000 },
};

let server: TestServer;
beforeAll(async () => {
  server = await startServer({ gameConfig: TEAM_GAME });
});
afterAll(async () => {
  await server.dispose();
});

type Entered = Extract<ServerMessage, { type: 'PHASE_ENTERED' }>;
const dataOf = (message: Entered): PhaseData => message.payload.data;

async function stateOf(client: TestClient): Promise<RoomView> {
  client.send('REQUEST_STATE', {});
  return (await client.nextOfType('ROOM_STATE')).payload.room;
}

const teamsIn = (room: RoomView): (TeamId | undefined)[] => room.players.map((p) => p.teamId);

async function ack(client: TestClient): Promise<void> {
  await client.nextOfType('ACK');
}

interface RoundPlan {
  /** Players still in the game (indexes into `party.players`). */
  live: number[];
  /** Index of the player who sabotages a team this round, and which team. */
  hit?: { by: number; team: TeamId };
  /** Who answers right (default: even indexes). */
  right?: (index: number) => boolean;
}

/** One question of the simple ruleset from the prep phase to the score update, driven like phones would. */
async function playRound(
  party: Party,
  clients: TestClient[],
  plan: RoundPlan,
  withSabotage: boolean,
) {
  const roomId = party.created.roomId;
  await party.display.waitForPhase('RISK_PICK');
  for (const index of plan.live) {
    const client = clients[index]!;
    client.send('COMMIT_RISK', { stake: 'SAFE', doubleDown: false });
    if (!withSabotage) continue;
    client.send('COMMIT_SABOTAGE', {
      sabotage:
        plan.hit && plan.hit.by === index ? { targetTeamId: plan.hit.team, effect: 'JAM' } : null,
    });
  }
  const answering = dataOf(await party.display.waitForPhase('ANSWERING', 8_000));
  if (answering.phase !== 'ANSWERING') throw new Error('not answering');
  const correct = correctOptionId(server, roomId);
  const wrong = answering.options.find((o) => o.optionId !== correct)!.optionId;
  const right = plan.right ?? ((index: number) => index % 2 === 0);
  for (const index of plan.live)
    clients[index]!.send('SUBMIT_ANSWER', {
      questionId: answering.questionId,
      optionId: right(index) ? correct : wrong,
    });
  // A hit on a team always shows on the power screen, which comes before the score update.
  let power: Extract<PhaseData, { phase: 'POWER_RESOLUTION' }> | null = null;
  if (plan.hit) {
    const shown = dataOf(await party.display.waitForPhase('POWER_RESOLUTION', 8_000));
    if (shown.phase === 'POWER_RESOLUTION') power = shown;
  }
  const score = dataOf(await party.display.waitForPhase('SCORE_UPDATE', 8_000));
  if (score.phase !== 'SCORE_UPDATE') throw new Error('not a score update');
  return { score, power };
}

describe('the lobby of a team game', () => {
  it('deals the players into teams, lets them switch, and lets only the leader move others', async () => {
    const party = await createParty(server, 4);
    const [p0, p1, p2, p3] = party.players as [TestClient, TestClient, TestClient, TestClient];
    p0.send('SET_SETTINGS', { play: 'TEAMS', ruleset: 'SIMPLE' });
    await ack(p0);
    const dealt = await stateOf(party.display);
    expect(teamsIn(dealt)).toEqual(['tiger', 'owl', 'tiger', 'owl']);
    expect(dealt.settings).toMatchObject({ play: 'TEAMS', ruleset: 'SIMPLE' });
    expect(dealt.settings.teamCount).toBeUndefined(); // two teams is the default and is not sent
    // everybody was told, each phone also about its own team
    const changes = party.display.messages.filter((m) => m.type === 'TEAM_CHANGED');
    expect(changes).toHaveLength(4);
    expect((await stateOf(p1)).you?.teamId).toBe('owl');

    // a player taps another chip: 1 tiger against 3 owls cannot start
    p2.send('ASSIGN_TEAM', { teamId: 'owl' });
    await ack(p2);
    p0.send('START_GAME', {});
    expect((await p0.nextOfType('ERROR')).payload.code).toBe('TEAMS_UNBALANCED');

    // a player cannot move somebody else; the leader can
    p3.send('ASSIGN_TEAM', { teamId: 'tiger', playerId: p1.playerId });
    expect((await p3.nextOfType('ERROR')).payload.code).toBe('NOT_HOST');
    p0.send('ASSIGN_TEAM', { teamId: 'tiger', playerId: p2.playerId });
    await ack(p0);
    expect(teamsIn(await stateOf(party.display))).toEqual(['tiger', 'owl', 'tiger', 'owl']);
    await closeParty(party);
  });

  it('refuses a third team that is not on offer, and teams in a room that plays alone', async () => {
    const party = await createParty(server, 2);
    const [p0, p1] = party.players as [TestClient, TestClient];
    p1.send('ASSIGN_TEAM', { teamId: 'tiger' });
    expect((await p1.nextOfType('ERROR')).payload.code).toBe('TEAM_INVALID');
    p0.send('SET_SETTINGS', { play: 'TEAMS' });
    await ack(p0);
    p1.send('ASSIGN_TEAM', { teamId: 'fox' });
    expect((await p1.nextOfType('ERROR')).payload.code).toBe('TEAM_INVALID');
    p0.send('SET_SETTINGS', { teamCount: 3 });
    await ack(p0);
    p1.send('ASSIGN_TEAM', { teamId: 'fox' });
    await ack(p1);
    await closeParty(party);
  });
});

describe('a whole team game of the simple ruleset', () => {
  it('plays two teams of two: standings, a sabotage on a team, a reconnect, a leaver, a rematch', async () => {
    const party = await createParty(server, 4);
    const clients = [...party.players];
    const roomId = party.created.roomId;
    const [p0, , , p3] = clients as [TestClient, TestClient, TestClient, TestClient];
    p0.send('SET_SETTINGS', { play: 'TEAMS', ruleset: 'SIMPLE', rounds: 5 });
    await ack(p0);
    p0.send('START_GAME', {});

    // Nobody joins a game that is running (the deck is built first, so wait for the countdown).
    await party.display.waitForPhase('COUNTDOWN');
    const late = await TestClient.connect(server.wsUrl);
    late.send(
      'JOIN_ROOM',
      {
        code: party.created.code,
        nickname: 'Gecikmis',
        avatarId: 'fox',
        deviceId: `device-${'a'.repeat(24)}`,
        client: { kind: 'WEB', version: 'test' },
      },
      { roomId: null, sessionId: null },
    );
    expect((await late.nextOfType('ERROR')).payload.code).toBe('GAME_IN_PROGRESS');
    await late.close();

    // Round 1: tigers (p0, p2) right, owls (p1, p3) wrong.
    const { score: first } = await playRound(party, clients, { live: [0, 1, 2, 3] }, false);
    const board = first.teamBoard!;
    expect(board.map((t) => t.teamId)).toEqual(['tiger', 'owl']);
    expect(board[0]).toMatchObject({ teamId: 'tiger', rank: 1, members: 2 });
    expect(board[0]!.average).toBeGreaterThan(0);
    expect(board[1]).toMatchObject({ teamId: 'owl', rank: 2, total: 0, average: 0 });
    const tigerGain = first.deltas
      .filter((d) => d.playerId === p0.playerId || d.playerId === clients[2]!.playerId)
      .reduce((sum, d) => sum + d.total, 0);
    expect(board[0]!.total).toBe(tigerGain);

    // Round 2: p0 sabotages the owls; the team's shield takes the hit for both of them.
    const second = await playRound(
      party,
      clients,
      { live: [0, 1, 2, 3], hit: { by: 0, team: 'owl' } },
      true,
    );
    expect(second.power!.items).toEqual([
      { kind: 'SABOTAGE', actorId: p0.playerId, targetTeamId: 'owl', effect: 'JAM', blocked: true },
    ]);
    for (const index of [1, 3]) {
      const states = clients[index]!.messages.filter((m) => m.type === 'PLAYER_STATE');
      expect(
        states.some(
          (m) =>
            m.type === 'PLAYER_STATE' &&
            m.payload.you.hits.length === 1 &&
            m.payload.you.hits[0]!.blocked,
        ),
      ).toBe(true);
    }
    // the attackers' side heard nothing of the hit except its own pick
    for (const index of [0, 2])
      expect(
        clients[index]!.messages.some(
          (m) => m.type === 'PLAYER_STATE' && m.payload.you.hits.length > 0,
        ),
      ).toBe(false);

    // p1 loses signal and comes back: same team, same game
    const oldToken = clients[1]!.token!;
    const gone = clients[1]!;
    gone.drop();
    await waitUntil(() =>
      party.display.messages.some(
        (m) =>
          m.type === 'PLAYER_STATUS' &&
          m.payload.playerId === gone.playerId &&
          m.payload.connection === 'DISCONNECTED',
      ),
    );
    const back = await TestClient.connect(server.wsUrl);
    Object.assign(back, {
      sessionId: gone.sessionId,
      roomId: gone.roomId,
      token: oldToken,
      sequence: gone.sequence,
    });
    const view = await back.reconnect();
    clients[1] = back;
    expect(view.you?.teamId).toBe('owl');
    expect(view.game?.teamBoard?.map((t) => t.teamId)).toEqual(['tiger', 'owl']);

    // p3 leaves between questions: the owls are one player now
    p3.send('LEAVE_ROOM', {});
    await waitUntil(() =>
      party.display.messages.some(
        (m) => m.type === 'PLAYER_LEFT' && m.payload.playerId === p3.playerId,
      ),
    );
    const { score: third } = await playRound(party, clients, { live: [0, 1, 2] }, true);
    expect(third.teamBoard!.find((t) => t.teamId === 'owl')!.members).toBe(1);

    // Round 4: p2 sabotages the owls again; the shield is gone, so it lands on the one owl left.
    const fourth = await playRound(
      party,
      clients,
      { live: [0, 1, 2], hit: { by: 2, team: 'owl' } },
      true,
    );
    expect(fourth.power!.items[0]).toMatchObject({
      kind: 'SABOTAGE',
      targetTeamId: 'owl',
      blocked: false,
    });
    expect(liveRoom(server, roomId).state.game!.teams!.ledgers.owl).toMatchObject({
      shield: 0,
      hits: 2,
    });

    // The final question and the results.
    await playRound(party, clients, { live: [0, 1, 2] }, false);
    const results = dataOf(await party.display.waitForPhase('RESULTS', 8_000));
    if (results.phase !== 'RESULTS') throw new Error('phase');
    expect(results.teamRanking!.map((t) => t.teamId).sort()).toEqual(['owl', 'tiger']);
    expect(results.ranking).toHaveLength(3); // p3 left
    expect(results.teamRanking![0]!.rank).toBe(1);

    // Nothing hidden was sent to anybody on the way.
    for (const client of [party.display, ...clients]) expect(preRevealLeaks(client)).toEqual([]);

    // The phones got the options but not the question text while it ran (the TV got both).
    const textsOf = (client: TestClient) =>
      client.messages.flatMap((m) =>
        m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'ANSWERING' ? [m.payload.data] : [],
      );
    expect(textsOf(party.display).every((d) => d.text.length > 0)).toBe(true);
    for (const phone of [clients[0]!, clients[2]!]) {
      const frames = textsOf(phone);
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame.text).toBe('');
        expect(frame.options.every((o) => o.text.length > 0)).toBe(true);
      }
    }

    // A rematch keeps the teams (2 v 1 is allowed) and the ruleset.
    clients[0]!.send('REMATCH', {});
    const again = await party.display.nextOfType('PHASE_ENTERED');
    expect(again.payload.data.phase).toBe('COUNTDOWN');
    expect(liveRoom(server, roomId).state.game!.teams!.ids).toEqual(['tiger', 'owl']);
    expect(liveRoom(server, roomId).state.config.ruleset).toBe('SIMPLE');
    await closeParty({ ...party, players: clients });
  }, 60_000);

  it('plays three teams with a kicked player and a reconnect, and ranks all three', async () => {
    const party = await createParty(server, 6);
    const clients = [...party.players];
    const [p0, , , , , p5] = clients as [
      TestClient,
      TestClient,
      TestClient,
      TestClient,
      TestClient,
      TestClient,
    ];
    p0.send('SET_SETTINGS', { play: 'TEAMS', ruleset: 'SIMPLE', teamCount: 3, rounds: 3 });
    await ack(p0);
    expect(teamsIn(await stateOf(party.display))).toEqual([
      'tiger',
      'owl',
      'fox',
      'tiger',
      'owl',
      'fox',
    ]);

    // The leader removes one player: the last fox is alone, which is still within a gap of one.
    p0.send('KICK_PLAYER', { playerId: p5.playerId });
    await waitUntil(() =>
      party.display.messages.some(
        (m) => m.type === 'PLAYER_LEFT' && m.payload.playerId === p5.playerId,
      ),
    );
    p0.send('START_GAME', {});

    const live = [0, 1, 2, 3, 4];
    await playRound(party, clients, { live, right: (i) => i === 0 || i === 3 }, false);
    // p4 drops and returns between questions
    const gone = clients[4]!;
    const token = gone.token!;
    gone.drop();
    const back = await TestClient.connect(server.wsUrl);
    Object.assign(back, {
      sessionId: gone.sessionId,
      roomId: gone.roomId,
      token,
      sequence: gone.sequence,
    });
    expect((await back.reconnect()).you?.teamId).toBe('owl');
    clients[4] = back;
    await playRound(party, clients, { live, right: (i) => i !== 2 }, false);
    await playRound(party, clients, { live, right: () => true }, false);
    const results = dataOf(await party.display.waitForPhase('RESULTS', 8_000));
    if (results.phase !== 'RESULTS') throw new Error('phase');
    expect(results.teamRanking!.map((t) => t.teamId).sort()).toEqual(['fox', 'owl', 'tiger']);
    expect(results.teamRanking!.find((t) => t.teamId === 'fox')!.members).toBe(1);
    for (const client of [party.display, ...clients.slice(0, 5)])
      expect(preRevealLeaks(client)).toEqual([]);
    await closeParty({ ...party, players: clients.slice(0, 5) });
  }, 60_000);
});
