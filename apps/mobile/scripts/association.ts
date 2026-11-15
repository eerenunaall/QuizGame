/* eslint-disable no-console -- command line tool */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appleAppSiteAssociation, assetLinks } from '../src/core/association';

// Usage (values are the owner's, see docs/MOBILE.md):
//   QP_APPLE_TEAM_ID=ABCDE12345 QP_BUNDLE_ID=com.acme.quiznight QP_ANDROID_PACKAGE=com.acme.quiznight \
//   QP_ANDROID_SHA256=AA:BB:..,CC:DD:.. pnpm --filter @quizparty/mobile association [outDir]
const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (OWNER-TO-FILL, see docs/MOBILE.md)`);
  return value;
};
const input = {
  appleTeamId: need('QP_APPLE_TEAM_ID'),
  iosBundleId: need('QP_BUNDLE_ID'),
  androidPackage: need('QP_ANDROID_PACKAGE'),
  androidSha256: need('QP_ANDROID_SHA256').split(','),
};
const out = resolve(process.argv[2] ?? '../web/public/.well-known');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'apple-app-site-association'), `${appleAppSiteAssociation(input)}\n`);
writeFileSync(resolve(out, 'assetlinks.json'), `${assetLinks(input)}\n`);
console.log(`wrote association files to ${out}`);
