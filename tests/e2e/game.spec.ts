import { expect, test } from '@playwright/test';
import { liveRoom } from '../helpers/oracle';
import { phonePage, shot, startE2eServer, tvPage, type E2eServer } from './helpers';

/**
 * The first real slice (brief §33): TV opens → room → QR/code → three phones join (separate browser
 * contexts, like separate devices) → leader starts → everyone answers → lock → reveal → score →
 * next question → final → results → rematch. Screenshots of every screen land in
 * test-results/screenshots for visual review.
 */
test.describe('whole game in real browsers', () => {
  let env: E2eServer;
  test.beforeAll(async () => {
    env = await startE2eServer();
  });
  test.afterAll(async () => {
    await env.server.dispose();
  });

  test('one TV and three phones play a full game and a rematch', async ({ browser }) => {
    const tv = await tvPage(browser, env.url);
    await shot(tv.page, '01-tv-title');
    await tv.page.getByTestId('tv-start').click();
    await expect(tv.page.getByTestId('lobby-code')).toBeVisible();
    const code = (await tv.page.getByTestId('lobby-code').innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{6}$/u);
    await shot(tv.page, '02-tv-lobby-empty');

    const people = [
      { name: 'Ece', avatar: 'cat' },
      { name: 'Ahmet', avatar: 'cool' },
      { name: 'Merve', avatar: 'frog' },
    ] as const;
    const phones = [];
    for (const [index, person] of people.entries()) {
      const phone = await phonePage(browser);
      await phone.page.goto(`${env.url}/join/${code}`);
      await phone.page.getByTestId('join-nickname').fill(person.name);
      await phone.page.getByTestId(`avatar-${person.avatar}`).click();
      if (index === 0) await shot(phone.page, '10-phone-join');
      await phone.page.getByTestId('join-submit').click();
      await expect(phone.page.getByTestId('ctl-lobby')).toBeVisible();
      phones.push(phone);
    }
    await expect(tv.page.getByTestId('lobby-players')).toContainText('Merve');
    await shot(tv.page, '03-tv-lobby-full');
    await shot(phones[0]!.page, '11-phone-lobby-leader');
    await shot(phones[1]!.page, '12-phone-lobby-guest');

    // Leader changes a setting from the phone; the TV summary follows.
    await phones[0]!.page.getByRole('button', { name: 'Kolay' }).click();
    await expect(tv.page.getByTestId('lobby-summary')).toContainText('Kolay');

    await phones[0]!.page.getByTestId('ctl-start').click();
    await expect(tv.page.getByTestId('tv-countdown')).toBeVisible();
    await shot(tv.page, '04-tv-countdown');

    const room = env.server.built.manager.getByCode(code)!;
    for (let round = 0; round < 3; round++) {
      if (round === 0) {
        await expect(tv.page.getByTestId('tv-round-intro')).toBeVisible();
        await shot(tv.page, '05-tv-round-intro');
      }
      if (round === 2) {
        await expect(tv.page.getByTestId('tv-final-splash')).toBeVisible();
        await shot(tv.page, '06-tv-final-splash');
      }
      await Promise.all(
        phones.map((phone) => expect(phone.page.getByTestId('ctl-answering')).toBeVisible()),
      );
      await expect(tv.page.getByTestId('tv-options')).toBeVisible();
      const question = room.state.game!.round!.question!;
      const correct = question.options.findIndex((option) => option.correct);
      const wrong = (correct + 1) % question.options.length;
      if (round === 0) {
        await shot(tv.page, '07-tv-answering');
        await shot(phones[0]!.page, '20-phone-answering');
      }

      await phones[0]!.page.locator(`[data-answer-index="${correct}"]`).click();
      await phones[1]!.page.locator(`[data-answer-index="${wrong}"]`).click();
      await expect(phones[0]!.page.getByTestId('ctl-confirmed')).toBeVisible();
      if (round === 0) {
        await shot(phones[0]!.page, '21-phone-confirmed');
        await shot(tv.page, '08-tv-answering-two-done');
      }
      await phones[2]!.page.locator(`[data-answer-index="${correct}"]`).click();

      await expect(tv.page.getByTestId('tv-status')).toContainText(/KİLİTLENDİ/u);
      if (round === 0) await shot(tv.page, '09-tv-locked');
      await expect(phones[0]!.page.getByTestId('ctl-outcome')).toHaveAttribute(
        'data-outcome',
        'CORRECT',
      );
      await expect(phones[1]!.page.getByTestId('ctl-outcome')).toHaveAttribute(
        'data-outcome',
        'INCORRECT',
      );
      if (round === 0) {
        await shot(tv.page, '10-tv-reveal');
        await shot(phones[0]!.page, '22-phone-reveal-correct');
        await shot(phones[1]!.page, '23-phone-reveal-wrong');
        // After the answer highlight the question card turns into the "did you know" card.
        await expect(tv.page.getByTestId('tv-explanation')).toContainText('açıklaması');
        await tv.page.waitForTimeout(1900);
        await shot(tv.page, '10b-tv-reveal-explanation');
      }
      await expect(tv.page.getByTestId('tv-score')).toBeVisible();
      await expect(phones[0]!.page.getByTestId('ctl-score')).toBeVisible();
      if (round === 0) {
        await shot(tv.page, '11-tv-score-start');
        await shot(phones[0]!.page, '24-phone-score');
      }
      if (round === 0) {
        await tv.page.waitForTimeout(2200);
        await shot(tv.page, '12-tv-score-settled');
        // Settled: the leader moved to the top and is the only one wearing the crown.
        await expect(tv.page.getByTestId('score-row-Ece')).toHaveAttribute('data-rank', '1');
        await expect(
          tv.page.locator('[data-testid="tv-score"] img[data-sticker="crown"]'),
        ).toHaveCount(1);
      }
    }

    await expect(tv.page.getByTestId('tv-results')).toBeVisible();
    await expect(tv.page.getByTestId('podium-1')).toBeVisible();
    await tv.page.waitForTimeout(1800);
    await shot(tv.page, '13-tv-results');
    await expect(phones[0]!.page.getByTestId('ctl-results')).toBeVisible();
    await shot(phones[0]!.page, '25-phone-results-leader');
    await shot(phones[1]!.page, '26-phone-results-guest');
    expect(liveRoom(env.server, room.id).state.phase).toBe('RESULTS');

    // The first player answered everything right: they are on top.
    await expect(phones[0]!.page.getByTestId('ctl-final-rank')).toHaveText('1');

    // Rematch from the leader's phone starts a fresh countdown on the TV.
    await phones[0]!.page.getByTestId('ctl-rematch').click();
    await expect(tv.page.getByTestId('tv-countdown')).toBeVisible();
    for (const phone of phones) await phone.context.close();
    await tv.context.close();
  });
});
