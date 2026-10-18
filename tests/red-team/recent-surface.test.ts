import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sanitizeUserText } from '@quizparty/validation';
import { resolveVenueLogo } from '../../apps/web/src/lib/theme';
import { parseAppLink } from '../../apps/mobile/src/core/links';
import { startModelServer, type ModelServer } from '../helpers/model-server';
import { liveRoom } from '../helpers/oracle';
import { call, player, type CookieJar } from '../helpers/payments';
import { closeParty, createParty } from '../helpers/party';
import { enablePersonalQuizzes } from '../helpers/quizzes';
import { startServer, type TestServer } from '../helpers/server';

/**
 * Second adversarial pass over the surfaces added with Who Said It, Blind Quiz claim, AI decoys,
 * the app-link files, themes and the mobile deep links (ATTACK 27–33 in docs/RED_TEAM.md).
 */

describe('ATTACK 27 — Who Said It: the progress strip names the author', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({ env: { DEFAULT_ROOM_TIER: 'FULL' } });
    await enablePersonalQuizzes(server);
  });
  afterAll(async () => {
    await server.dispose();
  });

  it('shows who answered only as a count: the one player who never ticks is not the author', async () => {
    const party = await createParty(server, 4);
    const room = liveRoom(server, party.created.roomId);
    expect(await room.setContent('WHO_SAID_IT', null, null, null)).toEqual({ ok: true });
    for (const [i, client] of party.players.entries()) {
      const id = client.send('SUBMIT_STATEMENT', { text: `attack27 cümle ${i}` });
      await client.next((m) => m.type === 'ACK' && m.payload.messageId === id);
    }
    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    await Promise.all(party.players.map((c) => c.waitForPhase('ANSWERING', 15_000)));

    const game = room.state.game!;
    const authorId = game.deck.questions[game.round!.questionId]!.authorPlayerId!;
    // the spy is the earliest-seated guesser, so honest ticks could never equal a seating prefix
    const seat = (c: { playerId: string | null }) => room.state.playerOrder.indexOf(c.playerId!);
    const spy = party.players
      .filter((c) => c.playerId !== authorId)
      .sort((a, b) => seat(a) - seat(b))[0]!;
    const others = party.players.filter((c) => c !== spy && c.playerId !== authorId);
    const questionId = game.round!.question!.questionId;
    const optionId = game.round!.question!.options[0]!.optionId;
    // everyone but the spy answers; the spy (a guesser, still undecided) watches the strip
    for (const c of others) c.send('SUBMIT_ANSWER', { questionId, optionId });
    await spy.next(
      (m) => m.type === 'ANSWER_LOCKED' && m.payload.answeredCount === others.length,
      5_000,
      'last tick',
    );
    spy.send('REQUEST_STATE', {});
    const snapshot = await spy.nextOfType('ROOM_STATE');
    const view = snapshot.payload.room.phaseData;
    if (view.phase !== 'ANSWERING') throw new Error(`phase ${view.phase}`);

    const live = new Set<string>();
    for (const m of spy.messages)
      if (m.type === 'ANSWER_LOCKED') live.add(m.payload.playerId);
    // The strip may only say *how many* answered. Its ids follow the seating order and nothing the
    // players did, so the one seat that never ticks (the author's) cannot be read off it.
    const seating = room.state.playerOrder.slice(0, others.length);
    expect([...live].sort()).toEqual([...seating].sort());
    expect([...view.answeredPlayerIds].sort()).toEqual([...seating].sort());
    await closeParty(party);
  });
});

describe('ATTACK 28 — invisible characters walk past the text moderation', () => {
  // Default-ignorable and blank-looking letters: invisible on the TV, but not "format" characters, so
  // the control/format ban let them through. Between letters they defeat the profanity and link filters.
  const FILLERS = ['ㅤ', 'ᅟ', 'ᅠ', 'ﾠ', '⠀', '឴', '឵', '͏', '⁢'];
  it('refuses fillers inside words, links and on their own', () => {
    for (const filler of FILLERS) {
      const label = `U+${filler.codePointAt(0)!.toString(16)}`;
      for (const text of [`a${filler}mk`, `evil${filler}.com`, `http${filler}://x.example`, filler, `${filler}${filler}`]) {
        const result = sanitizeUserText(text, { maxLength: 140 });
        expect(result.ok, `${label} ${JSON.stringify(text)}`).toBe(false);
      }
    }
  });
  it('refuses a stack of combining marks that paints over the neighbouring lines', () => {
    const zalgo = `a${'̀́̂̃̄̅̆̇'}`;
    expect(sanitizeUserText(zalgo, { maxLength: 140 }).ok).toBe(false);
  });
  it('still accepts ordinary party text: Turkish letters, accents, emoji with a presentation selector', () => {
    for (const text of ['İstanbul’da çay içerim ğüşöç', 'café crème', '❤️ aşk', 'Zoë', '👍🏽 süper'])
      expect(sanitizeUserText(text, { maxLength: 140 }), text).toEqual({ ok: true, text });
  });
});
