import { randomUUID } from 'node:crypto';
import { createAppleChain, APPLE_PRODUCT, BUNDLE_ID, type AppleChain } from './apple-store';
import { GOOGLE_PACKAGE, GOOGLE_PRODUCT, startGooglePlay, type GooglePlay } from './google-store';
import { startServer, type TestServer } from './server';

export interface Shop {
  server: TestServer;
  apple: AppleChain;
  google: GooglePlay;
  webhookSecret: string;
  dispose(): Promise<void>;
}

export const WEBHOOK_SECRET = 'google-webhook-secret-0123456789abcdef';

/** A real server with both stores configured and pointed at the local doubles. */
export async function startShop(env: Record<string, string> = {}): Promise<Shop> {
  const apple = createAppleChain('Shop');
  const google = await startGooglePlay();
  const server = await startServer({
    env: {
      PAYMENTS_ENABLED: '1',
      PAYMENTS_ACCEPT_SANDBOX: '1',
      APPLE_BUNDLE_ID: BUNDLE_ID,
      APPLE_PRODUCT_ID: APPLE_PRODUCT,
      APPLE_ROOT_CERTS_PEM: apple.rootPem,
      APPLE_ONLINE_CHECKS: '0',
      GOOGLE_PACKAGE_NAME: GOOGLE_PACKAGE,
      GOOGLE_PRODUCT_ID: GOOGLE_PRODUCT,
      GOOGLE_SERVICE_ACCOUNT_JSON: google.serviceAccountJson,
      GOOGLE_API_BASE: google.apiBase,
      GOOGLE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      ...env,
    },
  });
  return {
    server,
    apple,
    google,
    webhookSecret: WEBHOOK_SECRET,
    async dispose() {
      await server.dispose();
      await google.close();
    },
  };
}

export interface Player {
  accountId: string;
  email: string;
  token: string;
  storeToken: string;
}

/** A signed-in player account (browser/app session, not staff). */
export async function player(
  server: TestServer,
  kind: 'WEB' | 'MOBILE' = 'MOBILE',
): Promise<Player> {
  const email = `player-${randomUUID().slice(0, 8)}@example.com`;
  const account = (await server.built.accounts.signIn(email, 'tr'))!;
  const session = await server.built.accountSessions.create(account.id, kind, {
    ipHash: 'test',
    userAgentHash: null,
  });
  const storeToken = (await server.built.entitlements.storeAccountToken(account.id))!;
  return { accountId: account.id, email, token: session.token, storeToken };
}

export async function call<T = Record<string, unknown>>(
  server: TestServer,
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${server.httpUrl}${path}`, {
    method,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

export const pubsub = (event: unknown, messageId = randomUUID()) => ({
  message: { data: Buffer.from(JSON.stringify(event)).toString('base64'), messageId },
  subscription: 'projects/test/subscriptions/rtdn',
});
