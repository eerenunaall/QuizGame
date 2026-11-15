/**
 * Renders the two domain-association files that make https links open the app (ADR-0017). They are
 * generated from the owner's identifiers instead of being committed with placeholders, because a
 * file with a made-up team id would silently fail verification. Shape is unit-tested; whether the
 * stores accept them needs the real domain and signed builds (docs/MOBILE.md).
 */
export interface AssociationInput {
  /** Apple Developer Team ID, e.g. "ABCDE12345". OWNER-TO-FILL. */
  appleTeamId: string;
  iosBundleId: string;
  androidPackage: string;
  /** SHA-256 certificate fingerprints of the Play app-signing key (and upload key while testing). */
  androidSha256: string[];
}

const TEAM_ID = /^[A-Z0-9]{10}$/u;
const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/u;
const PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/iu;

export function appleAppSiteAssociation(input: AssociationInput): string {
  if (!TEAM_ID.test(input.appleTeamId)) throw new Error('appleTeamId must be 10 characters A-Z0-9');
  if (!PACKAGE.test(input.iosBundleId)) throw new Error('iosBundleId is not a bundle identifier');
  return JSON.stringify(
    {
      applinks: {
        details: [
          {
            appIDs: [`${input.appleTeamId}.${input.iosBundleId}`],
            components: [
              { '/': '/j/*', comment: 'Short join link from the TV' },
              { '/': '/join/*' },
              { '/': '/unlock/*' },
            ],
          },
        ],
      },
    },
    null,
    2,
  );
}

export function assetLinks(input: AssociationInput): string {
  if (!PACKAGE.test(input.androidPackage)) throw new Error('androidPackage is not a package name');
  if (input.androidSha256.length === 0 || !input.androidSha256.every((f) => SHA256.test(f)))
    throw new Error('androidSha256 needs AA:BB:… SHA-256 fingerprints');
  return JSON.stringify(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: input.androidPackage,
          sha256_cert_fingerprints: input.androidSha256,
        },
      },
    ],
    null,
    2,
  );
}
