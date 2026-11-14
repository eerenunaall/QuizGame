import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { RespondPage } from './Respond';
import { QuizEditorPage } from './QuizEditor';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Answer = { status?: number; json?: unknown };
/** The network only; answers speak the server's real wire shapes. Returns the paths called. */
function network(handler: (method: string, path: string) => Answer | undefined): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${path}`);
      const answer = handler(method, path) ?? {
        status: 404,
        json: { error: { code: 'NOT_FOUND' } },
      };
      return Promise.resolve(
        new Response(JSON.stringify(answer.json ?? {}), { status: answer.status ?? 200 }),
      );
    }),
  );
  return calls;
}

const mountRespond = () =>
  render(
    <I18nProvider locale="en">
      <RespondPage token="t-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" />
    </I18nProvider>,
  );

const view = (features?: { suggestDecoys: boolean }) => ({
  ...(features ? { features } : {}),
  quiz: { title: 'Q', language: 'en' },
  target: { name: 'Ece', consented: true },
  prompts: [
    {
      promptId: 'p1',
      position: 0,
      source: 'CUSTOM',
      catalogKey: null,
      text: 'Favourite food?',
      response: { answer: 'Pizza', decoys: ['Soup'], approved: false },
    },
  ],
});

describe('respond page link states', () => {
  it('explains a link claimed in another browser (403)', async () => {
    network(() => ({ status: 403, json: { error: { code: 'FORBIDDEN' } } }));
    mountRespond();
    await waitFor(() => expect(screen.getByTestId('respond-claimed')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/another browser/u);
  });
  it('says expired/replaced/deleted for 404', async () => {
    network(() => undefined);
    mountRespond();
    await waitFor(() => expect(screen.getByTestId('respond-dead')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/expired/u);
  });
  it('offers a retry on a server hiccup', async () => {
    let n = 0;
    network(() =>
      n++ === 0 ? { status: 500, json: { error: { code: 'INTERNAL' } } } : { json: view() },
    );
    mountRespond();
    await waitFor(() => screen.getByTestId('respond-unavailable'));
    fireEvent.click(screen.getByTestId('respond-retry'));
    await waitFor(() => screen.getByTestId('respond-page'));
  });
  it('shows the deleted state after the target deletes everything', async () => {
    vi.stubGlobal('confirm', () => true);
    network((method) => (method === 'DELETE' ? { json: { ok: true } } : { json: view() }));
    mountRespond();
    await waitFor(() => screen.getByTestId('respond-delete'));
    fireEvent.click(screen.getByTestId('respond-delete'));
    await waitFor(() => expect(screen.getByTestId('respond-deleted')).toBeTruthy());
  });
});

describe('suggest wrong answers', () => {
  it('has no button unless the server says the feature is on', async () => {
    network(() => ({ json: view({ suggestDecoys: false }) }));
    mountRespond();
    await waitFor(() => screen.getByTestId('prompt-0'));
    expect(screen.queryByTestId('suggest-0')).toBeNull();
  });
  it('fills empty fields with suggestions the target still has to save', async () => {
    const calls = network((method, path) =>
      path.endsWith('/suggest-decoys')
        ? { json: { decoys: ['Soup', 'Kebab', 'Salad'], source: 'AI' } }
        : method === 'GET'
          ? { json: view({ suggestDecoys: true }) }
          : undefined,
    );
    mountRespond();
    await waitFor(() => screen.getByTestId('suggest-0'));
    fireEvent.click(screen.getByTestId('suggest-0'));
    await waitFor(() =>
      expect(screen.getByTestId<HTMLInputElement>('decoy-0-1').value).toBe('Kebab'),
    );
    expect(screen.getByTestId<HTMLInputElement>('decoy-0-0').value).toBe('Soup');
    expect(screen.getByTestId<HTMLInputElement>('decoy-0-2').value).toBe('Salad');
    expect(calls.some((c) => c.startsWith('PUT'))).toBe(false);
  });
  it.each([
    ['nothing proposed', { json: { decoys: [], source: 'NONE' } }],
    ['the call failing', { status: 500, json: { error: { code: 'INTERNAL' } } }],
  ])('falls back silently to manual fields on %s', async (_name, reply) => {
    network((method, path) =>
      path.endsWith('/suggest-decoys')
        ? reply
        : method === 'GET'
          ? { json: view({ suggestDecoys: true }) }
          : undefined,
    );
    mountRespond();
    await waitFor(() => screen.getByTestId('suggest-0'));
    fireEvent.click(screen.getByTestId('suggest-0'));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId<HTMLInputElement>('decoy-0-1').value).toBe('');
  });
});

describe('quiz editor: refused invite rotation', () => {
  it('says plainly that a claimed invite cannot be replaced', async () => {
    network((method, path) => {
      if (path === '/v1/me')
        return {
          json: { account: { id: 'a', email: 'c@example.test', roles: [], sessionKind: 'WEB' } },
        };
      if (path.endsWith('/invite') && method === 'POST')
        return { status: 409, json: { error: { code: 'NOT_READY' } } };
      if (path === '/v1/quizzes/q1')
        return {
          json: {
            id: 'q1',
            kind: 'BLIND',
            title: 'Quiz',
            language: 'en',
            createdAt: '2026-01-01T00:00:00Z',
            retainUntil: '2026-02-01T00:00:00Z',
            ready: true,
            prompts: [],
            questions: [],
            targets: [
              {
                id: 't1',
                displayName: 'Ece',
                status: 'PENDING',
                answered: 0,
                approved: 0,
                total: 1,
              },
            ],
          },
        };
      return undefined;
    });
    render(
      <I18nProvider locale="en">
        <QuizEditorPage id="q1" />
      </I18nProvider>,
    );
    await waitFor(() => screen.getByTestId('target-list'));
    fireEvent.click(screen.getByText('New link'));
    await waitFor(() =>
      expect(screen.getByTestId('quiz-error').textContent).toMatch(/Ece has already opened/u),
    );
    expect(screen.queryByTestId('invite-link')).toBeNull();
  });
});
