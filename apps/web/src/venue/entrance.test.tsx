import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VENUE_ACCENT_IDS, VENUE_THEME_IDS } from '@quizparty/protocol';
import { ACCENT_IDS, THEME_IDS } from '@quizparty/ui-tokens';
import { player, roomView } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { TvLobby } from '../tv/screens/TvLobby';
import { PhoneEntrance } from './EntranceLine';
import { applyVenueLook } from './look';
import { TvVenueTimeUp } from './TvVenueTimeUp';

afterEach(cleanup);

const meter = { state: 'RUNNING' as const, endsAt: 9_999_999_999_999, remainingMs: 0 };
const withVenue = (venue: NonNullable<ReturnType<typeof roomView>['venue']>) =>
  roomView({ tier: 'FULL', players: [player(0), player(1)], venue });

const wrap = (node: React.ReactNode) => render(<I18nProvider locale="tr">{node}</I18nProvider>);

const lobby = (room: ReturnType<typeof roomView>) =>
  wrap(
    <TvLobby
      room={room}
      joinUrl="https://x.test/join/ABC234"
      joinLabel="x.test/join"
      starting={false}
      error={null}
      onStart={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenUnlock={vi.fn()}
      categoryLabel="Karışık"
    />,
  );

describe('the entrance line on the TV and the phones (ADR-0030)', () => {
  it('shows beside the room code in the lobby, with its note, and not without a table', () => {
    lobby(
      withVenue({ ...meter, entrance: { text: '150 TL, içecek dahil', note: 'Hafta sonu +20' } }),
    );
    const card = screen.getByTestId('tv-entrance');
    expect(card.textContent).toContain('Giriş ücreti');
    expect(card.textContent).toContain('150 TL, içecek dahil');
    expect(card.textContent).toContain('Hafta sonu +20');
    expect(screen.getByTestId('lobby-code').textContent).toBe('ABC234');
    cleanup();
    lobby(roomView({ players: [player(0), player(1)] }));
    expect(screen.queryByTestId('tv-entrance')).toBeNull();
  });

  it('shows on the "time is up" screen', () => {
    wrap(
      <TvVenueTimeUp
        room={withVenue({ ...meter, state: 'ENDED', endsAt: null, entrance: { text: '150 TL' } })}
        reason="up"
      />,
    );
    expect(screen.getByTestId('tv-entrance').textContent).toContain('150 TL');
  });

  it('is one quiet line on the phone, rendered as text (never as markup)', () => {
    wrap(<PhoneEntrance room={withVenue({ ...meter, entrance: { text: '<b>150</b> TL' } })} />);
    const line = screen.getByTestId('ctl-entrance');
    expect(line.textContent).toBe('Giriş: <b>150</b> TL');
    expect(line.querySelector('b')).toBeNull();
  });
});

describe('the venue look', () => {
  it('sets the theme and the accent from the closed palette, and clears the accent again', () => {
    applyVenueLook(document, { theme: 'venue-gold', accent: 'mint' });
    expect(document.documentElement.dataset.theme).toBe('venue-gold');
    expect(document.documentElement.style.getPropertyValue('--qp-color-accent-a')).toBe('#3ddc97');
    applyVenueLook(document, { theme: 'gusto' });
    expect(document.documentElement.style.getPropertyValue('--qp-color-accent-a')).toBe('');
  });

  it('keeps the protocol lists and the token lists equal', () => {
    expect([...VENUE_THEME_IDS]).toEqual([...THEME_IDS]);
    expect([...VENUE_ACCENT_IDS]).toEqual([...ACCENT_IDS]);
  });
});
