import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionDetail } from './pages/QuestionDetail';
import { fakeServer, type Call } from './testing';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const detail = (status: string, revision = 3) => ({
  question: {
    id: 'q1',
    externalId: 'ext-1',
    revision,
    status,
    isDevSeed: false,
    language: 'tr',
    category: 'geography',
    subcategory: null,
    topic: null,
    difficulty: 'MEDIUM',
    pool: 'EVERGREEN',
    text: 'Nil Nehri hangi kıtada yer alır?',
    explanation: null,
    authorType: 'HUMAN',
    options: [
      { id: 'o1', position: 0, text: 'Afrika', correct: true, pickCount: 4 },
      { id: 'o2', position: 1, text: 'Asya', correct: false, pickCount: 1 },
    ],
    sources: [],
    expiresAt: null,
    lastVerifiedAt: null,
    updatedAt: '2026-01-01T00:00:00Z',
  },
  stats: { usageCount: 5, answerCount: 5, correctAnswerCount: 4, skipCount: 0 },
  findings: [{ code: 'SOURCE_MISSING', severity: 'REVIEW', dimension: 'factCheck' }],
  audits: [],
  statusLog: [],
  reports: [],
});

function serve(
  status: string,
  extra?: (call: Call) => ReturnType<Parameters<typeof fakeServer>[0]>,
) {
  return fakeServer((call) => {
    const custom = extra?.(call);
    if (custom) return custom;
    if (call.path === '/v1/admin/categories')
      return { json: { items: [{ id: 'geography', labelTr: 'Coğrafya' }] } };
    if (call.path === '/v1/admin/questions/q1' && call.method === 'GET')
      return { json: detail(status) };
    return { json: { ok: true } };
  });
}

describe('question detail', () => {
  it('shows findings and approves with every finding acknowledged', async () => {
    const server = serve('REVIEW');
    render(<QuestionDetail id="q1" />);
    await waitFor(() =>
      expect(screen.getByTestId('findings').textContent).toContain('SOURCE_MISSING'),
    );
    fireEvent.click(screen.getByTestId('waive-all'));
    fireEvent.click(screen.getByTestId('approve'));
    await waitFor(() => expect(server.calls.some((c) => c.path.endsWith('/approve'))).toBe(true));
    expect(server.calls.find((c) => c.path.endsWith('/approve'))!.body).toEqual({ waive: 'ALL' });
  });

  it('does not waive anything unless the box is ticked, and explains a blocked approval', async () => {
    const server = serve('REVIEW', (call) =>
      call.path.endsWith('/approve')
        ? {
            status: 409,
            json: { error: { code: 'BLOCKED', detail: { codes: ['SOURCE_MISSING'] } } },
          }
        : undefined,
    );
    render(<QuestionDetail id="q1" />);
    await waitFor(() => screen.getByTestId('approve'));
    fireEvent.click(screen.getByTestId('approve'));
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toContain('SOURCE_MISSING'),
    );
    expect(server.calls.find((c) => c.path.endsWith('/approve'))!.body).toEqual({ waive: [] });
  });

  it('needs a reason before rejecting or moving a question', async () => {
    serve('ACTIVE');
    render(<QuestionDetail id="q1" />);
    await waitFor(() => screen.getByTestId('retire'));
    expect(screen.getByTestId<HTMLButtonElement>('retire').disabled).toBe(true);
    fireEvent.change(screen.getByTestId('workflow-reason'), { target: { value: 'yanlış cevap' } });
    expect(screen.getByTestId<HTMLButtonElement>('retire').disabled).toBe(false);
  });

  it('saves edits against the revision that was loaded', async () => {
    const server = serve('REVIEW');
    render(<QuestionDetail id="q1" />);
    await waitFor(() => screen.getByTestId('edit-text'));
    fireEvent.change(screen.getByTestId('edit-text'), { target: { value: 'Yeni metin?' } });
    fireEvent.click(screen.getByTestId('edit-save'));
    await waitFor(() => expect(server.calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = server.calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>;
    expect(patch.expectedRevision).toBe(3);
    expect(patch.text).toBe('Yeni metin?');
    expect(patch.options).toEqual([
      { text: 'Afrika', correct: true },
      { text: 'Asya', correct: false },
    ]);
  });
});
