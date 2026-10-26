import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PhaseDataOf } from '@quizparty/protocol';
import { player, roomView, ROUND } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../../lib/i18n';
import { TvPowerResolution, powerGridScale } from './TvPower';

afterEach(cleanup);

type Item = PhaseDataOf<'POWER_RESOLUTION'>['items'][number];

const room = roomView({
  players: [player(0, { nickname: 'Ece' }), player(1, { nickname: 'Ahmet' })],
});
const stake = (id: string): Item => ({
  kind: 'STAKE',
  playerId: id,
  tier: 'RISK',
  outcome: 'CORRECT',
});
const hit = (n: number): Item => ({
  kind: 'SABOTAGE',
  actorId: 'p0',
  targetId: 'p1',
  effect: n % 2 === 0 ? 'FOG' : 'JAM',
  blocked: false,
});
const show = (items: Item[]) =>
  render(
    <I18nProvider locale="tr">
      <TvPowerResolution room={room} data={{ phase: 'POWER_RESOLUTION', round: ROUND, items }} />
    </I18nProvider>,
  );

// The grid holds four rows of cards in the 760 px under the title; a party of eight that all
// gamble used to push the first row under the title and the last one off the bottom of the stage.
describe('a crowded power resolution', () => {
  it('keeps a table of eight inside the stage by scaling the grid', () => {
    expect(powerGridScale([stake('p0'), stake('p1'), stake('p2'), stake('p3')])).toBe(1);
    expect(powerGridScale([hit(0), hit(1), hit(2), hit(3)])).toBe(1); // four wide cards = four rows
    const many = [...Array.from({ length: 8 }, (_, i) => stake(`p${i}`)), hit(0), hit(1), hit(2)];
    const scale = powerGridScale(many);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(0.45);
    // 4 rows of stakes + 3 wide rows = 7 rows of 172 px
    expect(7 * 172 * scale).toBeLessThanOrEqual(760.001);
  });

  it('puts a lone half-width card in a row of its own before a wide one', () => {
    const items = [stake('p0'), hit(0), stake('p1'), stake('p2'), hit(1)];
    // rows: [stake] [hit] [stake stake] [hit] = 4
    expect(powerGridScale(items)).toBe(1);
    expect(powerGridScale([...items, stake('p3')])).toBeLessThan(1); // 5 rows
  });

  it('never shrinks below a size that can still be read from the sofa', () => {
    const absurd = Array.from({ length: 64 }, (_, i) => hit(i));
    expect(powerGridScale(absurd)).toBeGreaterThanOrEqual(0.45);
  });

  it('applies the scale to the rendered grid and leaves a small round alone', () => {
    show(Array.from({ length: 12 }, (_, i) => stake(i % 2 === 0 ? 'p0' : 'p1')));
    const grid = screen.getAllByTestId('power-item')[0]!.parentElement!;
    expect(grid.style.transform).toMatch(/^scale\(0\.\d+\)$/);
    cleanup();
    show([stake('p0'), stake('p1')]);
    expect(screen.getAllByTestId('power-item')[0]!.parentElement!.style.transform).toBe('');
  });
});
