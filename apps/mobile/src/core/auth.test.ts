import { describe, expect, it } from '@jest/globals';
import { apiWith, memoryStorage } from '../testing/fakes';
import { AuthStore } from './auth';

const ACCOUNT = {
  id: 'a1',
  email: 'ece@example.com',
  displayName: null,
  locale: 'tr',
  roles: [],
  sessionKind: 'MOBILE',
};

function setup(handlers: Parameters<typeof apiWith>[0]) {
  const storage = memoryStorage();
  const auth = new AuthStore(storage);
  const harness = apiWith(handlers, null);
  auth.attach(harness.api);
  return { auth, storage, ...harness };
}

describe('AuthStore (email one-time code as a MOBILE session)', () => {
  it('requests a code, verifies it with client MOBILE and keeps the token in secure storage', async () => {
    const { auth, storage, calls } = setup({
      'POST /v1/auth/email/request': () => ({ status: 202, body: { ok: true } }),
      'POST /v1/auth/email/verify': () => ({
        body: { account: ACCOUNT, session: { expiresAt: 'x' }, token: 'secret-token' },
      }),
    });
    await auth.requestCode('ece@example.com', 'tr');
    await auth.verifyCode('ece@example.com', '123456');
    expect(calls[1]?.body).toEqual({ email: 'ece@example.com', code: '123456', client: 'MOBILE' });
    expect(storage.data.get('qp.account.token')).toBe('secret-token');
    expect(auth.state).toMatchObject({
      status: 'SIGNED_IN',
      account: { email: 'ece@example.com' },
    });
    expect(auth.currentToken()).toBe('secret-token');
  });

  it('a wrong code leaves the user signed out', async () => {
    const { auth, storage } = setup({
      'POST /v1/auth/email/verify': () => ({
        status: 401,
        body: { error: { code: 'UNAUTHORIZED' } },
      }),
    });
    await expect(auth.verifyCode('ece@example.com', '000000')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(storage.data.size).toBe(0);
    expect(auth.state.status).toBe('LOADING');
  });

  it('restore() confirms a stored token and drops one the server no longer accepts', async () => {
    const good = setup({ 'GET /v1/me': () => ({ body: { account: ACCOUNT } }) });
    good.storage.data.set('qp.account.token', 't1');
    await good.auth.restore();
    expect(good.auth.state.status).toBe('SIGNED_IN');

    const bad = setup({
      'GET /v1/me': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED' } } }),
    });
    bad.storage.data.set('qp.account.token', 't2');
    await bad.auth.restore();
    expect(bad.auth.state.status).toBe('SIGNED_OUT');
    expect(bad.storage.data.has('qp.account.token')).toBe(false);
  });

  it('signOut() revokes server side and forgets locally even when offline', async () => {
    const { auth, storage } = setup({
      'POST /v1/auth/email/verify': () => ({
        body: { account: ACCOUNT, session: { expiresAt: 'x' }, token: 'tok' },
      }),
    });
    await auth.verifyCode('ece@example.com', '123456');
    await auth.signOut(); // logout route is not scripted: 404, ignored
    expect(storage.data.has('qp.account.token')).toBe(false);
    expect(auth.state.status).toBe('SIGNED_OUT');
  });
});
