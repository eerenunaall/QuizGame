import { randomUUID } from 'node:crypto';
import type { Role } from '../../apps/realtime/src/auth/accounts';
import type { SessionKind } from '../../apps/realtime/src/auth/account-sessions';
import type { TestServer } from './server';

export interface Staff {
  accountId: string;
  email: string;
  token: string;
  roles: Role[];
}

/** An account with the given roles and a live session, made directly (sign-in itself is tested elsewhere). */
export async function staff(
  server: TestServer,
  roles: Role[],
  kind: SessionKind = 'ADMIN',
): Promise<Staff> {
  const email = `${roles.join('-').toLowerCase() || 'nobody'}-${randomUUID().slice(0, 8)}@example.com`;
  const account = (await server.built.accounts.signIn(email, 'tr'))!;
  const outcome = await server.built.accounts.setRoles(account.id, roles, account.id);
  if (outcome !== 'OK')
    throw new Error(`could not give ${roles.join(',')} to the test account: ${outcome}`);
  const session = await server.built.accountSessions.create(account.id, kind, {
    ipHash: 'test',
    userAgentHash: null,
  });
  return { accountId: account.id, email, token: session.token, roles };
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  text: string;
}

/** A tiny client for the admin API, as a signed-in member of staff using a bearer token. */
export function adminApi(server: TestServer, who: { token: string }) {
  const call = async <T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse<T>> => {
    const response = await fetch(`${server.httpUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${who.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (an export)
    }
    return { status: response.status, body: parsed as T, headers: response.headers, text };
  };
  return {
    get: <T = unknown>(path: string) => call<T>('GET', path),
    post: <T = unknown>(path: string, body: unknown = {}) => call<T>('POST', path, body),
    patch: <T = unknown>(path: string, body: unknown) => call<T>('PATCH', path, body),
    put: <T = unknown>(path: string, body: unknown) => call<T>('PUT', path, body),
    call,
  };
}
