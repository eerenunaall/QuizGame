import { expect, test } from '@playwright/test';
import { catalogs } from '@quizparty/i18n';
import {
  PLAY_GAME_CONFIG,
  joinPhone,
  openLobby,
  shot,
  startE2eServer,
  tvPage,
  type E2eServer,
  type Screen,
} from './helpers';

/**
 * Teams and the simple ruleset (ADR-0026) in real browsers: one TV and four phones. The leader turns on
 * team play and the simple rules, a player taps another team and back, the game starts, every phone gets
 * the one short prep screen, a sabotage goes to the rival team, the phones carry the answers but not the
 * question text while the TV carries both, and the game ends with team standings.
 */
const tr = catalogs.tr;
let env: E2eServer;
test.afterEach(async () => {
  await env.server.dispose();
});

const NAMES = ['Ece', 'Ahmet', 'Merve', 'Can'];
const AVATARS = ['cat', 'cool', 'frog', 'dog'];

test('four phones in two teams play a short game of the simple ruleset', async ({ browser }) => {
  env = await startE2eServer({
    ...PLAY_GAME_CONFIG,
    defaultRounds: 3,
    // long enough for the assertions below to catch the standings
    timings: { ...PLAY_GAME_CONFIG.timings, scoreUpdateMs: 6_000 },
    director: { maxSpeedRounds: 0, maxCrowdRounds: 0, maxRiskRounds: 0 },
    simple: {
      answerMs: { STANDARD: 25_000, SPEED: 25_000, RISK: 25_000, CROWD: 25_000, FINAL: 25_000 },
      prepMs: 20_000,
      sabotage: { firstRoundIndex: 0 },
    },
  });
  const tv = await tvPage(browser, env.url);
  const code = await openLobby(tv);
  const phones: Screen[] = [];
  for (const [index, name] of NAMES.entries())
    phones.push(await joinPhone(browser, env.url, code, name, AVATARS[index]!));
  const [ece, , merve] = phones as [Screen, Screen, Screen, Screen];
  const room = () => env.server.built.manager.getByCode(code)!;

  // ── Lobby: the leader turns on team play and the simple rules.
  await expect(ece.page.getByTestId('team-picker')).toHaveCount(0); // not in teams yet
  await ece.page
    .getByTestId('ctl-play-mode')
    .getByText(tr['teams.mode.TEAMS'], { exact: true })
    .click();
  await ece.page
    .getByTestId('ctl-ruleset')
    .getByText(tr['teams.ruleset.SIMPLE'], { exact: true })
    .click();
  for (const phone of phones) await expect(phone.page.getByTestId('team-picker')).toBeVisible();
  await expect(tv.page.getByTestId('lobby-teams')).toBeVisible();
  await expect(tv.page.getByTestId('lobby-team-tiger')).toContainText('Ece');
  await expect(tv.page.getByTestId('lobby-team-tiger')).toContainText('Merve');
  await expect(tv.page.getByTestId('lobby-team-owl')).toContainText('Ahmet');
  await expect(tv.page.getByTestId('lobby-team-owl')).toContainText('Can');
  await expect(tv.page.getByTestId('lobby-balance')).toHaveAttribute('data-ok', 'true');
  await expect(merve.page.getByTestId('phone-team')).toHaveText(tr['team.tiger']);
  await shot(tv.page, '60-tv-team-lobby');
  await shot(merve.page, '61-phone-team-picker');

  // A player taps the other team: three owls against one tiger is not a game, and the TV says so.
  await merve.page.getByTestId('team-chip-owl').click();
  await expect(tv.page.getByTestId('lobby-balance')).toHaveAttribute('data-ok', 'false');
  await expect(tv.page.getByTestId('lobby-start')).toBeDisabled();
  await expect(ece.page.getByTestId('ctl-start')).toBeDisabled();
  await expect(ece.page.getByTestId('ctl-need')).toContainText('dengesiz');
  await merve.page.getByTestId('team-chip-tiger').click();
  await expect(tv.page.getByTestId('lobby-balance')).toHaveAttribute('data-ok', 'true');
  await expect(ece.page.getByTestId('ctl-start')).toBeEnabled();

  await ece.page.getByTestId('ctl-start').click();

  // ── Every round: one short prep screen on every phone, answers without the question text.
  const prepAll = async (): Promise<void> => {
    for (const phone of phones) await phone.page.getByTestId('simple-done').click();
  };
  const answerRound = async (): Promise<void> => {
    await expect.poll(() => room().state.phase).toBe('ANSWERING');
    const question = room().state.game!.round!.question!;
    const rightIndex = question.options.findIndex((option) => option.correct);
    const wrongIndex = rightIndex === 0 ? 1 : 0;
    for (const [index, phone] of phones.entries()) {
      const cards = phone.page.locator('button[data-answer-index]');
      await expect(cards).toHaveCount(4);
      // the answers stay on the phone; only the question text is TV-only
      await expect(cards.first()).toContainText(question.options[0]!.text);
      await expect(phone.page.getByTestId('peek-toggle')).toHaveCount(0);
      await phone.page
        .locator(`button[data-answer-index="${index % 2 === 0 ? rightIndex : wrongIndex}"]`)
        .click();
    }
    // everybody answered: the round closes (the score screen is brief, so the next screens are asserted by the caller)
    await expect.poll(() => room().state.phase).not.toBe('ANSWERING');
  };

  // Round 1: Ece doubles down and sabotages the owls with a Time Cut; the owls' shield takes it.
  await expect(tv.page.getByTestId('tv-simple-prep')).toBeVisible();
  await expect(tv.page.getByTestId('tv-pick-title')).toHaveText(tr['tv.simple.title']);
  for (const phone of phones) {
    await expect(phone.page.getByTestId('ctl-simple')).toBeVisible();
    await expect(phone.page.getByTestId('pick-title')).toHaveText(tr['ctl.simple.title']);
    await expect(phone.page.getByTestId('simple-effect-JAM')).toBeVisible();
    await expect(phone.page.getByTestId('simple-effect-FOG')).toHaveCount(0); // only the café menu
  }
  await shot(ece.page, '62-phone-simple-prep');
  await ece.page.getByTestId('simple-dd').click();
  await ece.page.getByTestId('simple-effect-JAM').click();
  await expect(ece.page.getByTestId('simple-aim-tiger')).toHaveCount(0); // never your own team
  await ece.page.getByTestId('simple-aim-owl').click();
  await ece.page.getByTestId('simple-done').click();
  await expect(ece.page.getByTestId('ctl-simple-done')).toBeVisible();
  const prep = (await tv.page.getByTestId('tv-simple-prep').textContent()) ?? '';
  for (const name of NAMES) expect(prep).not.toContain(name); // the TV only counts who is ready
  for (const phone of phones.slice(1)) await phone.page.getByTestId('simple-done').click();

  // The words are on the TV and not on the phones.
  await expect.poll(() => room().state.phase).toBe('QUESTION');
  const question = room().state.game!.round!.question!;
  await expect(tv.page.getByTestId('tv-question')).toContainText(question.text);
  for (const phone of phones) {
    await expect(phone.page.getByTestId('ctl-question')).toBeVisible();
    await expect(phone.page.getByText(question.text)).toHaveCount(0);
  }
  await answerRound();
  await expect(tv.page.getByTestId('tv-team-board')).toBeVisible();
  await expect(tv.page.getByTestId('team-row-tiger')).toHaveAttribute('data-rank', '1');
  await expect(ece.page.getByTestId('ctl-team-rank')).toContainText('1. sırada');
  await shot(tv.page, '63-tv-team-standings');
  await shot(ece.page, '64-phone-team-standing');

  // Rounds 2 and 3: the same short prep, then the answers.
  for (let round = 2; round <= 3; round++) {
    await expect(ece.page.getByTestId('ctl-simple')).toBeVisible();
    await prepAll();
    await answerRound();
  }

  // ── Results: the teams on the podium, the winner named, the players beside them.
  await expect(tv.page.getByTestId('tv-results')).toBeVisible();
  await expect(tv.page.getByRole('heading', { level: 1 })).toHaveText(
    tr['teams.results.winner'].replace('{team}', tr['team.tiger']),
  );
  await expect(tv.page.getByTestId('podium-1')).toContainText(tr['team.tiger']);
  await expect(tv.page.getByTestId('tv-results-players')).toContainText('Ahmet');
  await expect(ece.page.getByTestId('ctl-team-results')).toBeVisible();
  await expect(ece.page.getByTestId('ctl-team-final-tiger')).toBeVisible();
  await shot(tv.page, '65-tv-team-results');
  await shot(merve.page, '66-phone-team-results');

  for (const phone of phones) await phone.context.close();
  await tv.context.close();
});
