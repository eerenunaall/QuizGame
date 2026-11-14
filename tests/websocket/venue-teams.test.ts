import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@quizparty/protocol';
import { correctOptionId, liveRoom, wrongOptionId } from '../helpers/oracle';
import { closeParty, createParty, type Party } from '../helpers/party';
import { FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, staffApi, type VenueFixture } from '../helpers/venue';
import { waitUntil } from '../helpers/wait';

/**
 * Venue mode with teams (ADR-0026 §7, §8): a table opened by staff starts with the venue's play mode,
 * rules, team names and café window; a winning team earns exactly one code, which goes to one phone.
 */
const CONFIG = {
  ...FAST_GAME_CONFIG,
  simple: {
    answerMs: { STANDARD: 2500, SPEED: 2500, RISK: 2500, CROWD: 2500, FINAL: 2500 },
    prepMs: 2000,
  },
};

let server: TestServer;
let venue: VenueFixture;
beforeAll(async () => {
  server = await startServer({ gameConfig: CONFIG });
  await setVenueFlag(server, true);
  venue = await makeVenue(server, {
    reward: { enabled: true, text: 'Bir içecek bizden', minPlayers: 3 },
    play: {
      defaultMode: 'TEAMS',
      simpleRuleset: true,
      teamNames: ['Gusto Aslanları'],
      simpleAnswerSeconds: 20,
    },
  });
});
afterAll(async () => {
  await server.dispose();
});

const api = () => staffApi(server, venue.staff, venue.venueId);

/**
 * Every phone decides the prep at once and answers each question: the even ones (the tigers) right
 * when `tigersRight`, everybody else wrong.
 */
function play(party: Party, tigersRight: boolean): () => void {
  const stops = party.players.map((client, index) =>
    client.subscribe((message: ServerMessage) => {
      if (message.type !== 'PHASE_ENTERED') return;
      const data = message.payload.data;
      const roomId = party.created.roomId;
      if (data.phase === 'RISK_PICK') {
        client.send('COMMIT_RISK', { stake: 'SAFE', doubleDown: false });
        client.send('COMMIT_SABOTAGE', { sabotage: null });
      }
      if (data.phase !== 'ANSWERING') return;
      client.send('SUBMIT_ANSWER', {
        questionId: data.questionId,
        optionId:
          index % 2 === 0 && tigersRight
            ? correctOptionId(server, roomId)
            : wrongOptionId(server, roomId),
      });
    }),
  );
  return () => stops.forEach((stop) => stop());
}

describe('a table opened with the venue’s defaults', () => {
  it('starts in team play with the simple rules, the venue’s names and its answer window', async () => {
    const party = await createParty(server, 4);
    const opened = await api().open({ minutes: 60, roomCode: party.created.code });
    expect(opened.status).toBe(201);
    await waitUntil(() => liveRoom(server, party.created.roomId).state.settings.play === 'TEAMS');
    const room = liveRoom(server, party.created.roomId).state;
    expect(room.settings).toMatchObject({
      play: 'TEAMS',
      ruleset: 'SIMPLE',
      teamNames: ['Gusto Aslanları'],
    });
    expect(room.playerOrder.map((id) => room.players[id]!.teamId)).toEqual([
      'tiger',
      'owl',
      'tiger',
      'owl',
    ]);
    expect(room.config.simple!.answerMs).toMatchObject({
      STANDARD: 20_000,
      RISK: 20_000,
      CROWD: 20_000,
    });
    expect(room.config.simple!.answerMs).toMatchObject({ SPEED: 2500, FINAL: 2500 }); // the others unchanged
    // the TV and the phones were told, and the leader can still change their mind
    const settings = party.display.messages.filter((m) => m.type === 'SETTINGS_CHANGED');
    expect(settings.length).toBeGreaterThan(0);
    party.leader.send('SET_SETTINGS', { play: 'INDIVIDUAL' });
    await party.leader.nextOfType('ACK');
    expect(
      liveRoom(server, party.created.roomId).state.players[party.leader.playerId!]!.teamId,
    ).toBeUndefined();
    await api().end(opened.body.id);
    await closeParty(party);
  });

  it('keeps the owner’s settings valid: names are screened and cannot repeat', async () => {
    const owner = staffApi(server, venue.owner, venue.venueId);
    const bad = await owner.saveSettings({ play: { teamNames: ['Aynı', 'aynı'] } });
    expect(bad.status).toBe(400);
    const link = await owner.saveSettings({ play: { teamNames: ['www.reklam.com'] } });
    expect(link.status).toBe(400);
    const staffTry = await api().saveSettings({ play: { defaultMode: 'INDIVIDUAL' } });
    expect([401, 403, 404]).toContain(staffTry.status); // only the owner edits settings
    const fine = await owner.saveSettings({
      play: { teamNames: ['Gusto Aslanları', '', 'Kediler'] },
    });
    expect(fine.status).toBe(200);
    expect(await server.built.venues.settings(venue.venueId)).toMatchObject({
      play: { teamNames: ['Gusto Aslanları', '', 'Kediler'], simpleAnswerSeconds: 20 },
    });
    await owner.saveSettings({ play: { teamNames: ['Gusto Aslanları'] } });
  });
});

describe('the reward of a winning team', () => {
  it('goes to one phone of the winning team, a banner names the team, nobody else hears the code', async () => {
    const party = await createParty(server, 4);
    const stop = play(party, true);
    const opened = await api().open({ minutes: 60, roomCode: party.created.code });
    await waitUntil(() => liveRoom(server, party.created.roomId).state.settings.play === 'TEAMS');
    party.leader.send('START_GAME', {});
    await party.display.waitForPhase('RESULTS', 30_000);

    const banner = await party.display.nextOfType('VENUE_REWARD_ISSUED', 8000);
    expect(banner.payload.teamId).toBe('tiger');
    const tigers = [party.players[0]!, party.players[2]!];
    const holder = tigers.find((client) => client.playerId === banner.payload.playerId);
    expect(holder).toBeTruthy();
    const reward = await holder!.nextOfType('VENUE_REWARD', 5000);
    expect(reward.payload.text).toBe('Bir içecek bizden');

    // exactly one code for the game, and no other screen ever saw it
    await party.display.idle(200);
    const rows = await server.db.db
      .selectFrom('venue_rewards')
      .selectAll()
      .where('session_id', '=', opened.body.id)
      .execute();
    expect(rows).toHaveLength(1);
    for (const client of [party.display, ...party.players.filter((c) => c !== holder)]) {
      const everything = JSON.stringify(client.messages);
      expect(everything).not.toContain(reward.payload.code);
      expect(everything).not.toContain('Bir içecek bizden');
    }
    // the winning team's other member is not the owner of the code
    const results = party.display.messages.find(
      (m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'RESULTS',
    );
    expect(results).toBeTruthy();
    stop();
    await api().end(opened.body.id);
    await closeParty(party);
  }, 60_000);

  it('goes to nobody when the teams tie', async () => {
    const party = await createParty(server, 4);
    const stop = play(party, false); // everybody wrong: both teams on zero
    const opened = await api().open({ minutes: 60, roomCode: party.created.code });
    await waitUntil(() => liveRoom(server, party.created.roomId).state.settings.play === 'TEAMS');
    party.leader.send('START_GAME', {});
    await party.display.waitForPhase('RESULTS', 30_000);
    await party.display.idle(600);
    const rows = await server.db.db
      .selectFrom('venue_rewards')
      .select('id')
      .where('session_id', '=', opened.body.id)
      .execute();
    expect(rows).toHaveLength(0);
    expect(party.display.messages.some((m) => m.type === 'VENUE_REWARD_ISSUED')).toBe(false);
    stop();
    await api().end(opened.body.id);
    await closeParty(party);
  }, 60_000);
});
