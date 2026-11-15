import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestClient } from '../helpers/client';
import { liveRoom } from '../helpers/oracle';
import { closeParty, createParty, type Party } from '../helpers/party';
import { inPhase, roomOf, say } from '../helpers/rounds';
import { waitForSecurityEvent } from '../helpers/security';
import { FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

/**
 * ATTACK 41-46 (ADR-0026): the team surface. Teams are named and coloured by us, so a player can only
 * tap a chip; the server decides who is in which team, who may move whom, who may hit whom, and what
 * the other teams' phones may learn. Every attack ends with the room's state unchanged.
 */
const WINDOW = { STANDARD: 5000, SPEED: 5000, RISK: 5000, CROWD: 5000, FINAL: 5000 };
const CONFIG = {
  ...FAST_GAME_CONFIG,
  defaultRounds: 6,
  simple: { answerMs: WINDOW, prepMs: 6000, sabotage: { firstRoundIndex: 0 } },
};

let server: TestServer;
beforeAll(async () => {
  server = await startServer({ gameConfig: CONFIG });
});
afterAll(async () => {
  await server.dispose();
});

const teamsOf = (party: Party): (string | undefined)[] =>
  roomOf(server, party).state.playerOrder.map(
    (id) => roomOf(server, party).state.players[id]!.teamId,
  );

/** `count` phones in a room that plays in teams with the simple ruleset, still in the lobby. */
async function lobby(count: number, settings: Record<string, unknown> = {}): Promise<Party> {
  const party = await createParty(server, count);
  expect(
    await say(party.leader, 'SET_SETTINGS', { play: 'TEAMS', ruleset: 'SIMPLE', ...settings }),
  ).toBe('OK');
  return party;
}

/** Four phones, the game started, standing in the single prep phase of the first question. */
async function prep(): Promise<Party> {
  const party = await lobby(4);
  party.leader.send('START_GAME', {});
  await inPhase(server, party, 'RISK_PICK', 0);
  return party;
}

describe('ATTACK 41 — team spoofing', () => {
  it('a player cannot give himself a team name, a colour or an icon: only the chips exist', async () => {
    const party = await lobby(3);
    const [, b] = party.players as [TestClient, TestClient, TestClient];
    // a name, an unknown slot, or any extra field the schema does not list
    expect(await say(b, 'ASSIGN_TEAM', { teamId: 'Süper Takım' })).toBe('INVALID_MESSAGE');
    expect(await say(b, 'ASSIGN_TEAM', { teamId: 'wolves' })).toBe('INVALID_MESSAGE');
    expect(await say(b, 'ASSIGN_TEAM', { teamId: 'tiger', name: 'Benim Takım' })).toBe(
      'INVALID_MESSAGE',
    );
    expect(await say(b, 'ASSIGN_TEAM', { teamId: 'tiger', colorSlot: 8 })).toBe('INVALID_MESSAGE');
    // the venue's names and the room's team settings are the host's, and the schema never takes a name
    expect(await say(b, 'SET_SETTINGS', { teamNames: ['Hile'] })).toBe('INVALID_MESSAGE');
    expect(await say(b, 'SET_SETTINGS', { play: 'INDIVIDUAL' })).toBe('NOT_HOST');
    expect(await say(b, 'SET_SETTINGS', { teamCount: 4 })).toBe('NOT_HOST');
    expect(roomOf(server, party).state.settings.play).toBe('TEAMS');
    expect(roomOf(server, party).state.settings.teamNames).toBeUndefined();
    await closeParty(party);
  });

  it('cannot put a team on another player by sending his id, whoever claims to send it', async () => {
    const party = await lobby(3);
    const [a, b, c] = party.players as [TestClient, TestClient, TestClient];
    const before = teamsOf(party);
    // b names a (the leader) as the one to move: a host command, refused
    expect(await say(b, 'ASSIGN_TEAM', { teamId: 'owl', playerId: a.playerId })).toBe('NOT_HOST');
    // a forged session id does not turn a frame into the leader's
    const forged = b.send(
      'ASSIGN_TEAM',
      { teamId: 'owl', playerId: c.playerId },
      { sessionId: a.sessionId },
    );
    const answer = await b.next(
      (m) => (m.type === 'ERROR' || m.type === 'ACK') && m.payload.messageId === forged,
    );
    expect(answer.type).toBe('ERROR');
    expect(teamsOf(party)).toEqual(before);
    await closeParty(party);
  });
});

describe('ATTACK 42 — joining a full, absent or closed team', () => {
  it('a full team refuses, a team that is not on offer refuses, and a seat freed by a leaver is taken', async () => {
    const party = await lobby(8); // 4 + 4, the capacity of two teams over eight seats
    const phones = party.players;
    // phone 1 is an owl, tiger has its four
    expect(await say(phones[1]!, 'ASSIGN_TEAM', { teamId: 'tiger' })).toBe('TEAM_FULL');
    expect(await say(phones[1]!, 'ASSIGN_TEAM', { teamId: 'fox' })).toBe('TEAM_INVALID');
    expect(teamsOf(party).filter((team) => team === 'tiger')).toHaveLength(4);
    // a tiger leaves; the freed seat is real
    phones[2]!.send('LEAVE_ROOM', {}); // the leaver's socket is closed by the server: no ACK
    await waitUntil(
      () => roomOf(server, party).state.players[phones[2]!.playerId!]!.status === 'LEFT',
    );
    expect(await say(phones[1]!, 'ASSIGN_TEAM', { teamId: 'tiger' })).toBe('OK');
    // and the next owl cannot slip into the seat that was just taken
    expect(await say(phones[3]!, 'ASSIGN_TEAM', { teamId: 'tiger' })).toBe('TEAM_FULL');
    await closeParty(party);
  });

  it('once the game runs nobody can change team, and nobody can join a team that way', async () => {
    const party = await prep();
    const [, b] = party.players as [TestClient, TestClient, TestClient, TestClient];
    const before = teamsOf(party);
    expect(await say(b, 'ASSIGN_TEAM', { teamId: 'tiger' })).toBe('INVALID_STATE');
    expect(await say(party.leader, 'ASSIGN_TEAM', { teamId: 'owl', playerId: b.playerId })).toBe(
      'INVALID_STATE',
    );
    expect(teamsOf(party)).toEqual(before);
    expect(liveRoom(server, party.created.roomId).state.game!.players[b.playerId!]!.teamId).toBe(
      'owl',
    );
    await closeParty(party);
  });

  it('a room that does not play in teams has no team to join', async () => {
    const party = await createParty(server, 2);
    expect(await say(party.players[1]!, 'ASSIGN_TEAM', { teamId: 'tiger' })).toBe('TEAM_INVALID');
    expect(teamsOf(party)).toEqual([undefined, undefined]);
    await closeParty(party);
  });

  it('two teams that cannot make a game keep the game from starting, and say why', async () => {
    const party = await lobby(4);
    const [, b, , d] = party.players as [TestClient, TestClient, TestClient, TestClient];
    // everybody into one team
    for (const phone of [b, d])
      expect(
        await say(party.leader, 'ASSIGN_TEAM', { teamId: 'tiger', playerId: phone.playerId }),
      ).toBe('OK');
    expect(await say(party.leader, 'START_GAME', {})).toBe('NOT_ENOUGH_TEAMS');
    expect(roomOf(server, party).state.phase).toBe('LOBBY');
    await closeParty(party);
  });
});

describe('ATTACK 43 — moving other players without leader rights', () => {
  it('a guest cannot move a rival into the wrong team, and the attempt is recorded', async () => {
    const party = await lobby(4);
    const [, b, , d] = party.players as [TestClient, TestClient, TestClient, TestClient];
    const before = teamsOf(party);
    expect(await say(d, 'ASSIGN_TEAM', { teamId: 'tiger', playerId: b.playerId })).toBe('NOT_HOST');
    await waitForSecurityEvent(server, { roomId: party.created.roomId }, 'HOST_COMMAND_FORBIDDEN');
    expect(teamsOf(party)).toEqual(before);
    await closeParty(party);
  });

  it('the right to move others goes with the leader role, not with the first phone', async () => {
    const party = await lobby(4);
    const [a, b, c] = party.players as [TestClient, TestClient, TestClient, TestClient];
    expect(await say(a, 'TRANSFER_LEADER', { playerId: b.playerId })).toBe('OK');
    expect(await say(a, 'ASSIGN_TEAM', { teamId: 'owl', playerId: c.playerId })).toBe('NOT_HOST');
    expect(await say(b, 'ASSIGN_TEAM', { teamId: 'owl', playerId: c.playerId })).toBe('OK');
    await closeParty(party);
  });

  it('the TV may move a player, but a player cannot speak as the TV', async () => {
    const party = await lobby(4);
    const [, b, c] = party.players as [TestClient, TestClient, TestClient, TestClient];
    // the TV session moves someone: allowed
    expect(await say(party.display, 'ASSIGN_TEAM', { teamId: 'owl', playerId: c.playerId })).toBe(
      'OK',
    );
    // a phone carrying the display's session id is not the display
    const forged = b.send(
      'ASSIGN_TEAM',
      { teamId: 'tiger', playerId: c.playerId },
      { sessionId: party.display.sessionId },
    );
    const answer = await b.next(
      (m) => (m.type === 'ERROR' || m.type === 'ACK') && m.payload.messageId === forged,
    );
    expect(answer.type).toBe('ERROR');
    // and the TV cannot move "nobody": it must name a seated player
    expect(await say(party.display, 'ASSIGN_TEAM', { teamId: 'owl' })).toBe('TEAM_INVALID');
    await closeParty(party);
  });
});

describe('ATTACK 44 — seeing other teams’ hidden picks', () => {
  it('nobody but the attacker hears whom a sabotage is aimed at until the power screen', async () => {
    const party = await prep();
    const [a, b, c, d] = party.players as [TestClient, TestClient, TestClient, TestClient];
    const marks = new Map(
      [party.display, a, b, c, d].map((client) => [client, client.frames.length]),
    );
    expect(await say(a, 'COMMIT_RISK', { stake: 'SAFE', doubleDown: true })).toBe('OK');
    expect(
      await say(a, 'COMMIT_SABOTAGE', { sabotage: { targetTeamId: 'owl', effect: 'BLIND_CLOCK' } }),
    ).toBe('OK');
    for (const phone of [b, c, d]) {
      await say(phone, 'COMMIT_RISK', { stake: 'SAFE', doubleDown: false });
      await say(phone, 'COMMIT_SABOTAGE', { sabotage: null });
    }
    await inPhase(server, party, 'ANSWERING', 0);
    const since = (client: TestClient) => client.frames.slice(marks.get(client)).join('\n');
    // the attacker's own phone knows; the TV, the teammate and the rivals do not
    expect(since(a)).toContain('"targetTeamId":"owl"');
    for (const other of [party.display, b, c, d])
      expect(since(other), 'a pick leaked').not.toContain('targetTeamId');
    // the TV and the teammate do not even hear the effect; the rivals hear only what landed on them
    for (const other of [party.display, c])
      expect(since(other)).not.toContain('"effect":"BLIND_CLOCK"');
    // the rivals learn that something hit them, not who aimed it (the team's shield may take it)
    const victimStates = [b, d].flatMap((phone) =>
      phone.messages.filter((m) => m.type === 'PLAYER_STATE'),
    );
    expect(
      victimStates.some((m) => m.type === 'PLAYER_STATE' && m.payload.you.hits.length > 0),
    ).toBe(true);
    for (const phone of [b, d]) expect(since(phone)).not.toContain(a.playerId!);
    // the Double Down is private as well
    expect(since(c)).not.toContain('"doubleDown":true');
    await closeParty(party);
  });

  it('prep progress is a bare count of everybody online, whoever could act', async () => {
    const party = await prep();
    const [a] = party.players as [TestClient, TestClient, TestClient, TestClient];
    await say(a, 'COMMIT_RISK', { stake: 'SAFE', doubleDown: false });
    const progress = await party.display.next(
      (m) => m.type === 'PREP_PROGRESS' && m.payload.committedCount >= 1,
    );
    expect(progress.payload).toEqual({ committedCount: 1, eligibleCount: 4 });
    await closeParty(party);
  });
});

describe('ATTACK 45 — a sabotage on your own team or on a team that is not there', () => {
  it('refuses every wrong aim, spends nothing, and still lets the right one through', async () => {
    const party = await prep();
    const [a, b, c] = party.players as [TestClient, TestClient, TestClient, TestClient];
    const tokens = () => roomOf(server, party).state.game!.players[a.playerId!]!.powers.tokens;
    expect(tokens()).toBe(1);
    const aim = (sabotage: unknown) => say(a, 'COMMIT_SABOTAGE', { sabotage });
    expect(await aim({ targetTeamId: 'tiger', effect: 'JAM' })).toBe('TARGET_INVALID'); // my own team
    expect(await aim({ targetTeamId: 'fox', effect: 'JAM' })).toBe('TARGET_INVALID'); // not in this game
    expect(await aim({ targetId: b.playerId, effect: 'JAM' })).toBe('TARGET_INVALID'); // a player, in a team game
    expect(await aim({ targetId: a.playerId, effect: 'JAM' })).toBe('TARGET_INVALID'); // myself
    expect(await aim({ targetId: b.playerId, targetTeamId: 'owl', effect: 'JAM' })).toBe(
      'INVALID_MESSAGE',
    );
    expect(await aim({ effect: 'JAM' })).toBe('INVALID_MESSAGE');
    expect(await aim({ targetTeamId: 'owl', effect: 'FOG' })).toBe('POWER_UNAVAILABLE'); // not on the café menu
    expect(await aim({ targetTeamId: 'owl', effect: 'CUT' })).toBe('POWER_UNAVAILABLE');
    expect(tokens()).toBe(1);
    expect(await aim({ targetTeamId: 'owl', effect: 'JAM' })).toBe('OK');
    expect(tokens()).toBe(0);
    // a teammate cannot hit the same team in the same question
    expect(
      await say(c, 'COMMIT_SABOTAGE', { sabotage: { targetTeamId: 'owl', effect: 'SHUFFLE' } }),
    ).toBe('SABOTAGE_LIMIT');
    // and the pick is final
    expect(await aim({ targetTeamId: 'owl', effect: 'SHUFFLE' })).toBe('ALREADY_COMMITTED');
    await closeParty(party);
  });

  it('a Duel in the full ruleset cannot be sent to a teammate', async () => {
    const party = await createParty(server, 4);
    expect(await say(party.leader, 'SET_SETTINGS', { play: 'TEAMS' })).toBe('OK');
    party.leader.send('START_GAME', {});
    await inPhase(server, party, 'RISK_PICK', 0);
    const [a, , c] = party.players as [TestClient, TestClient, TestClient, TestClient];
    expect(
      await say(a, 'COMMIT_RISK', {
        stake: 'SAFE',
        doubleDown: false,
        duel: { targetId: c.playerId },
      }),
    ).toBe('TARGET_INVALID');
    await closeParty(party);
  });
});

describe('ATTACK 46 — the question text stays on the TV in the simple ruleset', () => {
  it('no phone gets the question text before the reveal; the TV does; a re-sync does not leak', async () => {
    const party = await prep();
    for (const phone of party.players) {
      await say(phone, 'COMMIT_RISK', { stake: 'SAFE', doubleDown: false });
      await say(phone, 'COMMIT_SABOTAGE', { sabotage: null });
    }
    await inPhase(server, party, 'ANSWERING', 0);
    const question = roomOf(server, party).state.game!.round!.question!;
    const words = [question.text]; // the options stay on the phone, as in the default game
    const [a] = party.players as [TestClient, TestClient, TestClient, TestClient];
    a.send('REQUEST_STATE', {});
    const resync = await a.nextOfType('ROOM_STATE');
    expect(resync.payload.room.phaseData).toMatchObject({ phase: 'ANSWERING', text: '' });
    for (const phone of party.players) {
      const frames = phone.frames.join('\n');
      for (const word of words) expect(frames, `a phone saw "${word}"`).not.toContain(word);
    }
    const tv = party.display.frames.join('\n');
    for (const word of [...words, ...question.options.map((option) => option.text)]) {
      expect(tv).toContain(word);
    }
    await closeParty(party);
  });
});
