import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { StaffPage } from './StaffPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const VENUE = '11111111-1111-4111-8111-111111111111';
const account = { id: 'a1', email: 'sahip@kafe.test', roles: [], sessionKind: 'WEB' };

const card = (n: number, text = `Soru ${n}`) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  text,
  explanation: n === 1 ? 'Çünkü böyle oldu.' : null,
  status: 'ACTIVE',
  difficulty: 'MEDIUM',
  category: 'Tarih',
  options: [
    { text: `Yanlış ${n}`, correct: false },
    { text: `Doğru ${n}`, correct: true },
    { text: `Hatalı ${n}`, correct: false },
    { text: `Olmaz ${n}`, correct: false },
  ],
});

function network(role: 'OWNER' | 'STAFF') {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => {
      urls.push(path);
      const json = (value: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(value), { status }));
      if (path === '/v1/me') return json({ account });
      if (path === '/v1/venue/me') return json({ venues: [{ id: VENUE, name: 'Kafe', role }] });
      if (path.includes('/bank/categories'))
        return json({ categories: [{ id: 'tarih', label: 'Tarih', count: 30 }] });
      if (path.includes('/bank/questions')) {
        const offset = Number(new URL(path, 'http://x').searchParams.get('offset'));
        return json(
          offset === 0
            ? {
                total: 14,
                hasMore: true,
                items: [card(1, '<script>window.__pwned=1</script> Fatih kimdir?'), card(2)],
              }
            : { total: 14, hasMore: false, items: [card(3)] },
        );
      }
      if (path.endsWith('/settings'))
        return json({ settings: { questions: { source: 'MIXED', venueSharePercent: 30 } }, role });
      if (path.endsWith('/sessions'))
        return json({ serverTime: Date.now(), items: [], role, steps: [15], defaultMinutes: 60 });
      if (path.endsWith('/questions'))
        return json({
          role,
          canManage: role === 'OWNER',
          limits: { maxBytes: 1, maxRows: 1, maxQuestions: 1, maxCategories: 1 },
          totals: { active: 0, review: 0, retired: 0 },
          uploads: [],
          categories: [],
        });
      return json({ error: { code: 'NOT_FOUND' } }, 404);
    }),
  );
  return urls;
}

const mount = () =>
  render(
    <I18nProvider locale="tr">
      <StaffPage />
    </I18nProvider>,
  );

describe('the owner’s answers view (ADR-0030 §5)', () => {
  it('shows cards with every option, the correct one marked, and the text as plain text', async () => {
    const urls = network('OWNER');
    mount();
    await waitFor(() => screen.getByTestId('staff-tab-questions'));
    fireEvent.click(screen.getByTestId('staff-tab-questions'));
    fireEvent.click(await screen.findByTestId('questions-view-bank'));
    const cards = await screen.findAllByTestId('answer-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Fatih kimdir?');
    expect(cards[0]!.textContent).toContain('Çünkü böyle oldu.');
    expect(cards[0]!.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    const options = cards[0]!.querySelectorAll('li[data-correct]');
    expect([...options].map((option) => option.getAttribute('data-correct'))).toEqual([
      '0',
      '1',
      '0',
      '0',
    ]);
    expect(cards[0]!.querySelector('li[data-correct="1"]')!.textContent).toContain('Doğru 1');
    expect(screen.getByTestId('answers-total').textContent).toBe('14 soru');
    expect(urls.some((url) => url.includes('scope=GLOBAL'))).toBe(true);
  });

  it('shows the venue’s own questions under the other tab and pages with "Daha fazla"', async () => {
    const urls = network('OWNER');
    mount();
    await waitFor(() => screen.getByTestId('staff-tab-questions'));
    fireEvent.click(screen.getByTestId('staff-tab-questions'));
    fireEvent.click(await screen.findByTestId('questions-view-venue'));
    await screen.findAllByTestId('answer-card');
    expect(urls.some((url) => url.includes('scope=VENUE'))).toBe(true);
    fireEvent.click(screen.getByTestId('answers-more'));
    await waitFor(() => expect(screen.getAllByTestId('answer-card')).toHaveLength(3));
    expect(screen.queryByTestId('answers-more')).toBeNull();
  });

  it('waits for the typing to stop, then searches and filters by topic', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const urls = network('OWNER');
    mount();
    await waitFor(() => screen.getByTestId('staff-tab-questions'));
    fireEvent.click(screen.getByTestId('staff-tab-questions'));
    fireEvent.click(await screen.findByTestId('questions-view-bank'));
    await screen.findAllByTestId('answer-card');
    const before = urls.filter((url) => url.includes('/bank/questions')).length;
    fireEvent.change(screen.getByTestId('answers-search'), { target: { value: 'fa' } });
    fireEvent.change(screen.getByTestId('answers-search'), { target: { value: 'fatih' } });
    expect(urls.filter((url) => url.includes('/bank/questions')).length).toBe(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await waitFor(() => expect(urls.some((url) => url.includes('q=fatih'))).toBe(true));
    expect(urls.some((url) => url.includes('q=fa&'))).toBe(false);
    await waitFor(() => screen.getByRole('option', { name: /Tarih \(30\)/u }));
    fireEvent.change(screen.getByTestId('answers-category'), { target: { value: 'tarih' } });
    await waitFor(() => expect(urls.some((url) => url.includes('category=tarih'))).toBe(true));
  });

  it('is not offered to staff: no answers tabs and no bank call', async () => {
    const urls = network('STAFF');
    mount();
    await waitFor(() => screen.getByTestId('staff-tab-questions'));
    fireEvent.click(screen.getByTestId('staff-tab-questions'));
    await waitFor(() => screen.getByTestId('vq-totals'));
    expect(screen.queryByTestId('questions-view-bank')).toBeNull();
    expect(screen.queryByTestId('questions-view-venue')).toBeNull();
    expect(urls.some((url) => url.includes('/bank/'))).toBe(false);
  });
});
