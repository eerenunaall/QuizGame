import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanForbiddenKeys } from '@quizparty/protocol';
import type { TestClient } from '../helpers/client';
import { closeParty, createParty, type Party } from '../helpers/party';
import { preRevealLeaks } from '../helpers/scan';
import {
  answerRound,
  inPhase,
  lastDeltas,
  componentSum,
  roomOf,
  say,
  startGame,
  toRound,
} from '../helpers/rounds';
import { FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

/**
 * ATTACK 35: abuse the ADR-0023 intents. Cover, Pot, Duel (challenge and reply), Stake Cap, Cut and
 * Blind Clock are all server-judged; the attacker tries the wrong phase, the wrong target, a replay,
 * the leader, a forged reply and a peek at what others chose. The defender's ledger must not move and
 * nothing private may reach the attacker or the TV.
 */
const CONFIG = {
  ...FAST_GAME_CONFIG,
  defaultRounds: 8,
  timings: {
    ...FAST_GAME_CONFIG.timings,
    riskPickMs: 6000,
    sabotagePickMs: 6000,
    riskPickDecisionMs: 6000,
    answerMs: { STANDARD: 5000, SPEED: 5000, RISK: 5000, CROWD: 5000, FINAL: 5000 },
  },
  powers: { shieldPerGame: 0, sabotage: { maxPerRound: 3 } },
};

let server: TestServer;
beforeAll(async () => {
  server = await startServer({ gameConfig: CONFIG });
});
afterAll(async () => {
  await server.dispose();
});

const risk = (stake: 'SAFE' | 'RISK' | 'HIGH', extra: Record<string, unknown> = {}) => ({
  stake,
  doubleDown: false,
  ...extra,
});
const ledger = (party: Party, client: TestClient) =>
  roomOf(server, party).state.game!.players[client.playerId!]!.powers;
const commitments = (party: Party) => roomOf(server, party).state.game!.round!.commitments;

/** Three players, round 0 played (everybody has points), standing in RISK_PICK of round 1. */
async function roundOne() {
  const party = await createParty(server, 3);
  await startGame(party, 8);
  await toRound(server, party, 1, ['correct', 'correct', 'correct']);
  return party;
}
/** p2 is last on the table, so p0 leads and p1 is in the middle; standing in SABOTAGE_PICK of round 2. */
async function sabotageTime() {
  const party = await createParty(server, 3);
  await startGame(party, 8);
  await toRound(server, party, 2, ['correct', 'correct', 'wrong']);
  for (const c of party.players) c.send('COMMIT_RISK', risk('SAFE'));
  await inPhase(server, party, 'SABOTAGE_PICK', 2);
  return party;
}

describe('ATTACK 35 — wrong phase', () => {
  it('Cover, Pot and a challenge are refused outside RISK_PICK, a reply too, and nothing is spent', async () => {
    const party = await sabotageTime();
    const [a, b] = party.players as [TestClient, TestClient, TestClient];
    expect(await say(a, 'COMMIT_RISK', risk('RISK', { cover: true }))).toBe('INVALID_STATE');
    expect(await say(a, 'COMMIT_RISK', risk('SAFE', { pot: true }))).toBe('INVALID_STATE');
    expect(await say(a, 'COMMIT_RISK', risk('RISK', { duel: { targetId: b.playerId } }))).toBe(
      'INVALID_STATE',
    );
    expect(await say(a, 'RESPOND_DUEL', { challengerId: b.playerId, accept: true })).toBe(
      'INVALID_STATE',
    );
    expect(ledger(party, a)).toMatchObject({ cover: 1, pots: 2, duels: 2 });
    await closeParty(party);
  });

  it('the new sabotages are refused in RISK_PICK, and in the lobby', async () => {
    const party = await roundOne();
    const [a, b] = party.players as [TestClient, TestClient, TestClient];
    for (const effect of ['STAKE_CAP', 'CUT', 'BLIND_CLOCK']) {
      expect(await say(a, 'COMMIT_SABOTAGE', { sabotage: { targetId: b.playerId, effect } })).toBe(
        'INVALID_STATE',
      );
    }
    await closeParty(party);
    const lobby = await createParty(server, 2);
    expect(await say(lobby.players[0]!, 'RESPOND_DUEL', { challengerId: 'x', accept: true })).toBe(
      'INVALID_STATE',
    );
    await closeParty(lobby);
  });

  it('a reply to a Duel after the question opened is too late', async () => {
    const party = await roundOne();
    const [a, b, c] = party.players as [TestClient, TestClient, TestClient];
    await say(a, 'COMMIT_RISK', risk('RISK', { duel: { targetId: b.playerId } }));
    await say(c, 'COMMIT_RISK', risk('SAFE'));
    await say(b, 'COMMIT_RISK', risk('SAFE'));
    // the room waits for b; let the phase time out instead
    await inPhase(server, party, 'ANSWERING', 1);
    expect(await say(b, 'RESPOND_DUEL', { challengerId: a.playerId, accept: true })).toBe(
      'INVALID_STATE',
    );
    await answerRound(server, party, ['wrong', 'correct', 'correct']);
    await inPhase(server, party, 'SCORE_UPDATE', 1);
    expect(componentSum(lastDeltas(server, party), 'DUEL')).toBe(0); // never accepted
    await closeParty(party);
  });
});

describe('ATTACK 35 — wrong target', () => {
  it('refuses a Duel at yourself, a stranger, the TV and an offline player, and keeps the use', async () => {
    const party = await roundOne();
    const [a, b, c] = party.players as [TestClient, TestClient, TestClient];
    const hostile: [string, string][] = [
      ['yourself', a.playerId!],
      ['a stranger', 'nobody-here'],
      ['the TV', party.created.display.sessionId],
    ];
    for (const [label, targetId] of hostile) {
      expect(await say(a, 'COMMIT_RISK', risk('RISK', { duel: { targetId } })), label).toBe(
        'TARGET_INVALID',
      );
    }
    // c goes offline
    c.sendRaw('{');
    await c.close();
    await waitUntil(
      () => roomOf(server, party).state.players[c.playerId!]!.connection === 'DISCONNECTED',
      5_000,
      'c to drop',
    );
    expect(await say(a, 'COMMIT_RISK', risk('RISK', { duel: { targetId: c.playerId } }))).toBe(
      'TARGET_INVALID',
    );
    expect(ledger(party, a).duels).toBe(2);
    expect(commitments(party)[a.playerId!]).toBeUndefined();
    expect(b.playerId).toBeTruthy();
    await closeParty(party);
  });

  it('refuses Cut on the leader and on a player with no points, and spends no token', async () => {
    const party = await sabotageTime();
    const [leader, middle, last] = party.players as [TestClient, TestClient, TestClient];
    expect(
      await say(middle, 'COMMIT_SABOTAGE', {
        sabotage: { targetId: leader.playerId, effect: 'CUT' },
      }),
    ).toBe('TARGET_INVALID');
    expect(
      await say(leader, 'COMMIT_SABOTAGE', {
        sabotage: { targetId: last.playerId, effect: 'CUT' },
      }),
    ).toBe('TARGET_INVALID'); // the last player has nothing to cut
    expect(ledger(party, middle).tokens).toBeGreaterThan(0);
    expect(ledger(party, leader).lastSabotageRound).toBeNull();
    expect(
      await say(middle, 'COMMIT_SABOTAGE', {
        sabotage: { targetId: 'stranger', effect: 'BLIND_CLOCK' },
      }),
    ).toBe('TARGET_INVALID');
    await closeParty(party);
  });

  it('the leader is out of reach for Cut, the player behind is fair game', async () => {
    const party = await sabotageTime();
    const [leader, middle, last] = party.players as [TestClient, TestClient, TestClient];
    expect(
      await say(last, 'COMMIT_SABOTAGE', {
        sabotage: { targetId: leader.playerId, effect: 'CUT' },
      }),
    ).toBe('TARGET_INVALID');
    expect(
      await say(last, 'COMMIT_SABOTAGE', {
        sabotage: { targetId: middle.playerId, effect: 'CUT' },
      }),
    ).toBe('OK');
    await closeParty(party);
  });
});

describe('ATTACK 35 — replay', () => {
  it('a replayed challenge costs one use, not two', async () => {
    const party = await roundOne();
    const [a, b] = party.players as [TestClient, TestClient, TestClient];
    expect(await say(a, 'COMMIT_RISK', risk('RISK', { duel: { targetId: b.playerId } }))).toBe(
      'OK',
    );
    const frame = a.lastSentFrame!;
    a.sendRaw(frame);
    expect((await a.nextOfType('ERROR')).payload.code).toBe('STALE_SEQUENCE');
    const captured = JSON.parse(frame) as Record<string, unknown>;
    a.sendRaw(JSON.stringify({ ...captured, sequence: ++a.sequence }));
    expect((await a.nextOfType('ERROR')).payload.code).toBe('ALREADY_COMMITTED');
    expect(ledger(party, a).duels).toBe(1);
    // another socket cannot use the captured frame
    b.sendRaw(frame);
    expect(['FORBIDDEN', 'UNAUTHORIZED', 'STALE_SEQUENCE', 'INVALID_STATE']).toContain(
      (await b.nextOfType('ERROR')).payload.code,
    );
    expect(commitments(party)[b.playerId!]).toBeUndefined();
    await closeParty(party);
  });

  it('a replayed reply is refused as already answered and cannot flip a decline into an accept', async () => {
    const party = await roundOne();
    const [a, b] = party.players as [TestClient, TestClient, TestClient];
    await say(a, 'COMMIT_RISK', risk('RISK', { duel: { targetId: b.playerId } }));
    expect(await say(b, 'RESPOND_DUEL', { challengerId: a.playerId, accept: false })).toBe('OK');
    const frame = b.lastSentFrame!;
    const captured = JSON.parse(frame) as { payload: Record<string, unknown> };
    b.sendRaw(
      JSON.stringify({
        ...captured,
        sequence: ++b.sequence,
        messageId: crypto.randomUUID(),
        payload: { ...captured.payload, accept: true },
      }),
    );
    expect((await b.nextOfType('ERROR')).payload.code).toBe('ALREADY_COMMITTED');
    expect(roomOf(server, party).state.game!.round!.duelAnswers?.[b.playerId!]).toEqual({
      [a.playerId!]: 'DECLINED',
    });
    await closeParty(party);
  });
});

describe('ATTACK 35 — forged replies', () => {
  it('cannot accept a challenge nobody made, answer for somebody else, or answer your own', async () => {
    const party = await roundOne();
    const [a, b, c] = party.players as [TestClient, TestClient, TestClient];
    // nothing was challenged
    expect(await say(b, 'RESPOND_DUEL', { challengerId: a.playerId, accept: true })).toBe(
      'POWER_UNAVAILABLE',
    );
    await say(a, 'COMMIT_RISK', risk('RISK', { duel: { targetId: b.playerId } }));
    // c was not challenged: c's "accept" of a's duel is a forgery
    expect(await say(c, 'RESPOND_DUEL', { challengerId: a.playerId, accept: true })).toBe(
      'POWER_UNAVAILABLE',
    );
    // the challenger cannot accept on the rival's behalf
    expect(await say(a, 'RESPOND_DUEL', { challengerId: a.playerId, accept: true })).toBe(
      'POWER_UNAVAILABLE',
    );
    // a forged rival id is not part of the message: it is an unknown field
    expect(
      await say(a, 'RESPOND_DUEL', { challengerId: a.playerId, accept: true, rivalId: b.playerId }),
    ).toBe('INVALID_MESSAGE');
    expect(roomOf(server, party).state.game!.round!.duelAnswers ?? {}).toEqual({});
    await closeParty(party);
  });

  it('accepting after HIGH, Double Down or another accepted duel is refused (one big gamble)', async () => {
    const party = await roundOne();
    const [a, b, c] = party.players as [TestClient, TestClient, TestClient];
    await say(b, 'COMMIT_RISK', risk('HIGH'));
    await say(a, 'COMMIT_RISK', risk('RISK', { duel: { targetId: b.playerId } }));
    expect(await say(b, 'RESPOND_DUEL', { challengerId: a.playerId, accept: true })).toBe(
      'BIG_GAMBLE_CONFLICT',
    );
    await say(c, 'COMMIT_RISK', risk('SAFE'));
    expect(await say(b, 'RESPOND_DUEL', { challengerId: a.playerId, accept: false })).toBe('OK');
    await closeParty(party);
    const second = await roundOne();
    const [x, y, z] = second.players as [TestClient, TestClient, TestClient];
    await say(x, 'COMMIT_RISK', risk('RISK', { duel: { targetId: z.playerId } }));
    await say(y, 'COMMIT_RISK', risk('RISK', { duel: { targetId: z.playerId } }));
    expect(await say(z, 'RESPOND_DUEL', { challengerId: x.playerId, accept: true })).toBe('OK');
    expect(await say(z, 'RESPOND_DUEL', { challengerId: y.playerId, accept: true })).toBe(
      'DUEL_LIMIT',
    );
    // having accepted, z cannot also go HIGH or Double Down
    expect(await say(z, 'COMMIT_RISK', risk('HIGH'))).toBe('BIG_GAMBLE_CONFLICT');
    expect(await say(z, 'COMMIT_RISK', { stake: 'RISK', doubleDown: true })).toBe(
      'BIG_GAMBLE_CONFLICT',
    );
    await closeParty(second);
  });
});

describe('ATTACK 35 — one big gamble and illegal combinations', () => {
  it('refuses every illegal pair without spending anything', async () => {
    const party = await roundOne();
    const [a, b] = party.players as [TestClient, TestClient, TestClient];
    const duel = { targetId: b.playerId };
    const hostile: [string, unknown, string][] = [
      ['a Duel under HIGH', risk('HIGH', { duel }), 'BIG_GAMBLE_CONFLICT'],
      ['a Duel with Double Down', { stake: 'RISK', doubleDown: true, duel }, 'BIG_GAMBLE_CONFLICT'],
      [
        'Cover with Double Down',
        { stake: 'RISK', doubleDown: true, cover: true },
        'BIG_GAMBLE_CONFLICT',
      ],
      ['Cover on SAFE', risk('SAFE', { cover: true }), 'STAKE_INVALID'],
      ['HIGH with Double Down', { stake: 'HIGH', doubleDown: true }, 'DOUBLE_DOWN_STAKE_CONFLICT'],
    ];
    for (const [label, payload, code] of hostile) {
      expect(await say(a, 'COMMIT_RISK', payload), label).toBe(code);
    }
    expect(ledger(party, a)).toMatchObject({ cover: 1, doubleDown: 2, duels: 2, pots: 2 });
    expect(commitments(party)[a.playerId!]).toBeUndefined();
    await closeParty(party);
  });

  it('refuses smuggled and mistyped fields', async () => {
    const party = await roundOne();
    const [a, b] = party.players as [TestClient, TestClient, TestClient];
    const hostile: [string, unknown][] = [
      ['a string for cover', risk('RISK', { cover: 'yes' })],
      ['a number for pot', risk('RISK', { pot: 1 })],
      ['a duel with no target', risk('RISK', { duel: {} })],
      ['a duel with a numeric target', risk('RISK', { duel: { targetId: 7 } })],
      ['a duel with extra fields', risk('RISK', { duel: { targetId: b.playerId, points: 9999 } })],
      ['a smuggled fee', risk('RISK', { cover: true, fee: 0 })],
      ['a smuggled ante', risk('SAFE', { pot: true, ante: 0 })],
    ];
    for (const [label, payload] of hostile) {
      expect(await say(a, 'COMMIT_RISK', payload), label).toBe('INVALID_MESSAGE');
    }
    expect(ledger(party, a)).toMatchObject({ cover: 1, pots: 2, duels: 2 });
    await closeParty(party);
  });

  it('spam gets one commitment: a second challenge to somebody else is already committed', async () => {
    const party = await roundOne();
    const [a, b, c] = party.players as [TestClient, TestClient, TestClient];
    expect(await say(a, 'COMMIT_RISK', risk('RISK', { duel: { targetId: b.playerId } }))).toBe(
      'OK',
    );
    expect(await say(a, 'COMMIT_RISK', risk('RISK', { duel: { targetId: c.playerId } }))).toBe(
      'ALREADY_COMMITTED',
    );
    expect(ledger(party, a).duels).toBe(1);
    await closeParty(party);
  });

  it('Pot needs the ante: nobody can ante at the start of a game', async () => {
    const party = await createParty(server, 3);
    await startGame(party, 8);
    await inPhase(server, party, 'RISK_PICK', 0);
    expect(await say(party.players[0]!, 'COMMIT_RISK', risk('SAFE', { pot: true }))).toBe(
      'POWER_UNAVAILABLE',
    );
    await closeParty(party);
  });

  it('Stake Cap cannot be dodged: a capped player is refused HIGH, whatever the wording', async () => {
    const party = await sabotageTime();
    const [leader, , last] = party.players as [TestClient, TestClient, TestClient];
    expect(
      await say(leader, 'COMMIT_SABOTAGE', {
        sabotage: { targetId: last.playerId, effect: 'STAKE_CAP' },
      }),
    ).toBe('OK');
    await answerRound(server, party, ['correct', 'correct', 'correct']);
    await inPhase(server, party, 'RISK_PICK', 3);
    await waitUntil(() => ledger(party, last).stakeCap?.tier === 'RISK', 5_000, 'the cap');
    expect(await say(last, 'COMMIT_RISK', risk('HIGH'))).toBe('STAKE_INVALID');
    expect(await say(last, 'COMMIT_RISK', { stake: 'ALL_IN', doubleDown: false })).toBe(
      'STAKE_INVALID',
    );
    expect(commitments(party)[last.playerId!]).toBeUndefined();
    await closeParty(party);
  });
});

describe('ATTACK 35 — what an attacker can learn', () => {
  it('nothing about who challenged whom, who covered, who anted: only its own private view', async () => {
    const party = await roundOne();
    const [a, b, c] = party.players as [TestClient, TestClient, TestClient];
    const watchers = [party.display, c];
    const marks = new Map(watchers.map((w) => [w, w.messages.length]));
    await say(
      a,
      'COMMIT_RISK',
      risk('RISK', { cover: true, pot: true, duel: { targetId: b.playerId } }),
    );
    await say(b, 'COMMIT_RISK', risk('SAFE', { pot: true }));
    await waitUntil(
      () =>
        b.messages.some(
          (m) => m.type === 'PLAYER_STATE' && (m.payload.you.duelInvites?.length ?? 0) > 0,
        ),
      5_000,
      'the invite on b',
    );
    for (const watcher of watchers) {
      // `risks` is what the phase offers (config, the same for everybody), not what anybody chose.
      const seen = JSON.stringify(
        watcher.messages.slice(marks.get(watcher)).map((m) => m.payload),
        (key, value: unknown) => (key === 'risks' ? undefined : value),
      );
      for (const secret of [
        'duelInvites',
        'challengerId',
        '"cover":true',
        '"pot":true',
        '"duel":{',
      ]) {
        expect(seen, secret).not.toContain(secret);
      }
      expect(seen).not.toContain(a.playerId!.concat('","answer'));
    }
    // the only progress frames anyone gets are bare counts
    for (const watcher of watchers) {
      for (const m of watcher.messages.slice(marks.get(watcher))) {
        if (m.type === 'PREP_PROGRESS')
          expect(Object.keys(m.payload).sort()).toEqual(['committedCount', 'eligibleCount']);
      }
    }
    // c asks for the room state: still only its own view
    c.send('REQUEST_STATE', {});
    const snapshot = await c.nextOfType('ROOM_STATE');
    expect(snapshot.payload.room.you?.commitment ?? null).toBeNull();
    expect(snapshot.payload.room.you?.duelInvites).toBeUndefined();
    for (const client of [party.display, ...party.players])
      expect(preRevealLeaks(client)).toEqual([]);
    await answerRound(server, party, ['correct', 'correct', 'correct']);
    await closeParty(party);
  });

  it('no frame before the reveal carries a forbidden key, with every new feature in play', async () => {
    const party = await roundOne();
    const [a, b, c] = party.players as [TestClient, TestClient, TestClient];
    await say(
      a,
      'COMMIT_RISK',
      risk('RISK', { cover: true, pot: true, duel: { targetId: b.playerId } }),
    );
    await say(b, 'COMMIT_RISK', risk('SAFE', { pot: true }));
    await say(b, 'RESPOND_DUEL', { challengerId: a.playerId, accept: true });
    await say(c, 'COMMIT_RISK', risk('SAFE', { pot: true }));
    await answerRound(server, party, ['correct', 'wrong', 'correct']);
    await inPhase(server, party, 'SCORE_UPDATE', 1);
    for (const client of [party.display, ...party.players]) {
      expect(preRevealLeaks(client)).toEqual([]);
      for (const m of client.messages) {
        if (m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'ANSWERING')
          expect(scanForbiddenKeys(m.payload)).toEqual([]);
      }
    }
    await closeParty(party);
  });

  it('the menu on the TV is config: it names no player and no pick', async () => {
    const party = await sabotageTime();
    const [leader, , last] = party.players as [TestClient, TestClient, TestClient];
    await say(leader, 'COMMIT_SABOTAGE', {
      sabotage: { targetId: last.playerId, effect: 'BLIND_CLOCK' },
    });
    party.display.send('REQUEST_STATE', {});
    const view = await party.display.nextOfType('ROOM_STATE');
    const data = view.payload.room.phaseData;
    expect(data).toMatchObject({ phase: 'SABOTAGE_PICK', committedCount: 1 });
    expect(JSON.stringify(data)).not.toContain(leader.playerId!);
    expect(JSON.stringify(data)).not.toContain(last.playerId!);
    await closeParty(party);
  });
});
