/**
 * The few account calls the web app makes (sign-in by emailed code, linking a TV room). Same-origin
 * cookie session; every request carries the CSRF header the server insists on for cookie callers.
 */
export class AccountApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.name = 'AccountApiError';
    this.status = status;
    this.code = code;
  }
}

export interface AccountView {
  id: string;
  email: string | null;
  roles: string[];
  sessionKind: string;
}

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'x-quizparty-csrf': '1',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new AccountApiError(response.status, payload?.error?.code ?? 'INTERNAL');
  }
  return (await response.json()) as T;
}

export const accountApi = {
  me: () => call<{ account: AccountView }>('/v1/me', 'GET').then((r) => r.account),
  requestCode: (email: string, locale: 'tr' | 'en') =>
    call<{ ok: true }>('/v1/auth/email/request', 'POST', { email, locale }),
  verifyCode: (email: string, code: string) =>
    call<{ account: AccountView }>('/v1/auth/email/verify', 'POST', {
      email,
      code,
      client: 'WEB',
    }).then((r) => r.account),
  logout: () => call<{ ok: true }>('/v1/auth/logout', 'POST', {}),
  peekLink: (token: string) =>
    call<{ roomCode: string; tier: 'FREE' | 'FULL' }>(
      `/v1/link-intents/${encodeURIComponent(token)}`,
      'GET',
    ),
  claimLink: (token: string) =>
    call<{ roomCode: string; tier: 'FREE' | 'FULL' }>(
      `/v1/link-intents/${encodeURIComponent(token)}/claim`,
      'POST',
      {},
    ),
};
