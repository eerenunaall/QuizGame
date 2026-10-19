import { describe, expect, it } from 'vitest';
import { scanForbiddenKeys } from '@quizparty/protocol';
import { Harness } from './testing';

/** Who Said It (GDD §7.9, ADR-0015): statements in the lobby, one question per statement, author exempt. */

const WORDS = ['kediler aslında suyu sever', 'gece yarısı pizza iyi fikirdir', 'ben hiç ağlamam'];

function lobby(players = 3, texts: (string | null)[] = WORDS) {
  const h = new Harness({ tier: 'FULL' });
  const ids = h.joinPlayers(players);
  expect(
    h.apply({ kind: 'SET_CONTENT', mode: 'WHO_SAID_IT', ref: null, title: null, rounds: 10 }),
  ).toEqual({ ok: true });
  ids.forEach((id, i) => {
    const text = texts[i];
    if (text) submit(h, id, text);
  });
  return { h, ids };
}
const submit = (h: Harness, playerId: string, text: string) =>
  h.command(h.actor(playerId), { type: 'SUBMIT_STATEMENT', payload: { text } });

/** Plays to the open answer window of the next round and returns who wrote its statement. */
function nextAnswering(h: Harness): string {
  h.runUntil('ANSWERING');
  return h.state.game!.deck.questions[h.round().questionId]!.authorPlayerId!;
}

describe('collecting statements in the lobby', () => {
  it('accepts one statement per player in a Who Said It lobby and lets them edit it', () => {
    const { h, ids } = lobby(3, [null, null, null]);
    expect(submit(h, ids[0]!, 'ilk söz')).toEqual({ ok: true });
    expect(submit(h, ids[0]!, 'ikinci söz')).toEqual({ ok: true });
    expect(h.state.statements).toEqual({ [ids[0]!]: 'ikinci söz' });
    expect(h.view({ role: 'PLAYER', playerId: ids[0]! }).you?.myStatement).toBe('ikinci söz');
    expect(h.view({ role: 'PLAYER', playerId: ids[1]! }).you?.myStatement).toBeNull();
  });

  it('refuses it outside the mode, outside the lobby, from the TV and when malformed', () => {
    const classic = new Harness({ tier: 'FULL' });
    const [a] = classic.joinPlayers(2) as [string, string];
    expect(submit(classic, a, 'merhaba')).toEqual({ ok: false, code: 'INVALID_STATE' });

    const { h, ids } = lobby();
    expect(
      h.command(h.displayActor(), { type: 'SUBMIT_STATEMENT', payload: { text: 'x' } }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(submit(h, ids[0]!, '')).toEqual({ ok: false, code: 'TEXT_REJECTED' });
    expect(submit(h, ids[0]!, 'x'.repeat(141))).toEqual({ ok: false, code: 'TEXT_REJECTED' });
    expect(submit(h, ids[0]!, ' boşluklu ')).toEqual({ ok: false, code: 'TEXT_REJECTED' });
    h.start();
    expect(submit(h, ids[0]!, 'geç kaldım')).toEqual({ ok: false, code: 'INVALID_STATE' });
    expect(h.state.statements[ids[0]!]).toBe(WORDS[0]);
  });

  it('tells everyone who has submitted but never what, and marks the room sensitive at once', () => {
    const { h, ids } = lobby(3, [null, null, null]);
    expect(h.state.sensitiveContent).toBe(false);
    submit(h, ids[1]!, WORDS[1]!);
    expect(h.state.sensitiveContent).toBe(true);
    expect(h.events('STATEMENTS_CHANGED').at(-1)!.payload).toEqual({ playerIds: [ids[1]] });
    const display = h.view({ role: 'DISPLAY' });
    expect(display.phaseData).toEqual({ phase: 'LOBBY', statementPlayerIds: [ids[1]] });
    for (const viewer of [
      { role: 'DISPLAY' } as const,
      { role: 'PLAYER', playerId: ids[0]! } as const,
    ]) {
      expect(JSON.stringify(h.view(viewer))).not.toContain(WORDS[1]);
    }
    // the only frame carrying the words is the author's own state
    const carriers = h.effects.filter(
      (e) => e.kind === 'emit' && JSON.stringify(e.event).includes(WORDS[1]!),
    );
    expect(carriers).toHaveLength(1);
    expect(carriers[0]).toMatchObject({ audience: { to: 'PLAYER', playerId: ids[1] } });
  });

  it('forgets a statement when its player leaves or the room goes back to the classic game', () => {
    const { h, ids } = lobby();
    h.command(h.actor(ids[2]!), { type: 'LEAVE_ROOM', payload: {} });
    expect(Object.keys(h.state.statements)).toHaveLength(2);
    h.apply({ kind: 'SET_CONTENT', mode: 'CLASSIC', ref: null, title: null, rounds: null });
    expect(h.state.statements).toEqual({});
  });

  it('is part of the full game: the free tier cannot select it', () => {
    const free = new Harness({ tier: 'FREE' });
    free.joinPlayers(2);
    expect(
      free.apply({
        kind: 'SET_CONTENT',
        mode: 'WHO_SAID_IT',
        ref: null,
        title: null,
        rounds: null,
      }),
    ).toEqual({ ok: false, code: 'TIER_REQUIRED' });
  });
});

describe('starting a Who Said It game', () => {
  it('needs two statements, then plays one round per statement', () => {
    const one = lobby(3, [WORDS[0]!, null, null]);
    expect(one.h.start()).toEqual({ ok: false, code: 'NOT_ENOUGH_QUESTIONS' });
    expect(one.h.state.phase).toBe('LOBBY');

    const { h } = lobby(3, [WORDS[0]!, WORDS[1]!, null]);
    expect(h.start()).toEqual({ ok: true });
    expect(h.state.game!.totalRounds).toBe(2);
    expect(Object.keys(h.state.game!.deck.questions)).toHaveLength(2);
  });

  it('builds options from the players and keeps authors out of everything a client can read', () => {
    const { h, ids } = lobby();
    h.start();
    const deck = Object.values(h.state.game!.deck.questions);
    expect(deck.map((q) => q.text).sort()).toEqual([...WORDS].sort());
    for (const q of deck) {
      expect(q.source).toBe('WHO_SAID_IT');
      expect(q.options.map((o) => o.key).sort()).toEqual([...ids].sort());
      expect(q.options.filter((o) => o.correct).map((o) => o.key)).toEqual([q.authorPlayerId]);
    }
    expect(h.state.sensitiveContent).toBe(true);
  });
});

describe('the author sits their own statement out', () => {
  it('cannot answer, use 50/50 or stake on it, and is not waited for', () => {
    const { h, ids } = lobby();
    h.start();
    h.runUntil('RISK_PICK');
    const author = h.state.game!.deck.questions[h.round().questionId]!.authorPlayerId!;
    const others = ids.filter((id) => id !== author);

    // preparation: the author's own phone is told; their commitment is refused and not awaited
    expect(h.view({ role: 'PLAYER', playerId: author }).you?.authorOfRound).toBe(true);
    expect(h.view({ role: 'PLAYER', playerId: others[0]! }).you?.authorOfRound).toBe(false);
    expect(h.view({ role: 'DISPLAY' }).you).toBeNull();
    expect(
      h.command(h.actor(author), {
        type: 'COMMIT_RISK',
        payload: { stake: 'SAFE', doubleDown: false },
      }),
    ).toEqual({ ok: false, code: 'ANSWER_NOT_ALLOWED' });
    for (const id of others)
      h.command(h.actor(id), {
        type: 'COMMIT_RISK',
        payload: { stake: 'SAFE', doubleDown: false },
      });
    expect(h.state.phase).toBe('QUESTION'); // everyone who can decide has decided

    h.runUntil('ANSWERING');
    const question = h.round().question!;
    const first = question.options[0]!;
    expect(h.answer(author, first.optionId)).toEqual({ ok: false, code: 'ANSWER_NOT_ALLOWED' });
    expect(h.command(h.actor(author), { type: 'USE_FIFTY_FIFTY', payload: {} })).toEqual({
      ok: false,
      code: 'POWER_UNAVAILABLE',
    });
    expect(h.round().answers[author]).toBeUndefined();

    // the room locks as soon as every other player has answered
    h.answer(others[0]!, 'correct');
    expect(h.state.phase).toBe('ANSWERING');
    h.answer(others[1]!, 'wrong');
    expect(h.state.phase).toBe('LOCKED');
  });

  it('scores nothing for the author: no points, no streak reset, no result row', () => {
    const { h, ids } = lobby();
    h.start();
    const scoreBefore = Object.fromEntries(ids.map((id) => [id, 0]));
    const author = nextAnswering(h);
    for (const id of ids.filter((x) => x !== author)) h.answer(id, 'correct');
    h.runUntil('REVEAL');
    const reveal = h.view({ role: 'DISPLAY' }).phaseData;
    if (reveal.phase !== 'REVEAL') throw new Error('expected REVEAL');
    expect(reveal.results.map((r) => r.playerId)).not.toContain(author);
    h.runUntil('SCORE_UPDATE');
    const game = h.state.game!;
    expect(game.players[author]!.score).toBe(scoreBefore[author]);
    expect(game.players[author]!.streak).toBe(0);
    expect(game.round!.outcome!.players[author]).toBeUndefined();
    expect(game.round!.outcome!.eligibleCount).toBe(2);
    for (const id of ids.filter((x) => x !== author)) {
      expect(game.players[id]!.score).toBeGreaterThan(0);
      expect(game.players[id]!.streak).toBe(1);
    }
  });

  it('keeps the author’s streak across their own question', () => {
    const { h, ids } = lobby();
    h.start();
    const firstAuthor = nextAnswering(h);
    for (const id of ids.filter((x) => x !== firstAuthor)) h.answer(id, 'correct');
    h.runUntil('MICRO_INTERMISSION');
    const secondAuthor = nextAnswering(h);
    const before = h.state.game!.players[secondAuthor]!.streak;
    expect(before).toBe(secondAuthor === firstAuthor ? 0 : 1);
    for (const id of ids.filter((x) => x !== secondAuthor)) h.answer(id, 'wrong');
    h.runUntil('SCORE_UPDATE');
    expect(h.state.game!.players[secondAuthor]!.streak).toBe(before);
  });

  it('shows the statement only once its question is on screen, and the players as options', () => {
    const { h, ids } = lobby();
    h.start();
    const viewers = [
      { role: 'DISPLAY' } as const,
      ...ids.map((playerId) => ({ role: 'PLAYER', playerId }) as const),
    ];
    // Everything before the question is presented: no statement text and no authorship in any view.
    h.runUntil('ROUND_INTRO');
    for (const phase of ['ROUND_INTRO', 'RISK_PICK'] as const) {
      h.runUntil(phase);
      for (const viewer of viewers) {
        const view = JSON.stringify(h.view(viewer));
        for (const word of WORDS) expect(view).not.toContain(word);
        expect(scanForbiddenKeys(h.view(viewer))).toEqual([]);
      }
    }
    h.runUntil('QUESTION');
    const question = h.round().question!;
    const view = h.view({ role: 'DISPLAY' }).phaseData;
    if (view.phase !== 'QUESTION') throw new Error('expected QUESTION');
    expect(view.text).toBe(question.text);
    h.runUntil('ANSWERING');
    const answering = h.view({ role: 'DISPLAY' }).phaseData;
    if (answering.phase !== 'ANSWERING') throw new Error('expected ANSWERING');
    expect(answering.options.map((o) => o.playerId).sort()).toEqual([...ids].sort());
    expect(answering.options.map((o) => o.text).sort()).toEqual(
      ids.map((id) => h.state.players[id]!.nickname).sort(),
    );
    // authorship stays hidden while answering
    expect(JSON.stringify(answering)).not.toContain('correct');
    // ...and is revealed with the reveal
    for (const id of ids) h.answer(id, 'correct');
    h.runUntil('REVEAL');
    const reveal = h.view({ role: 'DISPLAY' }).phaseData;
    if (reveal.phase !== 'REVEAL') throw new Error('expected REVEAL');
    const author = h.state.game!.deck.questions[h.round().questionId]!.authorPlayerId!;
    expect(reveal.options.find((o) => o.optionId === reveal.correctOptionId)!.playerId).toBe(
      author,
    );
  });

  it('plays a whole game to the results', () => {
    const { h } = lobby();
    h.start();
    h.runUntil('RESULTS');
    expect(h.state.game!.totalRounds).toBe(3);
    expect(h.state.game!.results!.ranking).toHaveLength(3);
  });

  it('keeps the statements for a rematch', () => {
    const { h } = lobby();
    h.start();
    h.runUntil('RESULTS');
    expect(h.command(h.actor(h.state.leaderPlayerId!), { type: 'REMATCH', payload: {} })).toEqual({
      ok: true,
    });
    expect(h.state.phase).toBe('COUNTDOWN');
  });
});
