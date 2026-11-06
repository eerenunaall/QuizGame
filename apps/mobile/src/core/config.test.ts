import { afterEach, describe, expect, it } from '@jest/globals';
import appConfig, { PLACEHOLDER_IDENTIFIER } from '../../app.config';
import { resolveAppConfig } from './config';

const SAVED = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED };
});
const build = () => appConfig({ config: {} } as never);

describe('resolveAppConfig', () => {
  it('derives host list, trims slashes and defaults the product', () => {
    const config = resolveAppConfig(
      {
        apiUrl: 'https://api.example.com/',
        webUrl: 'https://Quiz.Example.com/',
        wsUrl: 'wss://api.example.com/ws',
      },
      '1.2.3',
    );
    expect(config).toMatchObject({
      apiUrl: 'https://api.example.com',
      webUrl: 'https://Quiz.Example.com',
      webHosts: ['quiz.example.com'],
      productId: 'quizparty_full_game',
      version: '1.2.3',
    });
  });

  it('survives missing or malformed extra', () => {
    expect(resolveAppConfig(undefined).apiUrl).toBe('http://localhost:8080');
    expect(resolveAppConfig({ webUrl: 'not a url' }).webHosts).toEqual([]);
  });
});

describe('app.config.ts', () => {
  it('is env driven and ships clearly marked placeholder identifiers', () => {
    delete process.env.QP_API_URL;
    delete process.env.QP_BUNDLE_ID;
    const config = build();
    expect(PLACEHOLDER_IDENTIFIER).toBe('com.example.quiznight');
    expect(config.ios?.bundleIdentifier).toBe('com.example.quiznight');
    expect(config.android?.package).toBe('com.example.quiznight');
    expect(config.scheme).toBe('quiznight');
    expect(config.extra?.apiUrl).toBe('http://localhost:8080');
    expect(config.extra?.wsUrl).toBe('ws://localhost:8080/ws');
    // No https host yet: no association entries that could never verify.
    expect(config.ios?.associatedDomains).toBeUndefined();
    expect(config.android?.intentFilters).toBeUndefined();
  });

  it('declares universal and app links for an https web host', () => {
    process.env.QP_API_URL = 'https://api.example.com';
    process.env.QP_WEB_URL = 'https://quiz.example.com';
    const config = build();
    expect(config.extra?.wsUrl).toBe('wss://api.example.com/ws');
    expect(config.ios?.associatedDomains).toEqual(['applinks:quiz.example.com']);
    const filter = config.android?.intentFilters?.[0];
    expect(filter?.autoVerify).toBe(true);
    expect([filter?.data].flat().map((d) => d?.pathPrefix)).toEqual(['/j', '/join', '/unlock']);
  });

  it('never lets a production build ship cleartext URLs or placeholder ids', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.QP_API_URL = 'http://api.example.com';
    expect(build).toThrow(/https/);
    process.env.QP_API_URL = 'https://api.example.com';
    expect(build).toThrow(/OWNER-TO-FILL/);
    process.env.QP_BUNDLE_ID = 'com.acme.quiz';
    process.env.QP_ANDROID_PACKAGE = 'com.acme.quiz';
    expect(build().ios?.bundleIdentifier).toBe('com.acme.quiz');
  });

  it('puts no secret-looking value into the public config', () => {
    process.env.QP_API_URL = 'https://api.example.com';
    expect(Object.keys(build().extra ?? {}).sort()).toEqual([
      'apiUrl',
      'productId',
      'webUrl',
      'wsUrl',
    ]);
  });
});
