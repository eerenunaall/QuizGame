import { randomUUID } from 'node:crypto';
import { createAppleChain, APPLE_PRODUCT, BUNDLE_ID, type AppleChain } from './apple-store';
import { GOOGLE_PACKAGE, GOOGLE_PRODUCT, startGooglePlay, type GooglePlay } from './google-store';
import type { EmailSender } from '../../apps/realtime/src/auth/email';
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
export async function startShop(
  env: Record<string, string> = {},
  options: { emailSender?: EmailSender } = {},
): Promise<Shop> {
  const apple = createAppleChain('Shop');
  const google = await startGooglePlay();
  const server = await startServer({
    ...(options.emailSender ? { emailSender: options.emailSender } : {}),
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

/**
 * A browser's cookie jar for the one cookie the API sets (the Blind Quiz claim, ADR-0015): shared by
 * every `call`, so a test plays the target's browser by default and the creator or a stranger by
 * passing `cookies: false`, or a second browser with its own `jar`.
 */
export type CookieJar = Map<string, { value: string; path: string }>;
const defaultJar: CookieJar = new Map();

export async function call<T = Record<string, unknown>>(
  server: TestServer,
  method: string,
  path: string,
  options: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
    cookies?: boolean;
    jar?: CookieJar;
  } = {},
): Promise<{ status: number; body: T }> {
  const jar = options.jar ?? defaultJar;
  const cookie =
    options.cookies === false
      ? ''
      : [...jar]
          .filter(([, entry]) => path.startsWith(entry.path))
          .map(([name, entry]) => `${name}=${entry.value}`)
          .join('; ');
  const response = await fetch(`${server.httpUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair = '', ...attributes] = line.split(';').map((part) => part.trim());
    const eq = pair.indexOf('=');
    const attribute = attributes.find((a) => a.toLowerCase().startsWith('path='));
    if (eq > 0)
      jar.set(pair.slice(0, eq), {
        value: pair.slice(eq + 1),
        path: attribute ? attribute.slice(5) : '/',
      });
  }
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

export const pubsub = (event: unknown, messageId: string = randomUUID()) => ({
  message: { data: Buffer.from(JSON.stringify(event)).toString('base64'), messageId },
  subscription: 'projects/test/subscriptions/rtdn',
});
