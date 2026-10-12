import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { UnlockPage } from './Unlock';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
type Answer = { status?: number; json?: unknown } | undefined;

/** The network only: answers speak the server's real wire shapes. */
function network(handler: (call: Call) => Answer): Call[] {
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

const mount = (locale: 'tr' | 'en' = 'en') =>
  render(
    <I18nProvider locale={locale}>
      <UnlockPage token="tok-AAAAAAAAAAAAAAAAAAAA" />
    </I18nProvider>,
  );
const account = { id: 'a1', email: 'buyer@example.test', roles: [], sessionKind: 'WEB' };

describe('the page behind the TV unlock QR code', () => {
  it('links the signed-in account to the room, sending the CSRF header', async () => {
    const calls = network((call) => {
      if (call.path === '/v1/me') return { json: { account } };
      if (call.path.endsWith('/claim')) return { json: { tier: 'FULL', roomCode: 'ABC234' } };
      if (call.path.startsWith('/v1/link-intents/'))
        return { json: { roomCode: 'ABC234', tier: 'FULL' } };
      return undefined;
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('unlock-claim')).toBeTruthy());
    expect(screen.getByText('Room ABC234')).toBeTruthy();
    fireEvent.click(screen.getByTestId('unlock-claim'));
    await waitFor(() => expect(screen.getByTestId('unlock-result').dataset.tier).toBe('FULL'));
    expect(screen.getByTestId('unlock-result').textContent).toMatch(/full game/iu);
    const claim = calls.find((c) => c.path.endsWith('/claim'))!;
    expect(claim.method).toBe('POST');
    expect(claim.headers['x-quizparty-csrf']).toBe('1');
  });

  it('says plainly that the account has no full game yet, and promises the room will open on purchase', async () => {
    network((call) => {
      if (call.path === '/v1/me') return { json: { account } };
      if (call.path.endsWith('/claim')) return { json: { tier: 'FREE', roomCode: 'ABC234' } };
      return { json: { roomCode: 'ABC234', tier: 'FREE' } };
    });
    mount();
    await waitFor(() => screen.getByTestId('unlock-claim'));
    fireEvent.click(screen.getByTestId('unlock-claim'));
    await waitFor(() => expect(screen.getByTestId('unlock-result').dataset.tier).toBe('FREE'));
    expect(screen.getByTestId('unlock-result').textContent).toMatch(/unlocks by itself/u);
  });

  it('signs in with an emailed code first (as a WEB client, never as staff), then offers the room', async () => {
    let signedIn = false;
    const calls = network((call) => {
      if (call.path === '/v1/me')
        return signedIn
          ? { json: { account } }
          : { status: 401, json: { error: { code: 'UNAUTHORIZED' } } };
      if (call.path === '/v1/auth/email/request') return { status: 202, json: { ok: true } };
      if (call.path === '/v1/auth/email/verify') {
        signedIn = true;
        return { json: { account } };
      }
      return { json: { roomCode: 'ABC234', tier: 'FREE' } };
    });
    mount();
    await waitFor(() => screen.getByTestId('unlock-email'));
    fireEvent.change(screen.getByTestId('unlock-email'), {
      target: { value: 'buyer@example.test' },
    });
    fireEvent.click(screen.getByTestId('unlock-send'));
    await waitFor(() => screen.getByTestId('unlock-code'));
    fireEvent.change(screen.getByTestId('unlock-code'), { target: { value: '12ab34' } });
    expect(screen.getByTestId<HTMLInputElement>('unlock-code').value).toBe('1234');
    fireEvent.change(screen.getByTestId('unlock-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('unlock-verify'));
    await waitFor(() => screen.getByTestId('unlock-claim'));
    const verify = calls.find((c) => c.path === '/v1/auth/email/verify')!;
    expect(verify.body).toEqual({ email: 'buyer@example.test', code: '123456', client: 'WEB' });
  });

  it('treats a staff console session as signed out and a dead link as one plain message', async () => {
    network((call) =>
      call.path === '/v1/me'
        ? { json: { account: { ...account, sessionKind: 'ADMIN' } } }
        : undefined,
    );
    mount();
    await waitFor(() => expect(screen.getByTestId('unlock-email')).toBeTruthy());
    cleanup();

    network((call) => (call.path === '/v1/me' ? { json: { account } } : undefined));
    mount('tr');
    await waitFor(() =>
      expect(screen.getByTestId('unlock-dead').textContent).toMatch(/artık geçerli değil/u),
    );
    expect(screen.queryByTestId('unlock-claim')).toBeNull();
  });

  it('turns a refused code into a message and keeps the form', async () => {
    network((call) => {
      if (call.path === '/v1/me') return { status: 401, json: { error: { code: 'UNAUTHORIZED' } } };
      if (call.path === '/v1/auth/email/request') return { status: 202, json: { ok: true } };
      return { status: 401, json: { error: { code: 'UNAUTHORIZED' } } };
    });
    mount();
    await waitFor(() => screen.getByTestId('unlock-email'));
    fireEvent.change(screen.getByTestId('unlock-email'), { target: { value: 'x@example.test' } });
    fireEvent.click(screen.getByTestId('unlock-send'));
    await waitFor(() => screen.getByTestId('unlock-code'));
    fireEvent.change(screen.getByTestId('unlock-code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByTestId('unlock-verify'));
    await waitFor(() =>
      expect(screen.getByTestId('unlock-error').textContent).toMatch(/wrong or has expired/u),
    );
    expect(screen.getByTestId('unlock-code')).toBeTruthy();
  });
});
