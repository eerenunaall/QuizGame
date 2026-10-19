import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Reports } from './pages/Reports';
import { fakeServer } from './testing';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const QUIZ = '6f1c1a2e-1111-4b7a-9c1d-000000000001';
const QUESTION = '6f1c1a2e-2222-4b7a-9c1d-000000000002';

describe('personal-quiz reports in the console (ADR-0015)', () => {
  it('lists ids only and removes the reported question on request', async () => {
    let open = true;
    const { calls } = fakeServer((call) => {
      if (call.path.startsWith('/v1/admin/reports')) return { json: { total: 0, items: [] } };
      if (call.path.startsWith('/v1/admin/personal-reports?'))
        return {
          json: {
            total: open ? 1 : 0,
            items: open
              ? [
                  {
                    id: 'r1',
                    quizId: QUIZ,
                    kind: 'BLIND',
                    questionId: QUESTION,
                    reason: 'OFFENSIVE',
                    status: 'OPEN',
                    createdAt: '2026-10-19T10:00:00Z',
                    resolvedAt: null,
                    resolution: null,
                    reports: 2,
                  },
                ]
              : [],
          },
        };
      if (call.path === '/v1/admin/personal-reports/r1/resolve') {
        open = false;
        return { json: { ok: true, closed: 2 } };
      }
      return undefined;
    });
    render(<Reports />);
    const table = await screen.findByTestId('personal-report-table');
    await waitFor(() => expect(table.textContent).toContain(QUESTION));
    expect(table.textContent).toContain('Blind Quiz');
    expect(table.textContent).toContain('2 bildirim');
    fireEvent.click(within(table).getByTestId('personal-report-REMOVE_QUESTION'));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/v1/admin/personal-reports/r1/resolve')).toBe(true),
    );
    const sent = calls.find((c) => c.path === '/v1/admin/personal-reports/r1/resolve')!;
    expect(sent).toMatchObject({ method: 'POST', body: { action: 'REMOVE_QUESTION' } });
    await waitFor(() =>
      expect(screen.getByTestId('personal-report-table').textContent).not.toContain(QUESTION),
    );
  });
});
