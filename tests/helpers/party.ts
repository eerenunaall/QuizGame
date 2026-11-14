import { TestClient } from './client';
import type { CreatedRoom, TestServer } from './server';
import { createRoom } from './server';

export interface Party {
  created: CreatedRoom;
  display: TestClient;
  players: TestClient[];
  /** The first player to join (becomes the leader). */
  leader: TestClient;
}

export interface PartyOptions {
  /** Source address per player (index-aligned) to simulate clients on different networks. */
  localAddresses?: string[];
  nicknames?: string[];
}

/** A TV display plus `playerCount` joined phones, all on real WebSockets. */
export async function createParty(
  server: TestServer,
  playerCount = 3,
  options: PartyOptions = {},
): Promise<Party> {
  const created = await createRoom(server);
  const display = await TestClient.connect(server.wsUrl);
  await display.attachDisplay(created);
  const players: TestClient[] = [];
  for (let i = 0; i < playerCount; i++) {
    const address = options.localAddresses?.[i];
    const client = await TestClient.connect(server.wsUrl, address ? { localAddress: address } : {});
    await client.join(server.wsUrl, created.code, options.nicknames?.[i] ?? `Oyuncu${i + 1}`);
    players.push(client);
  }
  return { created, display, players, leader: players[0]! };
}

export async function closeParty(party: Party): Promise<void> {
  await Promise.all([party.display.close(), ...party.players.map((client) => client.close())]);
}
