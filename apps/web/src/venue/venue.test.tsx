import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roomView } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { UnlockPage } from '../pages/Unlock';
import { formatLeft, meterBlocked, meterLeftMs, meterTone } from './meter';
import { PhoneReward, PhoneVenueNotice } from './PhoneVenue';
import { StaffPage } from './StaffPage';
import { TvVenueTimeUp } from './TvVenueTimeUp';
import { VenueChip } from './VenueChip';

/** Venue mode screens (ADR-0024): the TV chip and time-up screen, the winner's phone, the staff desk. */
const T0 = 1_800_000_000_000;
const running = (leftMs: number) => ({
  state: 'RUNNING' as const,
  endsAt: T0 + leftMs,
  remainingMs: 0,
});
const wrap = (node: React.ReactElement, locale: 'tr' | 'en' = 'tr') =>
  render(<I18nProvider locale={locale}>{node}</I18nProvider>);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('meter display rules', () => {
  it('is calm, then amber from five minutes, red from one, up at zero', () => {
    expect(meterTone(running(6 * 60_000), T0)).toBe('calm');
    expect(meterTone(running(5 * 60_000), T0)).toBe('amber');
    expect(meterTone(running(60_000), T0)).toBe('red');
    expect(meterTone(running(0), T0)).toBe('up');
    expect(meterTone({ state: 'PAUSED', endsAt: null, remainingMs: 1 }, T0)).toBe('paused');
    expect(meterTone({ state: 'ENDED', endsAt: null, remainingMs: 99_999 }, T0)).toBe('up');
    expect(meterLeftMs({ state: 'ENDED', endsAt: null, remainingMs: 99_999 }, T0)).toBe(0);
  });

  it('blocks a new game only when time is up or paused', () => {
    expect(meterBlocked(undefined, T0)).toBeNull();
    expect(meterBlocked(running(1000), T0)).toBeNull();
    expect(meterBlocked(running(0), T0)).toBe('up');
    expect(meterBlocked({ state: 'PAUSED', endsAt: null, remainingMs: 5 }, T0)).toBe('paused');
  });

  it('formats time left, rounding up', () => {
    expect(formatLeft(0)).toBe('0:00');
    expect(formatLeft(1)).toBe('0:01');
    expect(formatLeft(65_000)).toBe('1:05');
    expect(formatLeft(3_725_000)).toBe('1:02:05');
  });
});

describe('TV', () => {
  it('shows a quiet chip that turns amber and red', () => {
    const { rerender } = wrap(<VenueChip venue={running(30 * 60_000)} now={() => T0} />);
    expect(screen.getByTestId('venue-chip').dataset.tone).toBe('calm');
    expect(screen.getByTestId('venue-chip').textContent).toContain('30:00');
    rerender(
      <I18nProvider locale="tr">
        <VenueChip venue={running(4 * 60_000)} now={() => T0} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('venue-chip').dataset.tone).toBe('amber');
    rerender(
      <I18nProvider locale="tr">
        <VenueChip venue={running(30_000)} now={() => T0} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('venue-chip').dataset.tone).toBe('red');
  });

  it('says who to ask when the time is up, with the table code', () => {
    wrap(<TvVenueTimeUp room={roomView({ code: 'ABC234' })} reason="up" />);
    expect(screen.getByText('Süre doldu')).toBeTruthy();
    expect(screen.getByText('Uzatmak için görevliye söyleyin.')).toBeTruthy();
    expect(screen.getByText('Masa kodu: ABC234')).toBeTruthy();
  });
});

describe('phone', () => {
  it('shows the winner the code big, what it is, and until when', () => {
    wrap(<PhoneReward reward={{ code: 'ABCD2345', text: 'Bir içecek bizden', expiresAt: T0 }} />);
    expect(screen.getByTestId('ctl-venue-reward-code').textContent).toBe('ABCD-2345');
    expect(screen.getByText('Bir içecek bizden')).toBeTruthy();
    expect(screen.getByText(/saatine kadar geçerli/u)).toBeTruthy();
  });

  it('tells the table the time is up (the start would be refused)', () => {
    const room = { ...roomView({}), venue: running(0) };
    wrap(<PhoneVenueNotice room={room} now={() => T0} />, 'en');
    expect(screen.getByTestId('ctl-venue-blocked').textContent).toMatch(/time is up/iu);
  });
});

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
function network(handler: (call: Call) => { status?: number; json?: unknown } | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        path,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      const answer = handler(call) ?? { status: 404, json: { error: { code: 'NOT_FOUND' } } };
      return Promise.resolve(
        new Response(JSON.stringify(answer.json ?? {}), { status: answer.status ?? 200 }),
      );
    }),
  );
  return calls;
}
const account = { id: 'a1', email: 'garson@kafe.test', roles: [], sessionKind: 'WEB' };
const VENUE = { id: '11111111-1111-4111-8111-111111111111', name: 'Gusto', role: 'STAFF' };
const table = {
  id: '22222222-2222-4222-8222-222222222222',
  roomCode: 'ABC234',
  state: 'RUNNING',
  remainingMs: 0,
  endsAt: Date.now() + 42 * 60_000,
  purchasedMinutes: 60,
  startedAt: Date.now(),
  timeUp: false,
  roomLive: true,
};

describe('staff desk', () => {
  it('lists open tables with their time and extends one with the CSRF header', async () => {
    const calls = network((call) => {
      if (call.path === '/v1/me') return { json: { account } };
      if (call.path === '/v1/venue/me') return { json: { venues: [VENUE] } };
      if (call.path.endsWith('/sessions') && call.method === 'GET')
        return {
          json: {
            serverTime: Date.now(),
            items: [table],
            role: 'STAFF',
            steps: [15, 30, 60],
            defaultMinutes: 60,
          },
        };
      if (call.path.endsWith('/extend')) return { json: table };
      return undefined;
    });
    wrap(<StaffPage />);
    await waitFor(() => expect(screen.getByTestId('staff-table-ABC234')).toBeTruthy());
    expect(screen.getByTestId('staff-status-ABC234').textContent).toMatch(/Kalan 4[12]:\d\d/u);
    // owners only: staff see no settings tab
    expect(screen.queryByTestId('staff-tab-settings')).toBeNull();
    fireEvent.click(screen.getByTestId('staff-extend-ABC234-30'));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/extend'))).toBe(true));
    const extend = calls.find((c) => c.path.endsWith('/extend'))!;
    expect(extend.method).toBe('POST');
    expect(extend.body).toEqual({ minutes: 30 });
    expect(extend.headers['x-quizparty-csrf']).toBe('1');
  });

  it('asks twice before ending a table', async () => {
    const calls = network((call) => {
      if (call.path === '/v1/me') return { json: { account } };
      if (call.path === '/v1/venue/me') return { json: { venues: [VENUE] } };
      if (call.path.endsWith('/sessions'))
        return {
          json: {
            serverTime: Date.now(),
            items: [table],
            role: 'STAFF',
            steps: [15],
            defaultMinutes: 60,
          },
        };
      if (call.path.endsWith('/end')) return { json: { ...table, state: 'ENDED' } };
      return undefined;
    });
    wrap(<StaffPage />);
    await waitFor(() => expect(screen.getByTestId('staff-end-ABC234')).toBeTruthy());
    fireEvent.click(screen.getByTestId('staff-end-ABC234'));
    expect(calls.some((c) => c.path.endsWith('/end'))).toBe(false);
    expect(screen.getByTestId('staff-end-ABC234').textContent).toMatch(/bitirilsin mi/u);
    fireEvent.click(screen.getByTestId('staff-end-ABC234'));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/end'))).toBe(true));
  });

  it('checks a reward code once and explains a second use', async () => {
    let used = false;
    network((call) => {
      if (call.path === '/v1/me') return { json: { account } };
      if (call.path === '/v1/venue/me') return { json: { venues: [VENUE] } };
      if (call.path.endsWith('/sessions'))
        return {
          json: {
            serverTime: Date.now(),
            items: [],
            role: 'STAFF',
            steps: [15],
            defaultMinutes: 60,
          },
        };
      if (call.path.endsWith('/rewards/redeem')) {
        if (used) return { status: 409, json: { error: { code: 'REWARD_ALREADY_REDEEMED' } } };
        used = true;
        return { json: { text: 'Bir içecek bizden', winner: 'Ece', issuedAt: 1, redeemedAt: 2 } };
      }
      return undefined;
    });
    wrap(<StaffPage />);
    await waitFor(() => expect(screen.getByTestId('staff-tab-redeem')).toBeTruthy());
    fireEvent.click(screen.getByTestId('staff-tab-redeem'));
    fireEvent.change(screen.getByTestId('staff-redeem-code'), { target: { value: 'abcd-2345' } });
    fireEvent.click(screen.getByTestId('staff-redeem-submit'));
    await waitFor(() => expect(screen.getByTestId('staff-redeem-result').dataset.ok).toBe('1'));
    expect(screen.getByTestId('staff-redeem-result').textContent).toBe(
      'Geçerli! Ece: Bir içecek bizden',
    );
    fireEvent.change(screen.getByTestId('staff-redeem-code'), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByTestId('staff-redeem-submit'));
    await waitFor(() => expect(screen.getByTestId('staff-redeem-result').dataset.ok).toBe('0'));
    expect(screen.getByTestId('staff-redeem-result').textContent).toBe('Bu kod zaten kullanıldı.');
  });

  it('opens a table from the TV QR link without asking for a code', async () => {
    window.history.replaceState(null, '', '/staff?link=tok-AAAAAAAAAAAAAAAAAAAA');
    const calls = network((call) => {
      if (call.path === '/v1/me') return { json: { account } };
      if (call.path === '/v1/venue/me') return { json: { venues: [VENUE] } };
      if (call.path.endsWith('/sessions') && call.method === 'GET')
        return {
          json: {
            serverTime: Date.now(),
            items: [],
            role: 'STAFF',
            steps: [15],
            defaultMinutes: 90,
          },
        };
      if (call.path.endsWith('/sessions'))
        return { status: 201, json: { ...table, purchasedMinutes: 90 } };
      return undefined;
    });
    wrap(<StaffPage />);
    await waitFor(() => expect(screen.getByTestId('staff-new-linked')).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByTestId<HTMLInputElement>('staff-new-minutes').value).toBe('90'),
    );
    fireEvent.click(screen.getByTestId('staff-new-open'));
    await waitFor(() => expect(screen.getByTestId('staff-new-result')).toBeTruthy());
    const open = calls.find((c) => c.path.endsWith('/sessions') && c.method === 'POST')!;
    expect(open.body).toEqual({ minutes: 90, link: 'tok-AAAAAAAAAAAAAAAAAAAA' });
  });

  it('says so when the account works at no venue, or when venue mode is off', async () => {
    network((call) => {
      if (call.path === '/v1/me') return { json: { account } };
      if (call.path === '/v1/venue/me') return { json: { venues: [] } };
      return undefined;
    });
    wrap(<StaffPage />);
    await waitFor(() => expect(screen.getByTestId('staff-none')).toBeTruthy());
  });
});

describe('unlock page', () => {
  it('offers venue staff to open the TV as a table, and nobody else', async () => {
    network((call) => {
      if (call.path === '/v1/me') return { json: { account } };
      if (call.path === '/v1/venue/me') return { json: { venues: [VENUE] } };
      if (call.path.startsWith('/v1/link-intents/'))
        return { json: { roomCode: 'ABC234', tier: 'FREE', mode: 'CLASSIC', quizzes: [] } };
      return undefined;
    });
    wrap(<UnlockPage token="tok-AAAAAAAAAAAAAAAAAAAA" />);
    await waitFor(() => expect(screen.getByTestId('unlock-staff')).toBeTruthy());
    expect(screen.getByTestId('unlock-staff').getAttribute('href')).toBe(
      '/staff?link=tok-AAAAAAAAAAAAAAAAAAAA',
    );
    cleanup();
    network((call) => {
      if (call.path === '/v1/me') return { json: { account } };
      if (call.path === '/v1/venue/me')
        return { status: 404, json: { error: { code: 'FEATURE_DISABLED' } } };
      if (call.path.startsWith('/v1/link-intents/'))
        return { json: { roomCode: 'ABC234', tier: 'FREE', mode: 'CLASSIC', quizzes: [] } };
      return undefined;
    });
    wrap(<UnlockPage token="tok-AAAAAAAAAAAAAAAAAAAA" />);
    await waitFor(() => expect(screen.getByTestId('unlock-claim')).toBeTruthy());
    expect(screen.queryByTestId('unlock-staff')).toBeNull();
  });
});
