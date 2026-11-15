import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PhaseData, RoomView } from '@quizparty/protocol';
import { answeringData, player, roomView, you } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { PhoneFrame } from './PhoneFrame';

afterEach(cleanup);

function room(phaseData: PhaseData): RoomView {
  return roomView({
    phase: phaseData.phase,
    phaseData,
    players: [player(0, { nickname: 'Ece' }), player(1, { nickname: 'Ahmet' })],
    you: you('p1'),
  });
}

const frame = (view: RoomView) => (
  <I18nProvider locale="tr">
    <PhoneFrame room={view} reconnecting={false} tvLost={false} restored={false}>
      <div>screen</div>
    </PhoneFrame>
  </I18nProvider>
);

/** jsdom does not lay anything out: remember what the page assigns to scrollTop. */
function trackScroll(element: HTMLElement): { top: number } {
  const box = { top: 0 };
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => box.top,
    set: (value: number) => {
      box.top = value;
    },
  });
  return box;
}

describe('PhoneFrame scrolling', () => {
  // The risk screen is taller than a 320x568 phone: scrolling down to the Pot / Duel rows and
  // pressing "ready" must not leave the answer screen that follows scrolled past its clock.
  it('starts every new phase at the top of the page', () => {
    const { container, rerender } = render(frame(room(answeringData())));
    const main = container.querySelector('main') as HTMLElement;
    const scroll = trackScroll(main);
    scroll.top = 240;

    rerender(frame({ ...room(answeringData()), phase: 'LOCKED' }));
    expect(scroll.top).toBe(0);
  });

  it('does not yank the page back while the same phase updates', () => {
    const { container, rerender } = render(frame(room(answeringData())));
    const main = container.querySelector('main') as HTMLElement;
    const scroll = trackScroll(main);
    scroll.top = 240;

    rerender(frame({ ...room(answeringData({ answeredPlayerIds: ['p2'] })) }));
    expect(scroll.top).toBe(240);
  });
});
