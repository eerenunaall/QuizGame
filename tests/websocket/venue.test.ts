import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@quizparty/protocol';
import { TestClient } from '../helpers/client';
import { correctOptionId, wrongOptionId } from '../helpers/oracle';
import { closeParty, createParty, type Party } from '../helpers/party';
import { FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, staffApi, type VenueFixture } from '../helpers/venue';

/**
 * Venue mode over real sockets (ADR-0024): the TV hears every change of its table live, time-up lets
 * the question finish and then blocks a new game, an extension reopens it without a reload, and the
 * winner's phone (only that phone) gets the reward code.
 */
const SLOW_ANSWER = {
  ...FAST_GAME_CONFIG,
  timings: {
    ...FAST_GAME_CONFIG.timings,
    answerMs: { STANDARD: 3000, SPEED: 3000, RISK: 3000, CROWD: 3000, FINAL: 3000 },
  },
};

let server: TestServer;
let venue: VenueFixture;
beforeAll(async () => {
  // One metered minute lasts 1.5 s, so a one-minute table runs out inside the first question.
  server = await startServer({ gameConfig: SLOW_ANSWER, env: { VENUE_MINUTE_MS: '1500' } });
  await setVenueFlag(server, true);
  venue = await makeVenue(server, {
    reward: { enabled: true, text: 'Bir türk kahvesi bizden', minPlayers: 3 },
  });
});
afterAll(async () => {
  await server.dispose();
});

const api = () => staffApi(server, venue.staff, venue.venueId);

/** The first `winners` players answer right, the rest wrong, every question. */
function play(party: Party, winners = 1): () => void {
  const stops = party.players.map((client, index) =>
    client.subscribe((message: ServerMessage) => {
      if (message.type !== 'PHASE_ENTERED' || message.payload.data.phase !== 'ANSWERING') return;
      const data = message.payload.data;
      const roomId = party.created.roomId;
      client.send('SUBMIT_ANSWER', {
        questionId: data.questionId,
        optionId: index < winners ? correctOptionId(server, roomId) : wrongOptionId(server, roomId),
      });
    }),
  );
  return () => stops.forEach((stop) => stop());
}

async function errorFor(client: TestClient, messageId: string) {
  const reply = await client.next(
    (m) => (m.type === 'ERROR' || m.type === 'ACK') && m.payload.messageId === messageId,
  );
  return reply.type === 'ERROR' ? reply.payload.code : 'ACK';
}

describe('the TV and the meter', () => {
  it('hears the table open and every extension live, with the time in the room view', async () => {
    const party = await createParty(server, 2);
    const opened = await api().open({ minutes: 60, roomCode: party.created.code });
    const first = await party.display.nextOfType('VENUE_METER_CHANGED');
    expect(first.payload.venue).toMatchObject({ state: 'RUNNING' });
    expect(first.payload.venue.endsAt! - Date.now()).toBeGreaterThan(80_000);
    // phones see the same public meter, nothing more
    const phone = await party.leader.nextOfType('VENUE_METER_CHANGED');
    expect(Object.keys(phone.payload.venue).sort()).toEqual(['endsAt', 'remainingMs', 'state']);

    await api().extend(opened.body.id, 30);
    const extended = await party.display.nextOfType('VENUE_METER_CHANGED');
    expect(extended.payload.venue.endsAt! - first.payload.venue.endsAt!).toBeGreaterThan(40_000);

    await api().pause(opened.body.id);
    const paused = await party.display.nextOfType('VENUE_METER_CHANGED');
    expect(paused.payload.venue).toMatchObject({ state: 'PAUSED', endsAt: null });
    const start = party.leader.send('START_GAME', {});
    expect(await errorFor(party.leader, start)).toBe('VENUE_PAUSED');

    // a reconnecting TV gets the meter in its snapshot
    party.display.drop();
    const tv = await TestClient.connect(server.wsUrl);
    tv.sessionId = party.display.sessionId;
    tv.roomId = party.display.roomId;
    tv.sequence = party.display.sequence;
    const view = await tv.reconnect(party.display.token);
    expect(view.venue).toMatchObject({ state: 'PAUSED' });
    await tv.close();
    await api().end(opened.body.id);
    await closeParty(party);
  });

  it('time-up: the question finishes, results show, no new game; an extension reopens it live', async () => {
    const party = await createParty(server, 2);
    const opened = await api().open({ minutes: 1, roomCode: party.created.code });
    await party.display.nextOfType('VENUE_METER_CHANGED');
    const start = party.leader.send('START_GAME', {});
    expect(await errorFor(party.leader, start)).toBe('ACK');

    const answering = await party.display.waitForPhase('ANSWERING', 8000);
    if (answering.payload.data.phase !== 'ANSWERING') throw new Error('not answering');
    expect(answering.payload.data.round.total).toBeGreaterThan(1);
    // the table's time runs out while the question is open; answers are still taken after it
    const timeUpAt = opened.body.startedAt + 1500;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, timeUpAt + 200 - Date.now())));
    for (const client of party.players) {
      const id = client.send('SUBMIT_ANSWER', {
        questionId: answering.payload.data.questionId,
        optionId: correctOptionId(server, party.created.roomId),
      });
      await client.next((m) => m.type === 'ANSWER_ACCEPTED' && m.payload.messageId === id);
    }
    await party.display.waitForPhase('REVEAL', 8000);
    await party.display.waitForPhase('SCORE_UPDATE', 8000);
    await party.display.waitForPhase('RESULTS', 8000);
    const questions = party.display.messages.filter(
      (m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'ANSWERING',
    );
    expect(questions).toHaveLength(1);

    const rematch = party.leader.send('REMATCH', {});
    expect(await errorFor(party.leader, rematch)).toBe('VENUE_TIME_UP');

    await api().extend(opened.body.id, 30);
    const reopened = await party.display.next(
      (m) => m.type === 'VENUE_METER_CHANGED' && m.payload.venue.remainingMs > 30_000,
    );
    expect(reopened.type).toBe('VENUE_METER_CHANGED');
    const again = party.leader.send('REMATCH', {});
    expect(await errorFor(party.leader, again)).toBe('ACK');
    await party.display.waitForPhase('COUNTDOWN');
    await api().end(opened.body.id);
    await closeParty(party);
  });
});

describe('rewards', () => {
  it('sends the code to the winner only, a banner to the TV, again on reconnect; none for a quick rematch', async () => {
    const party = await createParty(server, 3);
    const stop = play(party, 1);
    const opened = await api().open({ minutes: 60, roomCode: party.created.code });
    party.leader.send('START_GAME', {});
    await party.display.waitForPhase('RESULTS', 20_000);

    const reward = await party.leader.nextOfType('VENUE_REWARD', 5000);
    expect(reward.payload.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/u);
    expect(reward.payload.text).toBe('Bir türk kahvesi bizden');
    expect(reward.payload.expiresAt).toBeGreaterThan(Date.now());
    const banner = await party.display.nextOfType('VENUE_REWARD_ISSUED');
    expect(banner.payload.playerId).toBe(party.leader.playerId);

    // nobody else ever receives the code or the reward text
    await party.display.idle(200);
    for (const client of [party.display, ...party.players.slice(1)]) {
      const everything = JSON.stringify(client.messages);
      expect(everything).not.toContain(reward.payload.code);
      expect(everything).not.toContain('Bir türk kahvesi');
    }

    const rows = await server.db.db
      .selectFrom('venue_rewards')
      .selectAll()
      .where('session_id', '=', opened.body.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.winner_display_name).toBe('Oyuncu1');
    expect(JSON.stringify(rows)).not.toContain(reward.payload.code);

    // the winner's phone reloads: the code comes back while the results are on screen
    party.leader.drop();
    const back = await TestClient.connect(server.wsUrl);
    back.sessionId = party.leader.sessionId;
    back.roomId = party.leader.roomId;
    back.sequence = party.leader.sequence;
    await back.reconnect(party.leader.token);
    const resent = await back.nextOfType('VENUE_REWARD', 3000);
    expect(resent.payload.code).toBe(reward.payload.code);

    // a rematch straight away earns nothing (cool-down), whoever wins
    const stopBack = back.subscribe((message: ServerMessage) => {
      if (message.type !== 'PHASE_ENTERED' || message.payload.data.phase !== 'ANSWERING') return;
      back.send('SUBMIT_ANSWER', {
        questionId: message.payload.data.questionId,
        optionId: correctOptionId(server, party.created.roomId),
      });
    });
    back.send('REMATCH', {});
    await party.display.waitForPhase('COUNTDOWN');
    await party.display.waitForPhase('RESULTS', 20_000);
    await back.idle(400);
    expect(
      back.drain().some((m) => m.type === 'VENUE_REWARD' && m.payload.code !== reward.payload.code),
    ).toBe(false);
    const after = await server.db.db
      .selectFrom('venue_rewards')
      .select('id')
      .where('session_id', '=', opened.body.id)
      .execute();
    expect(after).toHaveLength(1);
    stopBack();
    stop();
    await back.close();
    await api().end(opened.body.id);
    await closeParty(party);
  });

  it('gives nothing for a shared first place or with fewer players than the venue asks for', async () => {
    for (const [players, winners] of [
      [3, 0],
      [2, 1],
    ] as const) {
      const party = await createParty(server, players);
      const stop = play(party, winners);
      const opened = await api().open({ minutes: 60, roomCode: party.created.code });
      party.leader.send('START_GAME', {});
      await party.display.waitForPhase('RESULTS', 20_000);
      await party.display.idle(500);
      for (const client of [party.display, ...party.players])
        expect(
          client.drain().some((m) => m.type === 'VENUE_REWARD' || m.type === 'VENUE_REWARD_ISSUED'),
        ).toBe(false);
      stop();
      await api().end(opened.body.id);
      await closeParty(party);
    }
  });
});
