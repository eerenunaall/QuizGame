import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Venues } from './pages/Venues';
import { fakeServer } from './testing';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VENUE = '6f1c1a2e-3333-4b7a-9c1d-000000000003';
const row = {
  id: VENUE,
  name: 'Gusto Board Game Cafe',
  createdAt: '2026-10-19T10:00:00Z',
  owners: ['sahip@gusto.example'],
  staff: 3,
  openTables: 2,
};

describe('venues in the console (ADR-0024)', () => {
  it('creates a venue with its owner', async () => {
    const { calls } = fakeServer((call) => {
      if (call.path === '/v1/admin/venues' && call.method === 'GET') return { json: { items: [] } };
      if (call.path === '/v1/admin/venues') return { status: 201, json: { id: VENUE } };
      return undefined;
    });
    render(<Venues id={undefined} />);
    const form = await screen.findByTestId('venue-create');
    const [name, email] = within(form).getAllByRole('textbox');
    fireEvent.change(name!, { target: { value: 'Gusto' } });
    fireEvent.change(email!, { target: { value: 'sahip@gusto.example' } });
    fireEvent.submit(form);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Gusto',
      ownerEmail: 'sahip@gusto.example',
    });
  });

  it('shows the per-day report with a total, counts only', async () => {
    fakeServer((call) => {
      if (call.path === '/v1/admin/venues') return { json: { items: [row] } };
      if (call.path.startsWith(`/v1/admin/venues/${VENUE}/report`))
        return {
          json: {
            days: [
              {
                date: '2026-10-18',
                sessions: 4,
                minutesSold: 300,
                extensions: 2,
                rewardsIssued: 3,
                rewardsRedeemed: 2,
              },
              {
                date: '2026-10-19',
                sessions: 1,
                minutesSold: 60,
                extensions: 0,
                rewardsIssued: 1,
                rewardsRedeemed: 1,
              },
            ],
          },
        };
      return undefined;
    });
    render(<Venues id={VENUE} />);
    const report = await screen.findByTestId('venue-report');
    await waitFor(() => expect(within(report).getByText('2026-10-18')).toBeTruthy());
    expect(within(report).getByText('360')).toBeTruthy();
    expect(screen.getByTestId('venue-csv')).toBeTruthy();
  });

  it("asks for the venue's own days: no browser UTC date in the first request, the server's range shown", async () => {
    const { calls } = fakeServer((call) => {
      if (call.path === '/v1/admin/venues') return { json: { items: [row] } };
      if (call.path.startsWith(`/v1/admin/venues/${VENUE}/report`))
        return { json: { from: '2026-09-27', to: '2026-10-27', days: [] } };
      return undefined;
    });
    render(<Venues id={VENUE} />);
    await screen.findByTestId('venue-report');
    const first = calls.find((c) => c.path.startsWith(`/v1/admin/venues/${VENUE}/report`))!;
    expect(first.path).toBe(`/v1/admin/venues/${VENUE}/report`);
    const detail = screen.getByTestId('venue-detail');
    await waitFor(() =>
      expect(
        [...detail.querySelectorAll<HTMLInputElement>('input[type="date"]')].map((i) => i.value),
      ).toEqual(['2026-09-27', '2026-10-27']),
    );
  });
});
