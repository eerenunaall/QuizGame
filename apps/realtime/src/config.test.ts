import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { BlindVault } from './blind/vault';

const production = {
  NODE_ENV: 'production',
  SERVER_SECRET: 'x'.repeat(40),
  DATABASE_URL: 'postgres://u:p@db/qp',
  PUBLIC_WEB_URL: 'https://play.example.test',
  ALLOWED_ORIGINS: 'https://play.example.test',
};
const key = () => randomBytes(32).toString('base64');

describe('production safety', () => {
  it('refuses unsafe settings', () => {
    expect(() => loadConfig({ ...production, SERVER_SECRET: 'short' })).toThrow(/SERVER_SECRET/u);
    expect(() => loadConfig({ ...production, PUBLIC_WEB_URL: 'http://play.example.test' })).toThrow(
      /https/u,
    );
    expect(() => loadConfig({ ...production, RATE_LIMIT_SCALE: '2' })).toThrow(/RATE_LIMIT_SCALE/u);
    expect(() => loadConfig({ ...production, QP_ALLOW_DEV_SEED: '1' })).toThrow(
      /QP_ALLOW_DEV_SEED/u,
    );
    expect(loadConfig(production).env).toBe('production');
  });

  // The owner types these two on a phone (docs/GUSTO_GO_LIVE.md, adım 4). A trailing slash or capital letter
  // in the allow-list would not equal the browser's Origin header, so every phone's WebSocket and every
  // admin sign-in would be refused with no hint in the log.
  it('reads origins the way a browser sends them', () => {
    const config = loadConfig({
      ...production,
      ALLOWED_ORIGINS: ' https://Play.Example.test/ , https://old.example.test/ ',
    });
    expect(config.allowedOrigins).toEqual([
      'https://play.example.test',
      'https://old.example.test',
    ]);
  });

  it('refuses a public address that its own allow-list would turn away', () => {
    expect(() =>
      loadConfig({ ...production, ALLOWED_ORIGINS: 'https://other.example.test' }),
    ).toThrow(/ALLOWED_ORIGINS must include the PUBLIC_WEB_URL origin/u);
    expect(
      loadConfig({
        ...production,
        PUBLIC_WEB_URL: 'https://play.example.test/',
        ALLOWED_ORIGINS: 'https://old.example.test,https://play.example.test/',
      }).allowedOrigins,
    ).toEqual(['https://old.example.test', 'https://play.example.test']);
  });
});

describe('personal quiz sealing keys (ADR-0015)', () => {
  it('derives a development key outside production, and none inside it', () => {
    expect(loadConfig({}).blindKeys?.map((k) => k.id)).toEqual(['dev']);
    expect(loadConfig(production).blindKeys).toBeNull();
  });

  it('reads id:key lists with the first as the active key, and refuses malformed ones', () => {
    const config = loadConfig({ ...production, BLIND_DATA_KEYS: `k2:${key()},k1:${key()}` });
    expect(config.blindKeys?.map((k) => k.id)).toEqual(['k2', 'k1']);
    for (const bad of [
      `k1:${Buffer.alloc(16).toString('base64')}`,
      `k1:${key()},k1:${key()}`,
      `bad id:${key()}`,
      'nokey',
      `:${key()}`,
    ])
      expect(() => loadConfig({ ...production, BLIND_DATA_KEYS: bad }), bad).toThrow(
        /BLIND_DATA_KEYS/u,
      );
  });

  it('a vault without a key is off', () => {
    const vault = new BlindVault({
      db: {} as never,
      sealer: null,
      clock: { now: () => 0 },
      secret: 'x'.repeat(40),
    });
    expect(vault.enabled()).toBe(false);
  });
});

describe('store settings fail closed', () => {
  it('needs a complete store configuration before payments can be on', () => {
    expect(() => loadConfig({ PAYMENTS_ENABLED: '1' })).toThrow(/PAYMENTS_ENABLED/u);
    expect(() => loadConfig({ APPLE_BUNDLE_ID: 'app.test' })).toThrow(/APPLE_ROOT_CERTS_PEM/u);
    expect(() =>
      loadConfig({
        GOOGLE_PACKAGE_NAME: 'app.test',
        GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"a@b.c"}',
      }),
    ).toThrow(/GOOGLE/u);
    expect(loadConfig({}).payments).toMatchObject({ enabled: false, apple: null, google: null });
  });
});

describe('empty variables', () => {
  it('treat an empty optional value (docker compose passes unset ones that way) as not set', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      EMAIL_WEBHOOK_URL: '',
      EMAIL_WEBHOOK_TOKEN: '',
      BLIND_DATA_KEYS: '',
      METRICS_TOKEN: '',
    });
    expect(config.emailWebhook).toBeNull();
    expect(config.metricsToken).toBeNull();
  });
});
