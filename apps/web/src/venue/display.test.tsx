import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { DisplayLockGate } from './DisplayPairing';
import { DisplayPanel } from './DisplayPanel';
import { QuestionStudio } from './QuestionStudio';

/** Venue displays and the question studio (ADR-0028): the TV gate, the panel's TV list, the manual form. */
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
const wrap = (node: React.ReactElement) => render(<I18nProvider locale="tr">{node}</I18nProvider>);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TV gate', () => {
  it('shows the game at once when the lock is off', async () => {
    network((call) =>
      call.path === '/v1/display/poll' ? { json: { lock: false, paired: false } } : undefined,
    );
    wrap(
      <DisplayLockGate>
        <div data-testid="game" />
      </DisplayLockGate>,
    );
    await waitFor(() => expect(screen.getByTestId('game')).toBeTruthy());
    expect(screen.queryByTestId('display-pairing')).toBeNull();
  });

  it('shows the pairing code and no game while unpaired, then the game once paired', async () => {
    let paired = false;
    const calls = network((call) => {
      if (call.path === '/v1/display/poll')
        return {
          json: paired
            ? { lock: true, paired: true }
            : { lock: true, paired: false, pairing: null },
        };
      if (call.path === '/v1/display/pairing')
        return {
          status: 201,
          json: {
            code: 'ABCD-2345',
            expiresAt: Date.now() + 300_000,
            pairUrl: 'http://x/staff?pair=ABCD2345',
          },
        };
      return undefined;
    });
    wrap(
      <DisplayLockGate>
        <div data-testid="game" />
      </DisplayLockGate>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('display-pairing-code').textContent).toBe('ABCD-2345'),
    );
    expect(screen.queryByTestId('game')).toBeNull();
    expect(calls.filter((c) => c.path === '/v1/display/pairing')).toHaveLength(1);
    paired = true;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3200));
    });
    await waitFor(() => expect(screen.getByTestId('game')).toBeTruthy());
  }, 10_000);
});

const DISPLAY = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Salon TV 1',
  pairedAt: 1,
  lastSeenAt: Date.now(),
  online: true,
  roomCode: null,
};
const VENUE = '11111111-1111-4111-8111-111111111111';

describe('panel TV list', () => {
  it('lists screens, pairs with the typed code and removes after a second tap', async () => {
    const calls = network((call) => {
      if (call.path.endsWith('/displays') && call.method === 'GET')
        return { json: { items: [DISPLAY], seats: 3 } };
      if (call.path.endsWith('/displays/pair')) return { status: 201, json: DISPLAY };
      if (call.path.endsWith('/revoke')) return { json: { ok: true } };
      return undefined;
    });
    wrap(<DisplayPanel venueId={VENUE} role="OWNER" initialCode="ABCD2345" />);
    await waitFor(() => expect(screen.getByTestId('display-Salon TV 1')).toBeTruthy());
    expect(screen.getByTestId('displays-seats').textContent).toBe('Lisans: 1 / 3 TV kullanılıyor.');
    expect(screen.getByTestId<HTMLInputElement>('display-code').value).toBe('ABCD2345');
    fireEvent.change(screen.getByTestId('display-name'), { target: { value: 'Bar TV' } });
    fireEvent.submit(screen.getByTestId('display-add'));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/displays/pair'))).toBe(true));
    const pair = calls.find((c) => c.path.endsWith('/displays/pair'))!;
    expect(pair.body).toEqual({ code: 'ABCD2345', name: 'Bar TV' });
    expect(pair.headers['x-quizparty-csrf']).toBe('1');
    fireEvent.click(screen.getByTestId('display-remove-Salon TV 1'));
    expect(calls.some((c) => c.path.endsWith('/revoke'))).toBe(false);
    fireEvent.click(screen.getByTestId('display-remove-Salon TV 1'));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/revoke'))).toBe(true));
  });

  it('gives staff the open button but no add or remove, and explains a full licence', async () => {
    network((call) => {
      if (call.path.endsWith('/displays') && call.method === 'GET')
        return { json: { items: [DISPLAY], seats: 1 } };
      if (call.path.endsWith('/open'))
        return {
          status: 409,
          json: { error: { code: 'INVALID_STATE', params: { reason: 'offline' } } },
        };
      return undefined;
    });
    wrap(<DisplayPanel venueId={VENUE} role="STAFF" initialCode={null} />);
    await waitFor(() => expect(screen.getByTestId('display-open-Salon TV 1')).toBeTruthy());
    expect(screen.queryByTestId('display-add')).toBeNull();
    expect(screen.queryByTestId('display-remove-Salon TV 1')).toBeNull();
    fireEvent.click(screen.getByTestId('display-open-Salon TV 1'));
    await waitFor(() =>
      expect(screen.getByTestId('displays-message').textContent).toBe(
        'Bu TV şu an kapalı görünüyor.',
      ),
    );
  });
});

describe('question studio', () => {
  it('sends the form, shows Turkish problems for a refusal and a confirmation for a save', async () => {
    let saved = false;
    const calls = network((call) => {
      if (call.path.endsWith('/questions') && call.method === 'GET')
        return { json: { categories: [{ id: 'v1-x', label: 'Kutu Oyunları', active: 1 }] } };
      if (call.path.endsWith('/questions/manual'))
        return {
          json: saved
            ? { status: 'OK', saved: true, issues: [] }
            : {
                status: 'INVALID',
                saved: false,
                issues: [{ field: 'question', code: 'question_too_short', params: { min: 10 } }],
              },
        };
      return undefined;
    });
    wrap(<QuestionStudio venueId={VENUE} />);
    fireEvent.change(screen.getByTestId('studio-question'), { target: { value: 'kısa' } });
    fireEvent.click(screen.getByText('Kontrol et'));
    await waitFor(() => expect(screen.getByTestId('studio-result').dataset.status).toBe('INVALID'));
    expect(screen.getByTestId('studio-result').textContent).toMatch(/Soru/u);
    saved = true;
    fireEvent.change(screen.getByTestId('studio-option-1'), { target: { value: 'Dört' } });
    fireEvent.click(screen.getByTestId('studio-correct-1'));
    fireEvent.click(screen.getByTestId('studio-save'));
    await waitFor(() =>
      expect(screen.getByTestId('studio-result').textContent).toBe(
        'Soru kaydedildi, oyunlarda kullanılacak.',
      ),
    );
    const sent = calls
      .filter((c) => c.path.endsWith('/questions/manual'))
      .map((c) => c.body as Record<string, unknown>);
    expect(sent[0]).toMatchObject({ mode: 'check', question: 'kısa' });
    expect(sent[1]).toMatchObject({ mode: 'save', correctIndex: 1 });
    expect((sent[1]!.options as string[])[1]).toBe('Dört');
  });
});
