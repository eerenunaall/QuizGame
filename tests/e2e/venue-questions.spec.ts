import { expect, test, type Page } from '@playwright/test';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import { seedVenueQuestions, setVenueFlag } from '../helpers/venue';
import {
  PLAY_GAME_CONFIG,
  joinPhone,
  openLobby,
  phonePage,
  shot,
  startE2eServer,
  tvPage,
  type E2eServer,
} from './helpers';

/**
 * A café uploads its own questions (ADR-0025) in real browsers: the owner signs in on the staff page,
 * pastes a CSV, reads the dry-run in Turkish, imports, opens a table and plays a game in which a venue
 * question is on the TV (and a script-looking one is shown as text, not run); a waiter sees the counts
 * but has no way to upload and is refused by the server when he tries.
 */
const mailbox = new MemoryEmailSender();
const OWNER = 'sahip@kafe.example';
const WAITER = 'garson@kafe.example';
let env: E2eServer;
let venueId: string;

test.beforeEach(async () => {
  env = await startE2eServer(PLAY_GAME_CONFIG, { VENUE_MINUTE_MS: '60000' }, mailbox);
  await setVenueFlag(env.server, true);
  const venues = env.server.built.venues;
  venueId = (await venues.createVenue('Deneme Kafe', OWNER, null)).id;
  await venues.addStaff(venueId, WAITER, 'STAFF', null);
  await venues.updateSettings(venueId, { questions: { source: 'VENUE_ONLY' } });
});
test.afterEach(async () => {
  await env.server.dispose();
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.getByTestId('unlock-email').fill(email);
  await page.getByTestId('unlock-send').click();
  await page.getByTestId('unlock-code').waitFor();
  await expect.poll(() => mailbox.lastCode(email)).not.toBeNull();
  await page.getByTestId('unlock-code').fill(mailbox.lastCode(email)!);
  await page.getByTestId('unlock-verify').click();
}

const FILE = [
  'category,difficulty,question,optionA,optionB,optionC,optionD,correct,explanation',
  "Genel Kültür,EASY,Türkiye'nin başkenti neresidir?,İstanbul,Ankara,İzmir,Bursa,B,Başkent 1923'ten beri Ankara'dır.",
  'Kutu Oyunları,EASY,Satranç tahtasında toplam kaç kare bulunur?,32,48,64,81,C,Tahta 8 sıra ve 8 sütundan oluşur.',
  'Kutu Oyunları,EASY,kısa,a,b,c,d,A,',
].join('\n');

test('upload a CSV, read the dry-run, import, play it on the TV; staff cannot upload', async ({
  browser,
}) => {
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const players = [
    await joinPhone(browser, env.url, code, 'Ece', 'cat'),
    await joinPhone(browser, env.url, code, 'Ahmet', 'cool'),
    await joinPhone(browser, env.url, code, 'Merve', 'fox'),
  ];

  // The owner pastes the file: the dry-run explains the bad row in Turkish and writes nothing yet.
  const owner = await phonePage(browser);
  await owner.page.goto(`${env.url}/staff`);
  await signIn(owner.page, OWNER);
  await owner.page.getByTestId('staff-tab-questions').click();
  await owner.page.getByTestId('vq-paste').fill(FILE);
  await owner.page.getByTestId('vq-check').click();
  await expect(owner.page.getByTestId('vq-report')).toBeVisible();
  await expect(owner.page.getByTestId('vq-row-4')).toContainText(
    'Soru çok kısa (en az 10 karakter)',
  );
  await expect(owner.page.getByTestId('vq-counts')).toContainText('2 soru yayına girecek');
  await expect(owner.page.getByTestId('vq-report')).toContainText(
    'Yeni kategori: Genel Kültür, Kutu Oyunları',
  );
  await shot(owner.page, 'venue-questions-dry-run');
  expect(
    await env.server.db.db
      .selectFrom('questions')
      .select('id')
      .where('owner_venue_id', '=', venueId)
      .execute(),
  ).toHaveLength(0);

  // Import: the two good rows are live, the bad one is not.
  await owner.page.getByTestId('vq-import').click();
  await expect(owner.page.getByTestId('vq-done')).toContainText('2 soru yayına alındı');
  await expect(owner.page.getByTestId('vq-totals')).toContainText('2 soru yayında');
  const live = await env.server.db.db
    .selectFrom('questions')
    .select(['text', 'status'])
    .where('owner_venue_id', '=', venueId)
    .execute();
  expect(live.map((row) => row.status)).toEqual(['ACTIVE', 'ACTIVE']);
  await shot(owner.page, 'venue-questions-imported');

  // Script-looking questions are in the set too (as an AI might return): they must be shown as text.
  await seedVenueQuestions(env.server, venueId, 40, {
    prefix: '<script>window.__pwned=1</script>',
  });

  // A waiter sees the counts and no upload; the server refuses him anyway.
  const waiter = await phonePage(browser);
  await waiter.page.goto(`${env.url}/staff`);
  await signIn(waiter.page, WAITER);
  await waiter.page.getByTestId('staff-tab-questions').click();
  await expect(waiter.page.getByTestId('vq-totals')).toBeVisible();
  await expect(waiter.page.getByTestId('vq-upload')).toHaveCount(0);
  const refused = await waiter.page.evaluate(async (id) => {
    const response = await fetch(`/v1/venues/${id}/questions/import`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-quizparty-csrf': '1' },
      body: JSON.stringify({ fileName: 'x.csv', data: btoa('category') }),
    });
    return response.status;
  }, venueId);
  expect(refused).toBe(403);

  // The owner opens the table; the game draws the venue's questions.
  await owner.page.getByTestId('staff-tab-new').click();
  await owner.page.getByTestId('staff-new-code').fill(code);
  await owner.page.getByTestId('staff-new-open').click();
  await expect(owner.page.getByTestId('staff-new-result')).toContainText(code);
  await players[0]!.page.getByTestId('ctl-start').click();
  await expect(tv.page.getByTestId('tv-question')).toBeVisible({ timeout: 20_000 });

  const room = env.server.built.manager.getByCode(code)!;
  const question = room.state.game!.round!.question!;
  const stored = await env.server.db.db
    .selectFrom('questions')
    .select(['owner_venue_id', 'text'])
    .where('id', '=', question.questionId)
    .executeTakeFirstOrThrow();
  expect(stored.owner_venue_id).toBe(venueId);
  await expect(tv.page.getByTestId('tv-question')).toContainText(stored.text);

  // Whatever the venue question says, the TV and phones show it as text: no script ran, none was added.
  for (const screen of [tv, ...players]) {
    expect(
      await screen.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
    expect(
      await screen.page.evaluate(() =>
        [...document.querySelectorAll('script')].some((node) =>
          (node.textContent ?? '').includes('__pwned'),
        ),
      ),
    ).toBe(false);
  }
  if (stored.text.includes('<script>'))
    await expect(tv.page.getByTestId('tv-question')).toContainText(
      '<script>window.__pwned=1</script>',
    );
  await shot(tv.page, 'venue-questions-tv');
});
