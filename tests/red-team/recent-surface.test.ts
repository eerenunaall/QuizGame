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

describe('ATTACK 29 — suggest-decoys is a paid call anyone with an invite can repeat', () => {
  let server: TestServer;
  let model: ModelServer;
  beforeAll(async () => {
    model = await startModelServer(() => ({ text: JSON.stringify({ decoys: ['Pilot', 'Doktor', 'Aşçı'] }) }));
    server = await startServer({
      env: {
        RATE_LIMIT_SCALE: '1',
        AI_DECOYS_API_KEY: 'attack29-key-0123456789',
        AI_DECOYS_MODEL: 'decoy-test-model',
        AI_DECOYS_API_BASE: model.url,
      },
    });
    await server.db.db
      .updateTable('feature_flags')
      .set({ enabled: true })
      .where('key', 'in', ['mode.blind_quiz', 'ai.decoys'])
      .execute();
    server.built.flags.invalidate();
  });
  afterAll(async () => {
    await server.dispose();
    await model.close();
  });

  it('meters presses per invite: a flood reaches the model a handful of times, then answers 429', async () => {
    const creator = await player(server, 'WEB');
    const made = await call<{ id: string }>(server, 'POST', '/v1/quizzes', {
      token: creator.token,
      body: { kind: 'BLIND', title: 'Ece hakkında', language: 'tr' },
    });
    await call(server, 'POST', `/v1/quizzes/${made.body.id}/prompts`, {
      token: creator.token,
      body: { catalogKey: 'dreamJob' },
    });
    const target = await call<{ inviteUrl: string }>(server, 'POST', `/v1/quizzes/${made.body.id}/targets`, {
      token: creator.token,
      body: { displayName: 'Ece' },
    });
    const invite = target.body.inviteUrl.split('/blind/respond/')[1]!;
    const jar: CookieJar = new Map();
    const base = `/v1/blind/respond/${invite}`;
    const view = await call<{ prompts: { promptId: string }[] }>(server, 'GET', base, { jar });
    const promptId = view.body.prompts[0]!.promptId;
    await call(server, 'POST', `${base}/consent`, { body: {}, jar });
    await call(server, 'PUT', `${base}/prompts/${promptId}`, {
      body: { answer: 'Veteriner', decoys: [] },
      jar,
    });

    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1)
      statuses.push((await call(server, 'POST', `${base}/prompts/${promptId}/suggest-decoys`, { body: {}, jar })).status);
    expect(model.requests.length).toBeLessThanOrEqual(6);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(6);
    expect(statuses).toContain(429);
    // the creator, who holds the same link but not the claim, cannot burn the target's allowance
    const before = model.requests.length;
    for (let i = 0; i < 5; i += 1)
      await call(server, 'POST', `${base}/prompts/${promptId}/suggest-decoys`, { body: {}, cookies: false });
    expect(model.requests.length).toBe(before);
  });
});

describe('ATTACK 30 — hostile theme and venue-logo values', () => {
  it('turns only the allow-listed theme ids into a theme; nothing else reaches the page', async () => {
    const { pickTheme, themeFromQuery } = await import('../../apps/web/src/lib/theme');
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    for (const search of [
      '?theme=%3Cscript%3Ealert(1)%3C/script%3E',
      '?theme="><img src=x onerror=alert(1)>',
      '?theme=party%22%20onload%3D%22x',
      '?theme=__proto__',
      '?theme=constructor',
      '?theme=toString',
      '?theme[]=party',
      '?theme=party&theme=evil',
      '?theme=PARTY',
      '?theme=%00',
      `?theme=${'a'.repeat(100_000)}`,
    ]) {
      expect(['party', 'venue-gold', 'high-contrast'], search).toContain(pickTheme(search, storage));
      if (!/^\?theme=party&/u.test(search)) expect(themeFromQuery(search), search).not.toBe('toString');
    }
    expect(themeFromQuery('?theme=__proto__')).toBeNull();
    expect(themeFromQuery('?theme=constructor')).toBeNull();
  });

  it('accepts a venue logo only as a same-origin path or https URL to an image, never a host switch', () => {
    const hostile = [
      'javascript:alert(1)//x.svg',
      'data:image/svg+xml,<svg onload=alert(1)>.svg',
      '//evil.example/x.svg',
      '/\\evil.example/x.svg', // browsers read "/\" as "//"
      '/\t/evil.example/x.svg',
      '/%5Cevil.example/x.svg',
      'https://evil.example/x.svg"onerror="alert(1)',
      'https://user:pw@evil.example/x.svg',
      'https://evil.example\\@good.example/x.svg',
      'http://evil.example/x.svg',
      '/x.svg?\n',
      '/../../x.svg',
    ];
    for (const value of hostile) {
      const logo = resolveVenueLogo(value);
      if (logo === null) continue;
      // a path stays on the page's own origin; an absolute address is plain https without credentials
      const resolved = new URL(logo, 'https://quiz.example');
      if (logo.startsWith('/')) expect(resolved.origin, value).toBe('https://quiz.example');
      else expect([resolved.protocol, resolved.username, resolved.password], value).toEqual(['https:', '', '']);
    }
    expect(resolveVenueLogo('/venue/logo.svg')).toBe('/venue/logo.svg');
    expect(resolveVenueLogo('https://cdn.venue.example/logo.png')).toBe('https://cdn.venue.example/logo.png');
  });
});
