import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appleAppSiteAssociation, assetLinks } from './association';

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(
  ':',
);
const input = {
  appleTeamId: 'ABCDE12345',
  iosBundleId: 'com.acme.quiznight',
  androidPackage: 'com.acme.quiznight',
  androidSha256: [FP],
};

describe('association files', () => {
  it('renders the Apple file with the short and long join paths and unlock', () => {
    const file = JSON.parse(appleAppSiteAssociation(input)) as {
      applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] };
    };
    expect(file.applinks.details[0]?.appIDs).toEqual(['ABCDE12345.com.acme.quiznight']);
    expect(file.applinks.details[0]?.components.map((c) => c['/'])).toEqual([
      '/j/*',
      '/join/*',
      '/unlock/*',
    ]);
  });

  it('renders assetlinks.json with the signing fingerprint', () => {
    const file = JSON.parse(assetLinks(input)) as {
      relation: string[];
      target: { package_name: string; sha256_cert_fingerprints: string[] };
    }[];
    expect(file[0]?.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(file[0]?.target).toMatchObject({
      package_name: 'com.acme.quiznight',
      sha256_cert_fingerprints: [FP],
    });
  });

  it('refuses placeholders and malformed identifiers instead of publishing a dead file', () => {
    expect(() => appleAppSiteAssociation({ ...input, appleTeamId: 'OWNER-TO-FILL' })).toThrow();
    expect(() => appleAppSiteAssociation({ ...input, iosBundleId: 'nodots' })).toThrow();
    expect(() => assetLinks({ ...input, androidSha256: ['AA:BB'] })).toThrow();
    expect(() => assetLinks({ ...input, androidSha256: [] })).toThrow();
  });

  it('keeps the committed templates in the same shape as the generator', () => {
    const dir = resolve(__dirname, '../../association');
    const apple = JSON.parse(
      readFileSync(resolve(dir, 'apple-app-site-association.template.json'), 'utf8'),
    ) as {
      applinks: { details: { components: { '/': string }[] }[] };
    };
    expect(apple.applinks.details[0]?.components.map((c) => c['/'])).toEqual([
      '/j/*',
      '/join/*',
      '/unlock/*',
    ]);
    const links = JSON.parse(readFileSync(resolve(dir, 'assetlinks.template.json'), 'utf8')) as {
      target: { namespace: string }[];
    }[];
    expect(links[0]?.target).toMatchObject({ namespace: 'android_app' });
  });
});
