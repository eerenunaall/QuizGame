import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { VenueQuestions } from './VenueQuestions';

/** The owner's questions tab (ADR-0025): the dry-run in plain Turkish, the import, and safe rendering. */
const summary = (canManage: boolean) => ({
  role: canManage ? 'OWNER' : 'STAFF',
  canManage,
  uploads: [],
  totals: { active: 12, review: 1, retired: 0, max: 5000 },
  categories: [{ id: 'tarih', label: 'Tarih', active: 12 }],
});
const analysis = (over: Record<string, unknown> = {}) => ({
  ok: true,
  fileName: 'yapistirilan.csv',
  warnings: [],
  alreadyImported: null,
  counts: { total: 3, ok: 1, review: 0, reject: 0, invalid: 1, duplicate: 1, full: 0 },
  categories: [{ id: 'v-kutu', label: 'Kutu Oyunları', isNew: true, count: 1 }],
  rows: [
    {
      line: 3,
      status: 'INVALID',
      preview: 'kısa',
      category: 'Tarih',
      issues: [{ field: 'question', code: 'question_too_short', params: { min: 10 } }],
    },
    {
      line: 4,
      status: 'DUPLICATE',
      preview: 'Bu zaten var mı?',
      category: 'Tarih',
      issues: [{ field: '', code: 'duplicate' }],
    },
  ],
  rowsOmitted: 0,
  sample: [
    {
      line: 2,
      status: 'OK',
      preview: '<script>alert(1)</script> Hangisi?',
      category: 'Kutu Oyunları',
      issues: [],
    },
  ],
  batch: [],
  ...over,
});

const calls: { method: string; path: string; body: unknown }[] = [];
function network(owner: boolean, answers: Record<string, unknown> = {}) {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const key = `${method} ${path.replace(/^\/v1\/venues\/[^/]+\/questions/u, '')}`;
      const json =
        answers[key] ??
        (path.endsWith('/settings')
          ? { settings: { questions: { source: 'MIXED', venueSharePercent: 30 } } }
          : undefined) ??
        (key === 'GET ' ? summary(owner) : key === 'GET /reports' ? { items: [] } : { ok: true });
      return Promise.resolve(new Response(JSON.stringify(json), { status: 200 }));
    }),
  );
}
const show = (role: 'OWNER' | 'STAFF', locale: 'tr' | 'en' = 'tr') =>
  render(
    <I18nProvider locale={locale}>
      <VenueQuestions venueId="11111111-1111-4111-8111-111111111111" role={role} />
    </I18nProvider>,
  );
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('staff', () => {
  it('see the counts and no way to upload', async () => {
    network(false);
    show('STAFF');
    await screen.findByTestId('vq-totals');
    expect(screen.getByTestId('vq-totals').textContent).toContain('12 soru yayında');
    expect(screen.getByText(/yalnızca kafe sahibi yapabilir/u)).toBeTruthy();
    expect(screen.queryByTestId('vq-upload')).toBeNull();
    expect(calls.map((c) => c.path)).toEqual([
      '/v1/venues/11111111-1111-4111-8111-111111111111/questions',
    ]);
  });
});

describe('owner', () => {
  it('pastes a file, reads the dry-run in Turkish, then imports', async () => {
    network(true, {
      'POST /dry-run': analysis(),
      'POST /import': { analysis: analysis(), uploadId: 'u1', imported: 1 },
    });
    show('OWNER');
    const paste = await screen.findByTestId('vq-paste');
    fireEvent.change(paste, { target: { value: 'category,difficulty,question\nTarih,EASY,kısa' } });
    fireEvent.click(screen.getByTestId('vq-check'));
    await screen.findByTestId('vq-report');
    expect(screen.getByTestId('vq-row-3').textContent).toContain(
      'Soru çok kısa (en az 10 karakter)',
    );
    expect(screen.getByTestId('vq-row-4').textContent).toContain('Bu soru zaten var');
    expect(screen.getByTestId('vq-counts').textContent).toContain('1 soru yayına girecek');
    const dry = calls.find((c) => c.path.endsWith('/dry-run'))!;
    expect(dry.body).toMatchObject({ fileName: 'yapistirilan.csv' });
    expect(atob((dry.body as { data: string }).data)).toContain('Tarih,EASY');

    fireEvent.click(screen.getByTestId('vq-import'));
    await screen.findByTestId('vq-done');
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/import'))).toBe(true);
  });

  it('shows a refusal of the whole file as a sentence with the fix', async () => {
    network(true, { 'POST /dry-run': { ok: false, issue: { field: '', code: 'file_excel' } } });
    show('OWNER');
    fireEvent.change(await screen.findByTestId('vq-paste'), { target: { value: 'PK' } });
    fireEvent.click(screen.getByTestId('vq-check'));
    expect((await screen.findByTestId('vq-file-error')).textContent).toContain('CSV UTF-8');
  });

  it('renders a script-looking question as text, never as markup', async () => {
    network(true, { 'POST /dry-run': analysis() });
    const { container } = show('OWNER');
    fireEvent.change(await screen.findByTestId('vq-paste'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('vq-check'));
    const sample = await screen.findByTestId('vq-sample');
    expect(sample.textContent).toContain('<script>alert(1)</script> Hangisi?');
    expect(container.querySelector('script')).toBeNull();
    expect(sample.querySelector('*:not(li):not(span)')).toBeNull();
  });

  it('says an already uploaded file changed nothing', async () => {
    network(true, {
      'POST /dry-run': analysis({
        alreadyImported: { uploadId: 'u', uploadedAt: '2026-10-20T10:00:00Z', imported: 6 },
      }),
    });
    show('OWNER');
    fireEvent.change(await screen.findByTestId('vq-paste'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('vq-check'));
    await waitFor(() =>
      expect(screen.getByTestId('vq-already').textContent).toContain('zaten yüklenmiş'),
    );
  });

  it('works in English too', async () => {
    network(true, { 'POST /dry-run': analysis() });
    show('OWNER', 'en');
    fireEvent.change(await screen.findByTestId('vq-paste'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('vq-check'));
    expect((await screen.findByTestId('vq-row-3')).textContent).toContain(
      'The question is too short',
    );
  });
});
