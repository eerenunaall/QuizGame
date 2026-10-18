import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST_COMMANDS, type ClientMessageType } from '@quizparty/protocol';
import { sanitizeUserText } from '@quizparty/validation';
import type { TestClient } from '../helpers/client';
import { resolveVenueLogo } from '../../apps/web/src/lib/theme';
import { limitKey } from '../../apps/realtime/src/ws/gateway';
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
    for (const m of spy.messages) if (m.type === 'ANSWER_LOCKED') live.add(m.payload.playerId);
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
      for (const text of [
        `a${filler}mk`,
        `evil${filler}.com`,
        `http${filler}://x.example`,
        filler,
        `${filler}${filler}`,
      ]) {
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
    model = await startModelServer(() => ({
      text: JSON.stringify({ decoys: ['Pilot', 'Doktor', 'Aşçı'] }),
    }));
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
    const target = await call<{ inviteUrl: string }>(
      server,
      'POST',
      `/v1/quizzes/${made.body.id}/targets`,
      {
        token: creator.token,
        body: { displayName: 'Ece' },
      },
    );
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
      statuses.push(
        (
          await call(server, 'POST', `${base}/prompts/${promptId}/suggest-decoys`, {
            body: {},
            jar,
          })
        ).status,
      );
    expect(model.requests.length).toBeLessThanOrEqual(6);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(6);
    expect(statuses).toContain(429);
    // the creator, who holds the same link but not the claim, cannot burn the target's allowance
    const before = model.requests.length;
    for (let i = 0; i < 5; i += 1)
      await call(server, 'POST', `${base}/prompts/${promptId}/suggest-decoys`, {
        body: {},
        cookies: false,
      });
    expect(model.requests.length).toBe(before);
  });
});

describe('ATTACK 30 — hostile theme and venue-logo values', () => {
  it('turns only the allow-listed theme ids into a theme; nothing else reaches the page', async () => {
    const { pickTheme, themeFromQuery } = await import('../../apps/web/src/lib/theme');
    const memory = new Map<string, string>();
    const storage = {
      get: (k: string) => memory.get(k) ?? null,
      set: (k: string, v: string) => void memory.set(k, v),
      remove: (k: string) => void memory.delete(k),
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
      expect(['party', 'venue-gold', 'high-contrast'], search).toContain(
        pickTheme(search, storage),
      );
      if (!/^\?theme=party&/u.test(search))
        expect(themeFromQuery(search), search).not.toBe('toString');
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
      else
        expect([resolved.protocol, resolved.username, resolved.password], value).toEqual([
          'https:',
          '',
          '',
        ]);
    }
    expect(resolveVenueLogo('/venue/logo.svg')).toBe('/venue/logo.svg');
    expect(resolveVenueLogo('https://cdn.venue.example/logo.png')).toBe(
      'https://cdn.venue.example/logo.png',
    );
  });
});

describe('ATTACK 31 — the static server and the two association files', () => {
  let server: TestServer;
  let dist: string;
  let outside: string;
  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), 'qp-a31-'));
    outside = await mkdtemp(join(tmpdir(), 'qp-a31-out-'));
    await writeFile(join(outside, 'loot.txt'), 'LOOT=1');
    await mkdir(join(dist, 'assets'));
    await writeFile(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
    await writeFile(join(dist, '.env'), 'LOOT=2');
    await mkdir(join(dist, '.well-known'));
    await writeFile(join(dist, '.well-known', 'apple-app-site-association'), '{"applinks":{}}');
    await writeFile(join(dist, '.well-known', 'assetlinks.json'), '[]');
    await writeFile(join(dist, '.well-known', 'other.json'), 'LOOT=3');
    await writeFile(join(dist, '.well-known', '.hidden'), 'LOOT=4');
    await symlink(join(outside, 'loot.txt'), join(dist, '.well-known', 'link.txt'));
    server = await startServer({ env: { SERVE_WEB: '1', WEB_DIST: dist } });
  });
  afterAll(async () => {
    await server.dispose();
    await rm(dist, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  /** Raw request line, so nothing normalises the path before the server sees it. */
  const raw = (
    target: string,
    method = 'GET',
  ): Promise<{ status: number; head: string; body: string }> =>
    new Promise((resolve, reject) => {
      const port = new URL(server.httpUrl).port;
      const socket = connect(Number(port), '127.0.0.1', () =>
        socket.write(
          `${method} ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
        ),
      );
      let data = '';
      socket.on('data', (chunk: Buffer) => (data += chunk.toString('latin1')));
      socket.on('error', reject);
      socket.on('close', () => {
        const [head = '', ...rest] = data.split('\r\n\r\n');
        resolve({
          status: Number(/^HTTP\/1\.1 (\d+)/u.exec(head)?.[1] ?? 0),
          head,
          body: rest.join('\r\n\r\n'),
        });
      });
    });

  it('never serves a dotfile, a sibling of the association files, a traversal or a case variant', async () => {
    const paths = [
      '/.well-known/other.json',
      '/.well-known/.hidden',
      '/.well-known/link.txt',
      '/.well-known/assetlinks.json/../other.json',
      '/.well-known/assetlinks.json/..%2fother.json',
      '/.well-known/%2e%2e/.env',
      '/.well-known/%2E%2E/.env',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/.well-known/%2e/.env',
      '/.well-known%2f..%2f.env',
      '/.WELL-KNOWN/assetlinks.json',
      '/.well-known/ASSETLINKS.JSON',
      '/.well-known/Apple-App-Site-Association',
      '/.well-known/assetlinks.json%00.txt',
      '/.well-known/assetlinks.json%2500',
      '/.well-known/assetlinks.json::$DATA',
      '/.well-known/assetlinks.json%20',
      '/.well-known/assetlinks.json%5c..%5c.env',
      '/.well-known\\assetlinks.json',
      '/.env',
      '/%2eenv',
      '/%252e%252e/.env',
      '/assets/../.env',
      '//.env',
      `/${'..%2f'.repeat(30)}etc/passwd`,
      `http://evil.example/../../.env`,
    ];
    for (const path of paths) {
      const response = await raw(path);
      expect(response.body, path).not.toMatch(/LOOT=|root:/u);
    }
  });

  it('serves each association file as JSON however its path is spelled, and nothing else as that type', async () => {
    for (const path of [
      '/.well-known/apple-app-site-association',
      '/%2ewell-known/apple-app-site-association',
      '/.well-known/apple-app-site-association/',
      '/.well-known//apple-app-site-association',
    ]) {
      const response = await raw(path);
      expect(response.status, path).toBe(200);
      expect(response.head.toLowerCase(), path).toContain('content-type: application/json');
      expect(response.head.toLowerCase(), path).toContain('x-content-type-options: nosniff');
    }
    // the file is not a page: no CSP-less HTML, no directory listing
    const dir = await raw('/.well-known/');
    expect(dir.body).not.toContain('apple-app-site-association');
    expect(dir.head.toLowerCase()).not.toContain('text/html; charset=utf-8\r\ncontent-length: 0');
  });
});

describe('ATTACK 32 — hostile quiznight:// and /j/CODE deep links', () => {
  const HOSTS = ['quizparty.example'];
  const CODE = 'ABC234';
  const ID = 'A'.repeat(22);
  const SCHEMES = [
    'quiznight://',
    'QUIZNIGHT://',
    'https://quizparty.example/',
    'https://quizparty.example.evil.example/',
    'https://QuizParty.Example/',
    'https://quizparty.example./',
    'https://quizparty.example:443/',
    'https://quizparty.example:444/',
    'http://quizparty.example/',
    'https://evil@quizparty.example/',
    'https://quizparty.example@evil.example/',
    'https://quizparty.example%2f@evil.example/',
    'https://quizparty.example\\@evil.example/',
    'https://quizparty。example/',
    'https://xn--quizparty-7ya.example/',
  ];
  const KINDS = [
    'join',
    'j',
    'unlock',
    'blind',
    'JOIN',
    'J',
    'join/',
    '/join',
    'j/j',
    'join/../j',
    '',
  ];
  const VALUES = [
    CODE,
    ID,
    `${CODE}/`,
    `${CODE}//`,
    `${CODE}/x`,
    `%41BC234`,
    `ABC%00234`,
    `ABC\u0000234`,
    `ABC\n234`,
    `abc 234`,
    `ABC\t234`,
    `${CODE}?next=//evil.example`,
    `${CODE}#//evil.example`,
    `${CODE}\\..\\x`,
    `..`,
    `.`,
    `${CODE}/..`,
    `%2e%2e`,
    `ＡＢＣ２３４`,
    `ABC２34`,
    `ΑΒC234`,
    `ABC234‮`,
    `‮ABC234`,
    `${CODE}${'0'.repeat(600)}`,
    `'; DROP TABLE rooms;--`,
    `<script>`,
    `{{7*7}}`,
    `${CODE}%0d%0aLocation:evil`,
  ];
  const SUFFIX = [
    '',
    '?a=b',
    '#f',
    '/',
    '?',
    '#',
    '?next=https://evil.example',
    '\n',
    ' ',
    '\u0000',
  ];

  it('returns null or one fully validated identifier for every combination, and never anything else', () => {
    let accepted = 0;
    for (const scheme of SCHEMES)
      for (const kind of KINDS)
        for (const value of VALUES)
          for (const suffix of SUFFIX) {
            const input = `${scheme}${kind}${kind === '' ? '' : '/'}${value}${suffix}`;
            const link = parseAppLink(input, HOSTS);
            if (link === null) continue;
            accepted += 1;
            // the trusted origins only
            // (a host that the URL standard itself folds onto ours, such as a full-width dot, is ours)
            if (!/^quiznight:\/\//iu.test(input)) {
              const url = new URL(input);
              expect([url.protocol, url.host, url.username, url.password], input).toEqual([
                'https:',
                'quizparty.example',
                '',
                '',
              ]);
            }
            if (link.kind === 'JOIN')
              expect(link.roomCode, input).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/u);
            else expect(link.intentId, input).toMatch(/^[A-Za-z0-9_-]{16,64}$/u);
            // and no path segment or query could have steered anywhere else
            expect(JSON.stringify(link), input).not.toMatch(/evil|\.\.|[%\\<>]/u);
          }
    expect(accepted).toBeGreaterThan(0); // the corpus is not vacuous
    expect(parseAppLink(`quiznight://join/${CODE}`, HOSTS)).toEqual({
      kind: 'JOIN',
      roomCode: CODE,
    });
    expect(parseAppLink(`https://quizparty.example/j/${CODE}`, HOSTS)).toEqual({
      kind: 'JOIN',
      roomCode: CODE,
    });
  });
});

describe('ATTACK 33 — well-formed intents that make no sense, in every phase', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({ env: { DEFAULT_ROOM_TIER: 'FULL' } });
  });
  afterAll(async () => {
    await server.dispose();
  });

  it('a player and the TV fire every message type at every phase of a game: no INTERNAL error, no crash, nobody removed', async () => {
    const party = await createParty(server, 3);
    const room = liveRoom(server, party.created.roomId);
    const [leader, spy, third] = party.players as [TestClient, TestClient, TestClient];
    const seen = new Set<string>();
    const errors: string[] = [];
    const bogus = randomUUID();
    const battery = (client: TestClient, questionId: string | null): void => {
      const q = questionId ?? bogus;
      const target = third.playerId!;
      const intents: [ClientMessageType, unknown][] = [
        ['SUBMIT_ANSWER', { questionId: q, optionId: 'A'.repeat(12) }],
        ['SUBMIT_ANSWER', { questionId: bogus, optionId: bogus }],
        [
          'COMMIT_PREP',
          { stake: 'HIGH', doubleDown: true, sabotage: { targetId: target, effect: 'JAM' } },
        ],
        [
          'COMMIT_PREP',
          {
            stake: 'SAFE',
            doubleDown: false,
            sabotage: { targetId: client.playerId ?? bogus, effect: 'FOG' },
          },
        ],
        [
          'COMMIT_PREP',
          {
            stake: 'SAFE',
            doubleDown: false,
            sabotage: { targetId: bogus, effect: 'LOCKOUT', joker: 'FIFTY_FIFTY' },
          },
        ],
        ['USE_FIFTY_FIFTY', {}],
        ['SET_PREFERENCES', { reducedEffects: true }],
        ['REPORT_QUESTION', { questionId: q, reason: 'WRONG_ANSWER' }],
        ['SUBMIT_STATEMENT', { text: 'çok geç' }],
        ['REQUEST_UNLOCK_LINK', {}],
        ['KICK_PLAYER', { playerId: target }],
        ['KICK_PLAYER', { playerId: client.playerId ?? bogus }],
        ['KICK_PLAYER', { playerId: bogus }],
        ['TRANSFER_LEADER', { playerId: client.playerId ?? bogus }],
        ['TRANSFER_LEADER', { playerId: bogus }],
        ['START_GAME', {}],
        ['SET_SETTINGS', { rounds: 5 }],
        ['REMATCH', {}],
        ['BACK_TO_LOBBY', {}],
        ['END_ROOM', {}],
        ['SET_NICKNAME', { nickname: 'Oyuncu1' }],
        ['READY', { ready: true }],
        ['LEAVE_ROOM', {}],
      ];
      for (const [type, payload] of intents) {
        if (client.ws.readyState !== 1) return;
        // The TV is the host: its host commands are honest ones. LEAVE_ROOM is honest for a player.
        if (type === 'LEAVE_ROOM' && client.role === 'PLAYER') continue;
        if (client.role === 'DISPLAY' && HOST_COMMANDS.has(type)) continue;
        client.send(type, payload);
      }
    };
    for (const client of [spy, party.display])
      client.subscribe((m) => {
        if (m.type === 'ERROR' && m.payload.code === 'INTERNAL')
          errors.push(JSON.stringify(m.payload));
        if (m.type !== 'PHASE_ENTERED') return;
        seen.add(m.payload.data.phase);
        const live = 'questionId' in m.payload.data ? m.payload.data.questionId : null;
        battery(client, live);
      });

    leader.send('START_GAME', {});
    await leader.nextOfType('ACK');
    await leader.waitForPhase('RESULTS', 40_000);
    await spy.idle(300);

    expect(errors).toEqual([]);
    expect(seen.size).toBeGreaterThanOrEqual(8); // the battery really ran across the game
    const active = Object.values(room.state.players).filter((p) => p.status === 'ACTIVE');
    expect(active.map((p) => p.playerId).sort()).toEqual(
      party.players.map((c) => c.playerId!).sort(),
    );
    expect(room.state.leaderPlayerId).toBe(leader.playerId);
    expect(room.state.phase).not.toBe('ROOM_CLOSED');
    await closeParty(party);
  });
});

describe('ATTACK 34 — rotate IPv6 addresses to dodge the per-address limits', () => {
  let strict: TestServer;
  beforeAll(async () => {
    strict = await startServer({ env: { RATE_LIMIT_SCALE: '1', TRUST_PROXY_HOPS: '1' } });
  });
  afterAll(async () => {
    await strict.dispose();
  });

  it('charges every address of one /64 to the same bucket (and mapped IPv4 to the IPv4 one)', () => {
    const key = (address: string) => limitKey(address);
    expect(key('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(key('2001:db8:1:2::1'));
    expect(key('2001:DB8:1:2:0:0:0:9')).toBe(key('2001:db8:1:2::ffff'));
    expect(key('2001:db8:1:3::1')).not.toBe(key('2001:db8:1:2::1'));
    expect(key('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(key('fe80::1%eth0')).toBe(key('fe80::2'));
    expect(key('203.0.113.7')).toBe('203.0.113.7');
    expect(key('unknown')).toBe('unknown');
  });

  it('a guesser who changes the low 64 bits on every try is still throttled', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const code = Array.from(
        { length: 6 },
        () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)],
      ).join('');
      const response = await fetch(`${strict.httpUrl}/v1/rooms/${code}/preview`, {
        headers: {
          'x-forwarded-for': `2001:db8:5:6:${i.toString(16)}:1234:abcd:${((i * 7919) % 65536).toString(16)}`,
        },
      });
      statuses.push(response.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(25);
    // another /64 is another subscriber and is not punished for it
    const other = await fetch(`${strict.httpUrl}/v1/rooms/ABCDEF/preview`, {
      headers: { 'x-forwarded-for': '2001:db8:9:9::1' },
    });
    expect(other.status).toBe(404);
  });
});
