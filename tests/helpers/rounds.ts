import type { ErrorCode, ServerMessage } from '@quizparty/protocol';
import type { TestClient } from './client';
import { liveRoom, correctOptionId, wrongOptionId } from './oracle';
import type { Party } from './party';
import type { TestServer } from './server';
import { waitUntil } from './wait';

/**
 * Drives whole rounds of a socket party by watching the live room (the server's own state) while every
 * command still goes over a real WebSocket. Used by the ADR-0023 ws and red-team tests.
 */
export function roomOf(server: TestServer, party: Party) {
  return liveRoom(server, party.created.roomId);
}

export async function startGame(party: Party, rounds = 6): Promise<void> {
  party.leader.send('SET_SETTINGS', { rounds });
  await party.leader.nextOfType('ACK');
  party.leader.send('START_GAME', {});
}

/** Waits until the room is in `phase` (of round `index`, when given). */
export function inPhase(server: TestServer, party: Party, phase: string, index?: number) {
  return waitUntil(
    () => {
      const state = roomOf(server, party).state;
      return (
        state.phase === phase &&
        (index === undefined || state.game?.round?.index === index) &&
        state
      );
    },
    15_000,
    `${phase}${index === undefined ? '' : ` of round ${index}`}`,
  );
}

/** The reply to the command with this message id: `OK` for an ACK, else the error code. */
export async function reply(client: TestClient, messageId: string): Promise<ErrorCode | 'OK'> {
  const message = await client.next(
    (m: ServerMessage) =>
      (m.type === 'ACK' || m.type === 'ERROR') && m.payload.messageId === messageId,
    5_000,
    `a reply to ${messageId}`,
  );
  return message.type === 'ERROR' ? message.payload.code : 'OK';
}

/** Sends one command and waits for its own reply. */
export async function say(
  client: TestClient,
  type: Parameters<TestClient['send']>[0],
  payload: unknown,
): Promise<ErrorCode | 'OK'> {
  return reply(client, client.send(type, payload));
}

export type Pick = 'correct' | 'wrong' | 'none';

/** Everybody answers as `picks` says (default correct); `staggerMs` spaces the answers so speed differs. */
export async function answerRound(
  server: TestServer,
  party: Party,
  picks: Pick[] = [],
  staggerMs = 40,
): Promise<void> {
  await waitUntil(() => roomOf(server, party).state.phase === 'ANSWERING', 15_000, 'ANSWERING');
  const live = roomOf(server, party).state.game!.round!.question!;
  for (const [i, client] of party.players.entries()) {
    const pick = picks[i] ?? 'correct';
    if (pick === 'none') continue;
    const optionId =
      pick === 'correct'
        ? correctOptionId(server, party.created.roomId)
        : wrongOptionId(server, party.created.roomId);
    client.send('SUBMIT_ANSWER', { questionId: live.questionId, optionId });
    if (staggerMs > 0) await new Promise((resolve) => setTimeout(resolve, staggerMs));
  }
}

/** Plays rounds 0..index-1 with everyone SAFE (passing sabotage), `picks` answers, until `index` is in RISK_PICK. */
export async function toRound(
  server: TestServer,
  party: Party,
  index: number,
  picks: Pick[] = [],
): Promise<void> {
  for (;;) {
    await waitUntil(
      () => {
        const state = roomOf(server, party).state;
        return state.phase === 'RISK_PICK' || state.phase === 'RESULTS';
      },
      15_000,
      'RISK_PICK',
    );
    if (roomOf(server, party).state.game!.round!.index === index) return;
    const here = roomOf(server, party).state.game!.round!.index;
    for (const c of party.players) c.send('COMMIT_RISK', { stake: 'SAFE', doubleDown: false });
    await waitUntil(
      () => {
        const phase = roomOf(server, party).state.phase;
        if (phase === 'SABOTAGE_PICK') return 'sabotage';
        return phase === 'QUESTION' || phase === 'ANSWERING' ? 'question' : false;
      },
      15_000,
      'the end of RISK_PICK',
    ).then((next) => {
      if (next === 'sabotage')
        for (const c of party.players) c.send('COMMIT_SABOTAGE', { sabotage: null });
    });
    await answerRound(server, party, picks);
    await waitUntil(
      () =>
        roomOf(server, party).state.game!.round!.index === here &&
        roomOf(server, party).state.phase === 'SCORE_UPDATE',
      15_000,
      'SCORE_UPDATE',
    );
  }
}

/** The score update of the round that just ended, from the live room. */
export function lastDeltas(server: TestServer, party: Party) {
  const update = roomOf(server, party).state.game!.round!.scoreUpdate!;
  return Object.fromEntries(update.deltas.map((d) => [d.playerId, d]));
}

export const componentSum = (
  deltas: ReturnType<typeof lastDeltas>,
  kind: string,
  playerId?: string,
): number =>
  Object.values(deltas)
    .filter((d) => playerId === undefined || d.playerId === playerId)
    .flatMap((d) => d.components)
    .filter((c) => c.kind === kind)
    .reduce((sum, c) => sum + c.points, 0);
