import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { player, roomView } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { TeamBadge } from '../ui/TeamBadge';
import { setTeamLogos } from '../ui/TeamMark';
import { BrandLogo } from './BrandLogo';
import { PhoneBrand } from './EntranceLine';
import { LogoField } from './LogoField';
import { PanelProvider } from './PanelStore';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setTeamLogos(undefined);
});

const VENUE = '11111111-1111-4111-8111-111111111111';
const HASH = 'c'.repeat(64);
const PATH = `/v1/venue-assets/${VENUE}/${HASH}`;
const meter = { state: 'RUNNING' as const, endsAt: 9_999_999_999_999, remainingMs: 0 };
const wrap = (node: React.ReactNode) => render(<I18nProvider locale="tr">{node}</I18nProvider>);

describe('the venue’s own marks on a table’s screens (ADR-0030)', () => {
  it('replaces the animal of a team with the venue’s logo for that slot only', () => {
    act(() => setTeamLogos([PATH]));
    wrap(
      <>
        <TeamBadge teamId="tiger" settings={{}} />
        <TeamBadge teamId="owl" settings={{}} />
      </>,
    );
    expect(screen.getByTestId('team-badge-tiger').querySelector(`img[src="${PATH}"]`)).toBeTruthy();
    expect(screen.getByTestId('team-logo-tiger')).toBeTruthy();
    expect(screen.queryByTestId('team-logo-owl')).toBeNull();
    expect(screen.getByTestId('team-badge-owl').querySelector('img')).toBeTruthy(); // the default animal
  });

  it('shows the venue’s own logo, or none: the bundled brand never fills in for a venue table', () => {
    const own = roomView({
      players: [player(0)],
      venue: {
        ...meter,
        look: { name: 'Çınar Kafe', theme: 'gusto' },
        branding: { logo: PATH },
      },
    });
    const { container, rerender } = wrap(<BrandLogo room={own} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(PATH);
    rerender(
      <I18nProvider locale="tr">
        <BrandLogo
          room={{ ...own, venue: { ...meter, look: { name: 'Çınar Kafe', theme: 'gusto' } } }}
        />
      </I18nProvider>,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('writes the café’s name on the phone lobby as text', () => {
    wrap(
      <PhoneBrand
        room={roomView({
          venue: { ...meter, look: { name: '<b>Çınar</b>', theme: 'party' } },
        })}
      />,
    );
    expect(screen.getByTestId('ctl-brand').textContent).toBe('<b>Çınar</b>');
    expect(screen.getByTestId('ctl-brand').querySelector('b')).toBeNull();
  });
});

describe('the logo field', () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  function network(upload: (body: unknown) => Response): void {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
        calls.push({ path, method: init?.method ?? 'GET', body });
        if (path.endsWith('/assets') && init?.method === 'POST')
          return Promise.resolve(upload(body));
        return Promise.resolve(new Response(JSON.stringify({ settings: {} }), { status: 200 }));
      }),
    );
  }

  const mount = (onChange: (hash: string | null) => void) =>
    wrap(
      <PanelProvider venueId={VENUE}>
        <LogoField kind="LOGO" label="Logo" hint="" hash={null} onChange={onChange} testId="logo" />
      </PanelProvider>,
    );
  const file = (type: string, size = 200, name = 'x') =>
    new File([new Uint8Array(size)], name, { type });
  const choose = (picked: File) =>
    fireEvent.change(screen.getByTestId('logo-file'), { target: { files: [picked] } });

  it('uploads a PNG as base64 without a file name and hands the hash to the form', async () => {
    network(() =>
      Response.json(
        { asset: { hash: HASH, contentType: 'image/png', width: 300, height: 100, bytes: 200 } },
        { status: 201 },
      ),
    );
    const onChange = vi.fn();
    mount(onChange);
    choose(file('image/png', 200, 'logo.png'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(HASH));
    const upload = calls.find((call) => call.method === 'POST')!;
    expect(upload.body).toEqual({ kind: 'LOGO', data: expect.any(String) as string });
    expect(JSON.stringify(upload.body)).not.toContain('logo.png');
  });

  it('says plainly why an SVG or a big file is not taken, without asking the server', async () => {
    network(() => Response.json({}, { status: 500 }));
    mount(vi.fn());
    choose(file('image/svg+xml'));
    expect((await screen.findByTestId('logo-error')).textContent).toMatch(/PNG, WebP ya da JPG/u);
    choose(file('image/png', 400 * 1024));
    await waitFor(() => expect(screen.getByTestId('logo-error').textContent).toMatch(/300 KB/u));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('turns the server’s refusal into a plain sentence', async () => {
    network(() =>
      Response.json(
        { error: { code: 'IMAGE_REJECTED', params: { reason: 'DIMENSIONS' } } },
        {
          status: 400,
        },
      ),
    );
    mount(vi.fn());
    choose(file('image/png'));
    expect((await screen.findByTestId('logo-error')).textContent).toMatch(/boyutu uygun değil/u);
  });
});
