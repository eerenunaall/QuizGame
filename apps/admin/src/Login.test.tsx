import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Login } from './pages/Login';
import { fakeServer } from './testing';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const account = { id: 'a1', email: 'ed@example.test', roles: ['EDITOR'] };

describe('staff sign-in', () => {
  it('asks for the code, then signs in as an ADMIN client', async () => {
    const server = fakeServer((call) => {
      if (call.path === '/v1/auth/email/request') return { status: 202, json: { ok: true } };
      if (call.path === '/v1/auth/email/verify') return { json: { account } };
      return undefined;
    });
    const signedIn = vi.fn();
    render(<Login expired={false} onSignedIn={signedIn} />);
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'ed@example.test' } });
    fireEvent.click(screen.getByTestId('login-send'));
    await waitFor(() => expect(screen.getByTestId('login-code')).toBeTruthy());
    fireEvent.change(screen.getByTestId('login-code'), { target: { value: '12ab34' } });
    expect(screen.getByTestId<HTMLInputElement>('login-code').value).toBe('1234'); // digits only
    fireEvent.change(screen.getByTestId('login-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('login-verify'));
    await waitFor(() => expect(signedIn).toHaveBeenCalledWith(account));
    const verify = server.calls.find((c) => c.path === '/v1/auth/email/verify')!;
    expect(verify.body).toEqual({ email: 'ed@example.test', code: '123456', client: 'ADMIN' });
  });

  it('says plainly when the account is not staff or the code is wrong, without detail', async () => {
    fakeServer((call) => {
      if (call.path === '/v1/auth/email/request') return { status: 202, json: { ok: true } };
      const body = call.body as { code: string };
      return body.code === '000000'
        ? { status: 403, json: { error: { code: 'FORBIDDEN' } } }
        : { status: 401, json: { error: { code: 'UNAUTHORIZED' } } };
    });
    render(<Login expired onSignedIn={vi.fn()} />);
    expect(screen.getByText(/Oturumun sona erdi/u)).toBeTruthy();
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'x@example.test' } });
    fireEvent.click(screen.getByTestId('login-send'));
    await waitFor(() => screen.getByTestId('login-code'));
    fireEvent.change(screen.getByTestId('login-code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByTestId('login-verify'));
    await waitFor(() => expect(screen.getByTestId('error').textContent).toMatch(/yetkisi yok/u));
    fireEvent.change(screen.getByTestId('login-code'), { target: { value: '111111' } });
    fireEvent.click(screen.getByTestId('login-verify'));
    await waitFor(() => expect(screen.getByTestId('error').textContent).toMatch(/doğru değil/u));
  });
});
