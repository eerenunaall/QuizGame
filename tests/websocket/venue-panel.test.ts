import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeParty, createParty } from '../helpers/party';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, staffApi, type VenueFixture } from '../helpers/venue';

/**
 * The venue panel's settings reach the screens (ADR-0030 §3): the entrance line and the venue's look ride
 * on the table's meter only, an owner's edit follows live, and a room without a table carries none of it.
 */
let server: TestServer;
let venue: VenueFixture;
beforeAll(async () => {
  server = await startServer({ env: { DEFAULT_ROOM_TIER: 'FREE' } });
  await setVenueFlag(server, true);
  venue = await makeVenue(server, {
    entrance: { enabled: true, text: '150 TL, içecek dahil', note: 'Hafta sonu 20 TL fazla' },
    look: { theme: 'venue-gold', accent: 'mint' },
  });
});
afterAll(async () => {
  await server.dispose();
});

const staff = () => staffApi(server, venue.staff, venue.venueId);
const owner = () => staffApi(server, venue.owner, venue.venueId);

describe('entrance line and look on the table meter', () => {
  it('rides on the meter of an open table to the TV and the phones, and a room without a table has none', async () => {
    const party = await createParty(server, 2);
    party.leader.send('REQUEST_STATE', {});
    const before = await party.leader.nextOfType('ROOM_STATE');
    expect(before.payload.room.venue).toBeUndefined();

    const opened = await staff().open({ minutes: 60, roomCode: party.created.code });
    const tv = await party.display.nextOfType('VENUE_METER_CHANGED');
    expect(tv.payload.venue.entrance).toEqual({
      text: '150 TL, içecek dahil',
      note: 'Hafta sonu 20 TL fazla',
    });
    expect(tv.payload.venue.look).toMatchObject({ theme: 'venue-gold', accent: 'mint' });
    const phone = await party.leader.nextOfType('VENUE_METER_CHANGED');
    expect(phone.payload.venue.entrance?.text).toBe('150 TL, içecek dahil');

    // a snapshot (a reconnecting phone) carries the same allow-listed fields and no settings
    party.leader.send('REQUEST_STATE', {});
    const { room } = (await party.leader.nextOfType('ROOM_STATE')).payload;
    expect(Object.keys(room.venue ?? {}).sort()).toEqual([
      'endsAt',
      'entrance',
      'look',
      'remainingMs',
      'state',
    ]);
    expect(JSON.stringify(room)).not.toContain('"reward"');
    await staff().end(opened.body.id);
    await closeParty(party);
  });

  it('follows an owner edit live while the table is open, and drops the line when switched off', async () => {
    const party = await createParty(server, 2);
    const opened = await staff().open({ minutes: 60, roomCode: party.created.code });
    await party.display.nextOfType('VENUE_METER_CHANGED');

    const saved = await owner().saveSettings({ entrance: { text: '200 TL, iki içecek dahil' } });
    expect(saved.status).toBe(200);
    const changed = await party.display.next(
      (m) =>
        m.type === 'VENUE_METER_CHANGED' &&
        m.payload.venue.entrance?.text === '200 TL, iki içecek dahil',
    );
    expect(changed.type).toBe('VENUE_METER_CHANGED');

    await owner().saveSettings({ entrance: { enabled: false } });
    const off = await party.display.next(
      (m) => m.type === 'VENUE_METER_CHANGED' && m.payload.venue.entrance === undefined,
    );
    expect(off.type).toBe('VENUE_METER_CHANGED');
    await staff().end(opened.body.id);
    await closeParty(party);
  });
});
