import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogs } from '@quizparty/i18n';
import { I18nProvider } from '../lib/i18n';
import type { VenueSettingsView } from './api';
import { StaffPage } from './StaffPage';
import { TABS, tabsFor } from './tabs';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const account = { id: 'a1', email: 'sahip@kafe.test', roles: [], sessionKind: 'WEB' };
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function settingsOf(over: Partial<VenueSettingsView> = {}): VenueSettingsView {
  return {
    entrance: { enabled: false, text: '', note: '' },
    look: { theme: 'gusto', accent: null, logo: null, teamLogos: [] },
    reward: { enabled: false, text: '', minPlayers: 3, maxPerDay: 10, rematchCooldownMinutes: 5 },
    play: {
      defaultMode: 'INDIVIDUAL',
      simpleRuleset: false,
      teamNames: [],
      simpleAnswerSeconds: null,
    },
    defaultMinutes: 60,
    extendSteps: [15, 30, 60],
    timezone: 'Europe/Istanbul',
    ...over,
  };
}

/** The server's wire: sessions, settings (merged like the real merge) and an empty staff list. */
function server(
  venue: { id: string; name: string; role: 'OWNER' | 'STAFF' },
  initial: VenueSettingsView,
) {
  const calls: Call[] = [];
  let settings = initial;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path, body });
      const json = (value: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(value), { status }));
      if (path === '/v1/me') return json({ account });
      if (path === '/v1/venue/me') return json({ venues: [venue] });
      if (path.endsWith('/sessions') && method === 'GET')
        return json({
          serverTime: Date.now(),
          items: [],
          role: venue.role,
          steps: [15],
          defaultMinutes: 60,
        });
      if (path.endsWith('/settings') && method === 'GET')
        return json({ settings, role: venue.role });
      if (path.endsWith('/settings') && method === 'POST') {
        const merged = { ...settings } as Record<string, unknown>;
        for (const [key, value] of Object.entries(body ?? {})) {
          const old = (settings as unknown as Record<string, unknown>)[key];
          merged[key] =
            value && typeof value === 'object' && !Array.isArray(value)
              ? { ...(old as object), ...value }
              : value;
        }
        const reward = merged['reward'] as VenueSettingsView['reward'];
        const entrance = merged['entrance'] as NonNullable<VenueSettingsView['entrance']>;
        if ((reward.enabled && reward.text === '') || (entrance.enabled && entrance.text === ''))
          return json({ error: { code: 'INVALID_MESSAGE' } }, 400);
        settings = merged as unknown as VenueSettingsView;
        return json({ settings });
      }
      if (path.endsWith('/staff')) return json({ staff: [] });
      return json({ error: { code: 'NOT_FOUND' } }, 404);
    }),
  );
  return calls;
}

const mount = () =>
  render(
    <I18nProvider locale="tr">
      <StaffPage />
    </I18nProvider>,
  );

const OWNER = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Kafe Bir',
  role: 'OWNER' as const,
};
const STAFF = { ...OWNER, role: 'STAFF' as const };

beforeEach(() => {
  window.history.replaceState(null, '', '/staff');
});

describe('the panel sections', () => {
  it('has one TABS list: staff get the desk, the owner gets every section', async () => {
    expect(tabsFor('STAFF').map((tab) => tab.id)).toEqual([
      'tables',
      'new',
      'redeem',
      'displays',
      'questions',
    ]);
    expect(tabsFor('OWNER')).toHaveLength(TABS.length);
    server(STAFF, settingsOf());
    mount();
    await waitFor(() => expect(screen.getByTestId('panel-tabs')).toBeTruthy());
    expect(screen.getByTestId('panel-tabs').querySelectorAll('button')).toHaveLength(5);
    expect(screen.queryByTestId('staff-tab-reward')).toBeNull();
    expect(screen.queryByTestId('staff-tab-look')).toBeNull();
  });

  it('names every tab in Turkish and in English', () => {
    for (const tab of TABS)
      for (const locale of ['tr', 'en'] as const)
        expect(catalogs[locale][tab.label], `${locale} ${tab.id}`).toBeTruthy();
  });

  it('opens every owner section without a crash', async () => {
    server(OWNER, settingsOf());
    mount();
    await waitFor(() => expect(screen.getByTestId('panel-tabs')).toBeTruthy());
    for (const tab of TABS) {
      fireEvent.click(screen.getByTestId(`staff-tab-${tab.id}`));
      await waitFor(() =>
        expect(screen.getByTestId(`staff-tab-${tab.id}`).getAttribute('aria-current')).toBe('page'),
      );
    }
  });
});

describe('prize form', () => {
  it('explains a missing text inline, previews the winner card live and saves one section', async () => {
    const calls = server(OWNER, settingsOf());
    mount();
    await waitFor(() => screen.getByTestId('staff-tab-reward'));
    fireEvent.click(screen.getByTestId('staff-tab-reward'));
    await waitFor(() => screen.getByTestId('staff-settings-reward'));
    fireEvent.click(screen.getByTestId('staff-settings-reward'));
    expect(screen.getByTestId('panel-reward-error').textContent).toMatch(/ne olduğunu yazmalısın/u);
    expect(screen.getByTestId<HTMLButtonElement>('panel-save-reward').disabled).toBe(true);

    fireEvent.change(screen.getByTestId('staff-settings-reward-text'), {
      target: { value: 'Bir türk kahvesi bizden' },
    });
    expect(screen.queryByTestId('panel-reward-error')).toBeNull();
    expect(screen.getByTestId('panel-reward-preview').textContent).toContain(
      'Bir türk kahvesi bizden',
    );

    fireEvent.click(screen.getByTestId('panel-save-reward'));
    await waitFor(() =>
      expect(screen.getByTestId('panel-toast').textContent).toContain('Kaydedildi'),
    );
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/settings'))!;
    expect(post.body).toEqual({
      reward: {
        enabled: true,
        text: 'Bir türk kahvesi bizden',
        minPlayers: 3,
        maxPerDay: 10,
        rematchCooldownMinutes: 5,
      },
    });
  });

  it('undoes a save from the toast', async () => {
    const calls = server(
      OWNER,
      settingsOf({ entrance: { enabled: true, text: '100 TL', note: '' } }),
    );
    mount();
    await waitFor(() => screen.getByTestId('staff-tab-entrance'));
    fireEvent.click(screen.getByTestId('staff-tab-entrance'));
    await waitFor(() => screen.getByTestId('panel-entrance-text'));
    fireEvent.change(screen.getByTestId('panel-entrance-text'), {
      target: { value: '150 TL, içecek dahil' },
    });
    expect(screen.getByTestId('panel-entrance-preview').textContent).toContain(
      '150 TL, içecek dahil',
    );
    fireEvent.click(screen.getByTestId('panel-save-entrance'));
    await waitFor(() => screen.getByTestId('panel-undo'));
    fireEvent.click(screen.getByTestId('panel-undo'));
    await waitFor(() =>
      expect(screen.getByTestId('panel-toast').textContent).toContain('Eski haline'),
    );
    const posts = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/settings'));
    expect(posts[1]!.body).toEqual({ entrance: { enabled: true, text: '100 TL', note: '' } });
  });
});

describe('entrance form', () => {
  it('counts characters, refuses an empty line and never sends a price field', async () => {
    const calls = server(OWNER, settingsOf());
    mount();
    await waitFor(() => screen.getByTestId('staff-tab-entrance'));
    fireEvent.click(screen.getByTestId('staff-tab-entrance'));
    await waitFor(() => screen.getByTestId('panel-entrance-on'));
    fireEvent.click(screen.getByTestId('panel-entrance-on'));
    expect(screen.getByTestId('panel-entrance-error')).toBeTruthy();
    fireEvent.change(screen.getByTestId('panel-entrance-text'), { target: { value: '150 TL' } });
    expect(screen.getByText('6 / 40')).toBeTruthy();
    fireEvent.click(screen.getByTestId('panel-save-entrance'));
    await waitFor(() => screen.getByTestId('panel-toast'));
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/settings'))!;
    expect(post.body).toEqual({ entrance: { enabled: true, text: '150 TL', note: '' } });
  });
});

describe('look form', () => {
  it('previews the TV and phone, applies the draft theme to the page and restores it on leaving', async () => {
    server(OWNER, settingsOf());
    mount();
    await waitFor(() => screen.getByTestId('staff-tab-look'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('gusto'));
    fireEvent.click(screen.getByTestId('staff-tab-look'));
    await waitFor(() => screen.getByTestId('look-preview-tv'));
    expect(screen.getByTestId('look-preview-phone')).toBeTruthy();
    fireEvent.click(screen.getByTestId('look-theme-party'));
    fireEvent.click(screen.getByTestId('look-accent-mint'));
    expect(document.documentElement.dataset.theme).toBe('party');
    expect(document.documentElement.style.getPropertyValue('--qp-color-accent-a')).toBe('#3ddc97');
    fireEvent.click(screen.getByTestId('staff-tab-tables'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('gusto'));
    expect(document.documentElement.style.getPropertyValue('--qp-color-accent-a')).toBe('');
  });

  it('refuses two teams with the same name before it asks the server', async () => {
    server(OWNER, settingsOf());
    mount();
    await waitFor(() => screen.getByTestId('staff-tab-look'));
    fireEvent.click(screen.getByTestId('staff-tab-look'));
    await waitFor(() => screen.getByTestId('staff-play-name-0'));
    fireEvent.change(screen.getByTestId('staff-play-name-0'), { target: { value: 'Aslanlar' } });
    fireEvent.change(screen.getByTestId('staff-play-name-1'), { target: { value: 'aslanlar' } });
    expect(screen.getByTestId<HTMLButtonElement>('panel-save-look').disabled).toBe(true);
  });
});

describe('late timers', () => {
  it('does not pull the person back to Masalar when the table opened and they moved on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = server(OWNER, settingsOf());
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) =>
      path.endsWith('/sessions') && init?.method === 'POST'
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                id: 's',
                roomCode: 'ABC234',
                state: 'RUNNING',
                purchasedMinutes: 60,
              }),
              { status: 201 },
            ),
          )
        : base(path, init),
    );
    mount();
    await waitFor(() => screen.getByTestId('staff-tab-new'));
    fireEvent.click(screen.getByTestId('staff-tab-new'));
    await waitFor(() => screen.getByTestId('staff-new-code'));
    fireEvent.change(screen.getByTestId('staff-new-code'), { target: { value: 'ABC234' } });
    fireEvent.click(screen.getByTestId('staff-new-open'));
    await waitFor(() => screen.getByTestId('staff-new-result'));
    // the person leaves for another tab before the 1.2 s hand-over fires
    fireEvent.click(screen.getByTestId('staff-tab-redeem'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId('staff-tab-redeem').getAttribute('aria-current')).toBe('page');
    expect(screen.queryByTestId('staff-tables')).toBeNull();
    expect(calls.length).toBeGreaterThan(0);
  });
});

/** What a person can read or see: all text plus every image address (test ids and theme ids are not brand). */
const visible = (): string =>
  [
    document.body.textContent ?? '',
    ...[...document.images].map((image) => image.getAttribute('src') ?? ''),
  ].join('\n');

describe('white label (ADR-0030 §3)', () => {
  const venueA = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Gusto Board Game',
    role: 'OWNER' as const,
  };
  const venueB = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Çınar Kafe',
    role: 'OWNER' as const,
  };

  it('dresses each venue from its own settings and leaks nothing of the other', async () => {
    server(
      venueA,
      settingsOf({ look: { theme: 'gusto', accent: 'gold', logo: HASH_A, teamLogos: [HASH_A] } }),
    );
    const first = mount();
    await waitFor(() => screen.getByTestId('panel-logo'));
    expect(document.documentElement.dataset.theme).toBe('gusto');
    expect(screen.getByTestId('panel-logo').getAttribute('src')).toBe(
      `/v1/venue-assets/${venueA.id}/${HASH_A}`,
    );
    expect(screen.getByTestId('staff-venue').textContent).toBe('Gusto Board Game');
    first.unmount();
    cleanup();
    document.documentElement.removeAttribute('style');

    server(
      venueB,
      settingsOf({ look: { theme: 'party', accent: 'coral', logo: HASH_B, teamLogos: [] } }),
    );
    mount();
    await waitFor(() => screen.getByTestId('panel-logo'));
    expect(document.documentElement.dataset.theme).toBe('party');
    expect(document.documentElement.style.getPropertyValue('--qp-color-accent-a')).toBe('#ff7a66');
    expect(visible()).not.toMatch(/gusto/iu);
    expect(visible()).not.toContain(HASH_A);
    expect(visible()).not.toContain(venueA.id);
    expect(screen.getByTestId('panel-logo').getAttribute('src')).toBe(
      `/v1/venue-assets/${venueB.id}/${HASH_B}`,
    );
    // every owner section, too: no built-in brand text or image in any of them
    for (const tab of TABS) {
      fireEvent.click(screen.getByTestId(`staff-tab-${tab.id}`));
      await waitFor(() =>
        expect(screen.getByTestId(`staff-tab-${tab.id}`).getAttribute('aria-current')).toBe('page'),
      );
      expect(visible(), tab.id).not.toMatch(/gusto/iu);
    }
  });
});
