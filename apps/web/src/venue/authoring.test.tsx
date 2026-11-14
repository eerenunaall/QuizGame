import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { DocumentAuthoring } from './DocumentAuthoring';
import type { DraftItem } from './displaysApi';
import { QuestionStudio } from './QuestionStudio';

/** The Soru Stüdyosu's document path (ADR-0028 §6): upload, progress, review cards, approval. */
interface Call {
  method: string;
  path: string;
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
  vi.restoreAllMocks();
});

const VENUE = '11111111-1111-4111-8111-111111111111';
const STATE = {
  enabled: true,
  quota: { limit: 5, used: 1, resetAt: null },
  limits: { maxBytes: 10485760, maxPages: 50, maxChars: 200000 },
};
const draft = (n: number, over: Record<string, unknown> = {}): DraftItem => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  fileName: 'kule.txt',
  expiresAt: Date.now() + 86_400_000,
  payload: {
    category: 'Galata',
    difficulty: 'EASY',
    question: `Galata Kulesi ${n}. soruda hangi yılda inşa edilmiştir?`,
    options: ['1204', '1348', '1453', '1520'],
    correctIndex: 1,
    explanation: 'Kule 1348 yılında inşa edilmiştir.',
    sourceQuote: '1348 yılında Cenevizliler tarafından inşa edilmiştir',
    page: 'bölüm 1',
    ...over,
  },
});
const pick = (name = 'kule.txt', content = 'Galata Kulesi hakkında bir belge. '.repeat(10)) => {
  const input = screen.getByTestId('authoring-file');
  fireEvent.change(input, {
    target: { files: [new File([content], name, { type: 'text/plain' })] },
  });
};

describe('DocumentAuthoring', () => {
  it('explains why it is off and leaves the manual form working', async () => {
    network((call) =>
      call.path.endsWith('/authoring') ? { json: { ...STATE, enabled: false } } : undefined,
    );
    wrap(<QuestionStudio venueId={VENUE} />);
    expect((await screen.findByTestId('authoring-off')).textContent).toMatch(/kapalı/u);
    expect(screen.queryByTestId('authoring-start')).toBeNull();
    expect(screen.getByTestId('studio-save')).toBeTruthy();
  });

  it('uploads a file, shows progress, then the draft cards with the correct option marked', async () => {
    let polls = 0;
    const calls = network((call) => {
      if (call.path.endsWith('/authoring') && call.method === 'GET') return { json: STATE };
      if (call.path.endsWith('/authoring/runs') && call.method === 'POST')
        return { status: 202, json: { runId: 'run-1' } };
      if (call.path.endsWith('/authoring/runs/run-1'))
        return {
          json:
            ++polls < 2
              ? {
                  id: 'run-1',
                  status: 'RUNNING',
                  failure: null,
                  fileName: 'kule.txt',
                  drafts: 0,
                  discarded: 0,
                }
              : {
                  id: 'run-1',
                  status: 'OK',
                  failure: null,
                  fileName: 'kule.txt',
                  drafts: 2,
                  discarded: 1,
                },
        };
      if (call.path.endsWith('/authoring/drafts'))
        return { json: { items: polls >= 2 ? [draft(1), draft(2)] : [] } };
      return undefined;
    });
    wrap(<DocumentAuthoring venueId={VENUE} pollMs={10} />);
    await screen.findByTestId('authoring-quota');
    expect(screen.getByTestId('authoring-quota').textContent).toBe('Bugün 1 / 5 belge kullanıldı.');
    expect(screen.getByTestId<HTMLButtonElement>('authoring-start').disabled).toBe(true);
    pick();
    expect(screen.getByTestId('authoring-chosen').textContent).toBe('Seçilen dosya: kule.txt');
    fireEvent.change(screen.getByTestId('authoring-category'), { target: { value: 'Galata' } });
    fireEvent.click(screen.getByTestId('authoring-start'));
    await screen.findByTestId('authoring-progress');
    await waitFor(() => expect(screen.getAllByTestId('draft-card')).toHaveLength(2));
    expect(screen.queryByTestId('authoring-progress')).toBeNull();
    expect(screen.getByTestId('authoring-done').textContent).toBe(
      '2 taslak soru hazır. 1 öneri belgeye ya da kurallara uymadığı için atıldı.',
    );
    const sent = calls.find((c) => c.path.endsWith('/authoring/runs') && c.method === 'POST')!;
    expect(sent.body).toMatchObject({ fileName: 'kule.txt', category: 'Galata' });
    const text = Buffer.from((sent.body as { data: string }).data, 'base64').toString('utf8');
    expect(text).toContain('Galata Kulesi hakkında');
    const first = screen.getAllByTestId('draft-card')[0]!;
    const marked = first.querySelectorAll('[data-correct="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain('1348');
    expect(marked[0]!.textContent).toContain('Doğru cevap');
    expect(within(first).getByTestId('draft-quote').textContent).toContain('Cenevizliler');
    expect(screen.getByText(/Bunlar henüz oyunda değil/u)).toBeTruthy();
  });

  it('approves one card, then all after a confirmation, and shows what could not be approved', async () => {
    let items = [draft(1), draft(2), draft(3)];
    const calls = network((call) => {
      if (call.path.endsWith('/authoring') && call.method === 'GET') return { json: STATE };
      if (call.path.endsWith('/authoring/drafts') && call.method === 'GET')
        return { json: { items } };
      if (call.path.endsWith('/drafts/approve')) {
        const body = call.body as { ids?: string[]; all?: boolean };
        if (body.ids) {
          items = items.filter((d) => d.id !== body.ids![0]);
          return { json: { approved: 1, problems: [] } };
        }
        const bad = items[0]!;
        items = [bad];
        return {
          json: {
            approved: 1,
            problems: [
              {
                id: bad.id,
                issues: [{ field: 'question', code: 'question_too_short', params: { min: 10 } }],
              },
            ],
          },
        };
      }
      return undefined;
    });
    wrap(<DocumentAuthoring venueId={VENUE} />);
    await waitFor(() => expect(screen.getAllByTestId('draft-card')).toHaveLength(3));
    fireEvent.click(within(screen.getAllByTestId('draft-card')[1]!).getByTestId('draft-approve'));
    await waitFor(() => expect(screen.getAllByTestId('draft-card')).toHaveLength(2));
    expect(screen.getByTestId('authoring-notice').textContent).toBe(
      '1 soru onaylandı, oyunlarda kullanılacak.',
    );
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId('authoring-approve-all'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.path.endsWith('/drafts/approve'))).toHaveLength(1);
    fireEvent.click(screen.getByTestId('authoring-approve-all'));
    await waitFor(() => expect(screen.getByTestId('draft-issues')).toBeTruthy());
    expect(calls.filter((c) => c.path.endsWith('/drafts/approve')).at(-1)!.body).toEqual({
      all: true,
    });
    expect(screen.getByTestId('draft-issues').textContent).toMatch(/kısa/u);
    expect(screen.getByTestId('authoring-notice').textContent).toContain('onaylanamadı');
  });

  it('edits a card inline and deletes another', async () => {
    let items = [draft(1), draft(2)];
    const calls = network((call) => {
      if (call.path.endsWith('/authoring') && call.method === 'GET') return { json: STATE };
      if (call.path.endsWith('/authoring/drafts') && call.method === 'GET')
        return { json: { items } };
      if (call.path.endsWith('/delete')) {
        items = items.slice(0, 1);
        return { json: { ok: true } };
      }
      if (call.path.endsWith(`/drafts/${items[0]!.id}`)) {
        const body = call.body as { question: string; options: string[]; correctIndex: number };
        items = [{ ...items[0]!, payload: { ...items[0]!.payload, ...body } }, ...items.slice(1)];
        return { json: { draft: items[0], issues: [] } };
      }
      return undefined;
    });
    wrap(<DocumentAuthoring venueId={VENUE} />);
    await waitFor(() => expect(screen.getAllByTestId('draft-card')).toHaveLength(2));
    const card = screen.getAllByTestId('draft-card')[0]!;
    fireEvent.click(within(card).getByTestId('draft-edit-open'));
    fireEvent.change(within(card).getByTestId('draft-edit-question'), {
      target: { value: 'Galata Kulesi kaç yılında yapılmıştır?' },
    });
    fireEvent.change(within(card).getByTestId('draft-edit-option-2'), {
      target: { value: '1500' },
    });
    fireEvent.click(within(card).getByTestId('draft-edit-save'));
    await waitFor(() =>
      expect(screen.getAllByTestId('draft-question')[0]!.textContent).toBe(
        'Galata Kulesi kaç yılında yapılmıştır?',
      ),
    );
    const saved = calls.find(
      (c) => c.method === 'POST' && c.path.endsWith(`/drafts/${items[0]!.id}`),
    )!;
    expect(saved.body).toMatchObject({
      options: ['1204', '1348', '1500', '1520'],
      correctIndex: 1,
    });
    expect(saved.body).not.toHaveProperty('sourceQuote');
    fireEvent.click(
      within(screen.getAllByTestId('draft-card')[1] ?? card).getByTestId('draft-delete'),
    );
    await waitFor(() => expect(screen.getAllByTestId('draft-card')).toHaveLength(1));
  });

  it.each([
    [422, 'INVALID_MESSAGE', { reason: 'pdf_encrypted' }, 'Bu PDF şifreli, açılamadı.'],
    [422, 'INVALID_MESSAGE', { reason: 'no_text' }, 'Belgede soru yapılacak kadar metin yok.'],
    [422, 'INVALID_MESSAGE', { reason: 'too_big' }, 'Dosya çok büyük (en fazla 10 MB).'],
    [
      429,
      'RATE_LIMITED',
      { reason: 'quota', limit: 5 },
      'Bugünkü belge hakkınız doldu. Yarın tekrar deneyin ya da soruları elle yazın.',
    ],
    [
      409,
      'INVALID_STATE',
      { reason: 'same_file' },
      'Bu belgeden hazırlanan taslaklar zaten aşağıda bekliyor. Önce onları onaylayın ya da silin.',
    ],
  ])('says it in plain Turkish: %s %s', async (status, code, params, message) => {
    network((call) => {
      if (call.path.endsWith('/authoring') && call.method === 'GET') return { json: STATE };
      if (call.path.endsWith('/authoring/drafts')) return { json: { items: [] } };
      if (call.path.endsWith('/authoring/runs'))
        return { status, json: { error: { code, params } } };
      return undefined;
    });
    wrap(<DocumentAuthoring venueId={VENUE} />);
    await screen.findByTestId('authoring-quota');
    pick('belge.pdf');
    fireEvent.click(screen.getByTestId('authoring-start'));
    await waitFor(() => expect(screen.getByTestId('authoring-error').textContent).toBe(message));
    expect(screen.queryByTestId('authoring-progress')).toBeNull();
  });

  it('shows the failure of a run and the empty result, and blocks starting when the quota is used', async () => {
    network((call) => {
      if (call.path.endsWith('/authoring') && call.method === 'GET')
        return { json: { ...STATE, quota: { limit: 2, used: 2, resetAt: null } } };
      if (call.path.endsWith('/authoring/drafts')) return { json: { items: [] } };
      return undefined;
    });
    wrap(<DocumentAuthoring venueId={VENUE} />);
    await screen.findByTestId('authoring-quota');
    pick();
    expect(screen.getByTestId<HTMLButtonElement>('authoring-start').disabled).toBe(true);
    expect(screen.getByTestId('authoring-nodrafts').textContent).toBe('Onay bekleyen taslak yok.');
  });

  it('shows the model service being unreachable as a calm sentence', async () => {
    network((call) => {
      if (call.path.endsWith('/authoring') && call.method === 'GET') return { json: STATE };
      if (call.path.endsWith('/authoring/drafts')) return { json: { items: [] } };
      if (call.path.endsWith('/authoring/runs') && call.method === 'POST')
        return { status: 202, json: { runId: 'r2' } };
      if (call.path.endsWith('/authoring/runs/r2'))
        return {
          json: {
            id: 'r2',
            status: 'FAILED',
            failure: 'unavailable',
            fileName: 'a',
            drafts: 0,
            discarded: 0,
          },
        };
      return undefined;
    });
    wrap(<DocumentAuthoring venueId={VENUE} pollMs={10} />);
    await screen.findByTestId('authoring-quota');
    pick();
    fireEvent.click(screen.getByTestId('authoring-start'));
    await waitFor(() =>
      expect(screen.getByTestId('authoring-error').textContent).toMatch(/hakkınızdan düşmedi/u),
    );
  });
});
