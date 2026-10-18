import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import { createAppleChain, APPLE_PRODUCT, BUNDLE_ID } from '../helpers/apple-store';
import { enablePersonalQuizzes, readyBlindQuiz } from '../helpers/quizzes';
import { PLAY_GAME_CONFIG, PHONE, startE2eServer, type E2eServer } from '../e2e/helpers';

const OUT = process.env.QA_OUT ?? '/tmp/qa';
const ONLY = process.env.QA_ONLY;
mkdirSync(OUT, { recursive: true });

const NAMES = ['Şebnem Ğüneş', 'İsmail', 'ışıl', 'Çağlar Öztürk', 'WWWWWWWWWWWWWWWW', 'Ömer', 'Ayşe Ü', 'Yiğit'];
const AVATARS = ['cat', 'cool', 'frog', 'cat', 'cool', 'frog', 'cat', 'cool'];

const TIMINGS = {
  ...PLAY_GAME_CONFIG.timings,
  prepQuickMs: 12_000, prepDecisionMs: 12_000, prepMs: 12_000,
  readBaseMs: 2500, readMinMs: 2500, readMaxMs: 2500,
  answerMs: { STANDARD: 20_000, SPEED: 20_000, RISK: 20_000, CROWD: 20_000, FINAL: 20_000 },
  lockedMs: 1800, revealMs: 4500, revealPerCharMs: 35, revealExplanationMaxMs: 5000,
  powerResolutionMs: 3500, powerResolutionPerItemMs: 700, powerResolutionMaxMs: 8000,
  scoreUpdateMs: 3500, countdownMs: 3200, roundIntroMs: 1800, finalIntroMs: 2600,
};
const CFG = { ...PLAY_GAME_CONFIG, defaultRounds: 3, timings: TIMINGS, director: { maxSpeedRounds: 0, maxCrowdRounds: 0, maxRiskRounds: 0 } };

interface Combo { id: string; theme: string; tv: [number, number]; phone: [number, number]; players: number; locale?: string }
const COMBOS: Combo[] = [
  { id: 'a-party-1080', theme: 'party', tv: [1920, 1080], phone: [390, 844], players: 8 },
  { id: 'b-gold-1080', theme: 'venue-gold', tv: [1920, 1080], phone: [390, 844], players: 4 },
  { id: 'c-hc-1080', theme: 'high-contrast', tv: [1920, 1080], phone: [390, 844], players: 4 },
  { id: 'd-party-768', theme: 'party', tv: [1366, 768], phone: [360, 740], players: 8 },
  { id: 'e-gold-768', theme: 'venue-gold', tv: [1366, 768], phone: [360, 740], players: 4 },
  { id: 'f-hc-768', theme: 'high-contrast', tv: [1366, 768], phone: [360, 740], players: 4, locale: 'en-US' },
  { id: 'g-landscape', theme: 'party', tv: [1366, 768], phone: [844, 390], players: 3 },
];

type Side = { page: Page; name: string };
async function snap(side: Side, combo: string, key: string, seen: Set<string>, delay = 500) {
  const k = `${side.name}-${key}`;
  if (seen.has(k)) return;
  seen.add(k);
  await side.page.waitForTimeout(delay);
  await side.page.screenshot({ path: join(OUT, `${combo}__${k}.png`) }).catch(() => {});
}
const vis = (page: Page, id: string) => page.getByTestId(id).first().isVisible().catch(() => false);

async function mkTv(browser: Browser, url: string, c: Combo, path = '/tv') {
  const context = await browser.newContext({ viewport: { width: c.tv[0], height: c.tv[1] }, deviceScaleFactor: 1, locale: c.locale ?? 'tr-TR' });
  const page = await context.newPage();
  await page.goto(`${url}${path}${path.includes('?') ? '&' : '?'}theme=${c.theme}`);
  return page;
}
async function mkPhone(browser: Browser, c: Combo) {
  const landscape = c.phone[0] > c.phone[1];
  const context = await browser.newContext({ ...PHONE, viewport: { width: c.phone[0], height: c.phone[1] }, locale: c.locale ?? 'tr-TR' });
  void landscape;
  return context.newPage();
}

async function lobbyOf(browser: Browser, env: E2eServer, c: Combo, seen: Set<string>) {
  const tv = await mkTv(browser, env.url, c);
  await tv.getByTestId('tv-start').waitFor();
  await snap({ page: tv, name: 'tv' }, c.id, '01-title', seen, 1500);
  await tv.getByTestId('tv-start').click();
  await tv.getByTestId('lobby-code').waitFor();
  const code = (await tv.getByTestId('lobby-code').innerText()).trim();
  await snap({ page: tv, name: 'tv' }, c.id, '02-lobby-empty', seen, 1200);
  const phones: Page[] = [];
  for (let i = 0; i < c.players; i++) {
    const p = await mkPhone(browser, c);
    await p.goto(`${env.url}/join/${code}?theme=${c.theme}`);
    await p.getByTestId('join-nickname').fill(NAMES[i]!);
    if (i === 0) await snap({ page: p, name: 'ph0' }, c.id, '10-join', seen, 800);
    await p.getByTestId(`avatar-${AVATARS[i]}`).click();
    await p.getByTestId('join-submit').click();
    await p.getByTestId('ctl-lobby').waitFor();
    phones.push(p);
  }
  await snap({ page: tv, name: 'tv' }, c.id, '03-lobby-full', seen, 1200);
  await snap({ page: phones[0]!, name: 'ph0' }, c.id, '11-lobby-leader', seen, 600);
  if (phones[1]) await snap({ page: phones[1], name: 'ph1' }, c.id, '12-lobby-guest', seen, 300);
  return { tv, code, phones };
}

const TV_IDS = ['tv-countdown', 'tv-round-intro', 'tv-prep', 'tv-options', 'tv-power', 'tv-explanation', 'tv-score', 'tv-final-splash', 'tv-results', 'tv-who-said-it', 'tv-intermission'];
const PH_IDS = ['ctl-prep', 'ctl-answering', 'ctl-confirmed', 'ctl-outcome', 'ctl-score', 'ctl-results', 'ctl-ready'];

async function drive(env: E2eServer, c: Combo, tv: Page, code: string, phones: Page[], seen: Set<string>, pick: 'mixed' = 'mixed') {
  const room = env.server.built.manager.getByCode(code)!;
  const answered = new Set<string>();
  const readied = new Set<string>();
  const deadline = Date.now() + 150_000;
  let sawFinalSplash = false;
  while (Date.now() < deadline) {
    if (await vis(tv, 'tv-results')) {
      await snap({ page: tv, name: 'tv' }, c.id, 'tv-results-a', seen, 400);
      await snap({ page: phones[0]!, name: 'ph0' }, c.id, 'ctl-results', seen, 100);
      if (phones[1]) await snap({ page: phones[1], name: 'ph1' }, c.id, 'ctl-results', seen, 100);
      await tv.waitForTimeout(3500);
      await tv.screenshot({ path: join(OUT, `${c.id}__tv-tv-results-b.png`) });
      return;
    }
    for (const [i, p] of phones.entries()) {
      const round = room.state.game?.round?.index ?? -1;
      if (await vis(p, 'ctl-prep')) {
        const key = `${i}-${round}`;
        if (!readied.has(key)) {
          if (i === 0 && round === 0) {
            await p.getByTestId('stake-HIGH').click().catch(() => {});
            await p.getByTestId('prep-double-down').click().catch(() => {});
            await snap({ page: p, name: 'ph0' }, c.id, 'ctl-prep-chosen', seen, 400);
            await snap({ page: tv, name: 'tv' }, c.id, 'tv-prep', seen, 100);
          }
          if (i === 0 && round === 2) await snap({ page: p, name: 'ph0' }, c.id, 'ctl-prep-final', seen, 300);
          if (i === 1 && round === 1 && await vis(p, 'prep-sabotage')) await snap({ page: p, name: 'ph1' }, c.id, 'ctl-prep-sabotage', seen, 300);
          await p.getByTestId('prep-ready').click({ timeout: 2000 }).catch(() => {});
          readied.add(key);
        }
      }
      if (await vis(p, 'ctl-answering')) {
        const key = `${i}-${round}`;
        const q = room.state.game?.round?.question;
        if (q && !answered.has(key)) {
          if (i === 0 && round === 0) {
            await snap({ page: tv, name: 'tv' }, c.id, 'tv-answering', seen, 1500);
            await snap({ page: p, name: 'ph0' }, c.id, 'ctl-answering', seen, 100);
          }
          const correct = q.options.findIndex((o) => o.correct);
          const idx = i % 2 === 0 ? correct : (correct + 1) % q.options.length;
          answered.add(key);
          if (i === 0 && round === 0) {
            // measure tap targets
            const boxes = await p.locator('button[data-answer-index]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
            console.log(c.id, 'answer boxes', JSON.stringify(boxes));
          }
          await p.locator(`[data-answer-index="${idx}"]`).click({ timeout: 3000 }).catch(() => {});
          if (i === 0 && round === 0) {
            await snap({ page: p, name: 'ph0' }, c.id, 'ctl-confirmed', seen, 150);
            await p.waitForTimeout(200);
            await p.screenshot({ path: join(OUT, `${c.id}__ph0-ctl-confirmed-b.png`) });
          }
        }
      }
    }
    // State driven shots
    for (const id of TV_IDS) if (await vis(tv, id)) {
      if (id === 'tv-final-splash') sawFinalSplash = true;
      await snap({ page: tv, name: 'tv' }, c.id, id, seen, id === 'tv-power' ? 1800 : id === 'tv-score' ? 2500 : 700);
    }
    if (phones[0] && (await vis(phones[0], 'ctl-outcome'))) {
      await snap({ page: tv, name: 'tv' }, c.id, 'reveal-early', seen, 150);
      await snap({ page: phones[0], name: 'ph0' }, c.id, 'ctl-outcome', seen, 300);
      if (phones[1]) await snap({ page: phones[1], name: 'ph1' }, c.id, 'ctl-outcome', seen, 100);
      await snap({ page: tv, name: 'tv' }, c.id, 'reveal-late', seen, 1400);
    }
    for (const id of PH_IDS) if (phones[0] && (await vis(phones[0], id))) await snap({ page: phones[0], name: 'ph0' }, c.id, id, seen, 500);
    await tv.waitForTimeout(150);
  }
  void sawFinalSplash;
  await tv.screenshot({ path: join(OUT, `${c.id}__TIMEOUT.png`) });
}

let env: E2eServer | undefined;
test.afterEach(async () => { await env?.server.dispose(); env = undefined; });
test.setTimeout(400_000);

for (const c of COMBOS) {
  test(`game ${c.id}`, async ({ browser }) => {
    test.skip(!!ONLY && !c.id.startsWith(ONLY));
    env = await startE2eServer(CFG);
    const seen = new Set<string>();
    const { tv, code, phones } = await lobbyOf(browser, env, c, seen);
    await phones[0]!.getByTestId('ctl-start').click();
    await drive(env, c, tv, code, phones, seen);
  });
}

// ---- long text extremes (custom quiz) ----
test('extremes', async ({ browser }) => {
  test.skip(!!ONLY && !'x-extremes'.startsWith(ONLY));
  env = await startE2eServer(CFG);
  await enablePersonalQuizzes(env.server);
  const c: Combo = { id: 'x-extremes', theme: 'party', tv: [1920, 1080], phone: [360, 740], players: 4 };
  const seen = new Set<string>();
  const { tv, code, phones } = await lobbyOf(browser, env, c, seen);
  const { call, player } = await import('../helpers/payments');
  const owner = await player(env.server, 'WEB');
  const made = await call<{ id: string }>(env.server, 'POST', '/v1/quizzes', { token: owner.token, body: { kind: 'CUSTOM', title: 'Uç durumlar', language: 'tr' } });
  const long = 'Şişli\'deki İğneli Çınar Ağacının altında oturan ığdırlı Öğretmen Şükrü Bey, 1923 yılındaki Cumhuriyet Bayramı kutlamalarında hangi şiiri okuyarak çocukları ağlatmıştır ve neden?';
  const specs = [
    { text: long, options: ['Kısa', 'Ğ', 'Çok uzun bir seçenek metni: İstanbul Boğazı\'nın iki yakasını birbirine bağlayan köprülerin üçüncüsü olan yapı', 'Şükrü Bey\'in okuduğu şiir'], correctIndex: 2 },
    { text: 'Kısa?', options: ['Evet', 'Hayır', 'Belki', 'Ğ'], correctIndex: 0 },
    { text: long + ' ' + long, options: ['A', 'B', 'C', 'D'], correctIndex: 1 },
  ];
  for (const q of specs) {
    const r = await call(env.server, 'POST', `/v1/quizzes/${made.body.id}/questions`, { token: owner.token, body: q });
    console.log('question add', r.status, JSON.stringify(r.body).slice(0, 200));
  }
  const room = env.server.built.manager.getByCode(code)!;
  console.log('setContent', JSON.stringify(await room.setContent('CUSTOM', made.body.id, 'Uç durumlar', 3)));
  await phones[0]!.getByTestId('ctl-start').click();
  await drive(env, c, tv, code, phones, seen);
});

test('who said it', async ({ browser }) => {
  test.skip(!!ONLY && !'w-whosaid'.startsWith(ONLY));
  env = await startE2eServer(CFG);
  await enablePersonalQuizzes(env.server);
  const c: Combo = { id: 'w-whosaid', theme: 'party', tv: [1920, 1080], phone: [390, 844], players: 4 };
  const seen = new Set<string>();
  const { tv, code, phones } = await lobbyOf(browser, env, c, seen);
  const room = env.server.built.manager.getByCode(code)!;
  console.log('setContent', JSON.stringify(await room.setContent('WHO_SAID_IT', null, null, null)));
  await phones[0]!.getByTestId('ctl-statement-input').waitFor();
  await snap({ page: phones[0]!, name: 'ph0' }, c.id, 'statement-form', seen, 600);
  await snap({ page: tv, name: 'tv' }, c.id, 'lobby-wsi', seen, 600);
  const words = ['Gece yarısı pizza iyi fikirdir', 'Şemsiyem hep yanımda ama ıslanırım', 'Ben çay değil kahve severim, İstanbul\'da bile', 'Ğ harfi bence gereksiz'];
  for (const [i, p] of phones.entries()) {
    await p.getByTestId('ctl-statement-input').fill(words[i]!);
    await p.getByTestId('ctl-statement-send').click();
    await p.getByTestId('ctl-statement-sent').waitFor();
  }
  await snap({ page: phones[0]!, name: 'ph0' }, c.id, 'statement-sent', seen, 400);
  await snap({ page: tv, name: 'tv' }, c.id, 'lobby-wsi-in', seen, 600);
  await phones[0]!.getByTestId('ctl-start').click();
  await drive(env, c, tv, code, phones, seen);
});

test('blind', async ({ browser }) => {
  test.skip(!!ONLY && !'v-blind'.startsWith(ONLY));
  env = await startE2eServer(CFG);
  await enablePersonalQuizzes(env.server);
  const c: Combo = { id: 'v-blind', theme: 'party', tv: [1920, 1080], phone: [390, 844], players: 4 };
  const seen = new Set<string>();
  const { tv, code, phones } = await lobbyOf(browser, env, c, seen);
  const quiz = await readyBlindQuiz(env.server, { targetName: 'Şebnem Ğüneş', title: 'Şebnem hakkında' });
  const room = env.server.built.manager.getByCode(code)!;
  console.log('setContent', JSON.stringify(await room.setContent('BLIND', quiz.quizId, 'Şebnem hakkında', 3)));
  await snap({ page: tv, name: 'tv' }, c.id, 'lobby-blind', seen, 800);
  await snap({ page: phones[0]!, name: 'ph0' }, c.id, 'lobby-blind', seen, 300);
  await phones[0]!.getByTestId('ctl-start').click();
  await drive(env, c, tv, code, phones, seen);
});

test('unlock + pages', async ({ browser }) => {
  test.skip(!!ONLY && !'u-unlock'.startsWith(ONLY));
  const apple = createAppleChain('E2E');
  env = await startE2eServer(PLAY_GAME_CONFIG, { DEFAULT_ROOM_TIER: 'FREE', PAYMENTS_ENABLED: '1', APPLE_BUNDLE_ID: BUNDLE_ID, APPLE_PRODUCT_ID: APPLE_PRODUCT, APPLE_ROOT_CERTS_PEM: apple.rootPem, APPLE_ONLINE_CHECKS: '0' }, new MemoryEmailSender());
  for (const c of [
    { id: 'u-unlock-1080', theme: 'party', tv: [1920, 1080], phone: [390, 844], players: 2 } as Combo,
    { id: 'u-unlock-gold-768', theme: 'venue-gold', tv: [1366, 768], phone: [360, 740], players: 2 } as Combo,
  ]) {
    const seen = new Set<string>();
    const { tv, phones } = await lobbyOf(browser, env, c, seen);
    await tv.getByTestId('lobby-unlock').click();
    await tv.getByTestId('unlock-qr').locator('svg').waitFor();
    await snap({ page: tv, name: 'tv' }, c.id, 'unlock', seen, 800);
    const { decodeQr } = await import('../e2e/helpers');
    const link = decodeQr(await tv.getByTestId('unlock-qr').screenshot());
    const ph = await mkPhone(browser, c);
    await ph.goto(`${link}?theme=${c.theme}`);
    await ph.getByTestId('unlock-email').waitFor();
    await snap({ page: ph, name: 'ph' }, c.id, 'unlock-page', seen, 600);
    // root pages
    const root = await mkTv(browser, env.url, c, '/');
    await snap({ page: root, name: 'root' }, c.id, 'root-wide', seen, 1200);
    void phones;
  }
  const ph = await mkPhone(browser, { id: 'u', theme: 'party', tv: [1920, 1080], phone: [390, 844], players: 1 });
  await ph.goto(`${env.url}/`);
  await ph.waitForTimeout(1200);
  await ph.screenshot({ path: join(OUT, 'u-root-phone.png') });
  await ph.goto(`${env.url}/join`);
  await ph.waitForTimeout(1200);
  await ph.screenshot({ path: join(OUT, 'u-join-nocode.png') });
});
