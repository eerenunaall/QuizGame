import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Phase } from '@quizparty/protocol';
import { closeParty, createParty } from '../helpers/party';
import { autoAnswer } from '../helpers/play';
import { startGame } from '../helpers/rounds';
import { preRevealLeaks } from '../helpers/scan';
import { startServer, type TestServer } from '../helpers/server';
import {
  makeVenue,
  seedVenueQuestions,
  setVenueFlag,
  staffApi,
  type VenueFixture,
} from '../helpers/venue';
import type { TestClient } from '../helpers/client';

/**
 * A game at a café table draws the venue's own questions (ADR-0025), and they travel in the same
 * allow-listed views as the bank's: the correct answer and the explanation are not on the wire before the
 * reveal, and another venue's questions never appear.
 */
let server: TestServer;
let venue: VenueFixture;
let other: VenueFixture;
beforeAll(async () => {
  server = await startServer();
  await setVenueFlag(server, true);
  venue = await makeVenue(server, { questions: { source: 'VENUE_ONLY' } });
  other = await makeVenue(server, { questions: { source: 'VENUE_ONLY' } });
  await seedVenueQuestions(server, venue.venueId, 60, { prefix: 'Kafem' });
  await seedVenueQuestions(server, other.venueId, 60, { prefix: 'Komşu' });
});
afterAll(async () => {
  await server.dispose();
});

const POST_REVEAL: ReadonlySet<Phase> = new Set(['REVEAL', 'POWER_RESOLUTION', 'SCORE_UPDATE']);

/** Frames (as text) delivered while the room was before the reveal of its question. */
function preRevealFrames(client: TestClient): string[] {
  const out: string[] = [];
  let phase: Phase = 'LOBBY';
  for (const message of client.messages) {
    const payload = message.payload as { data?: { phase: Phase }; room?: { phase: Phase } };
    if (message.type === 'PHASE_ENTERED') phase = (payload.data as { phase: Phase }).phase;
    else if (payload.room) phase = payload.room.phase;
    if (!POST_REVEAL.has(phase) && phase !== 'RESULTS') out.push(JSON.stringify(message));
  }
  return out;
}

describe('a venue table plays the venue questions', () => {
  it('shows them on the TV and phones, never early answers, never another venue', async () => {
    const party = await createParty(server, 3);
    const stops = party.players.map((client, index) => autoAnswer(client, index));
    const opened = await staffApi(server, venue.owner, venue.venueId).open({
      minutes: 60,
      roomCode: party.created.code,
    });
    expect(opened.status).toBe(201);
    await party.display.nextOfType('VENUE_METER_CHANGED');
    await startGame(party, 3);
    await party.display.waitForPhase('RESULTS', 40_000);

    const frames = (client: TestClient): string[] => client.messages.map((m) => JSON.stringify(m));
    const clients = [party.display, ...party.players];
    for (const client of clients) {
      const all = frames(client).join('\n');
      expect(all).toContain('Kafem sorusu');
      expect(all).not.toContain('Komşu');
      // the explanation (and with it the answer's reasoning) is only ever sent at the reveal
      expect(preRevealFrames(client).join('\n')).not.toContain('Kafem açıklaması');
      expect(preRevealLeaks(client)).toEqual([]);
    }
    // ... and it is sent at the reveal
    expect(frames(party.display).join('\n')).toContain('Kafem açıklaması');
    stops.forEach((stop) => stop());
    await closeParty(party);
  });

  it('a table with GLOBAL_ONLY, or no table at all, plays no venue question', async () => {
    await staffApi(server, venue.owner, venue.venueId).saveSettings({
      questions: { source: 'GLOBAL_ONLY' },
    });
    const party = await createParty(server, 3);
    const stops = party.players.map((client, index) => autoAnswer(client, index));
    await staffApi(server, venue.owner, venue.venueId).open({
      minutes: 60,
      roomCode: party.created.code,
    });
    await party.display.nextOfType('VENUE_METER_CHANGED');
    await startGame(party, 3);
    await party.display.waitForPhase('RESULTS', 40_000);
    for (const client of [party.display, ...party.players])
      expect(client.messages.map((m) => JSON.stringify(m)).join('\n')).not.toMatch(/Kafem|Komşu/u);
    stops.forEach((stop) => stop());
    await closeParty(party);
  });
});
