import { execFileSync } from 'node:child_process';
import { createSign, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Test support: a locally generated certificate chain shaped like Apple's (root → intermediate with
 * Apple's intermediate marker → leaf with Apple's receipt-signing marker) and a signer for
 * StoreKit-style JWS. The verification code under test is the production code from Apple's own
 * library; only the trust anchor and the signing key are ours.
 */
export interface AppleChain {
  rootPem: string;
  /** Signs a JWS the way the App Store does, with this chain in the header. */
  sign(payload: Record<string, unknown>): string;
}

const openssl = (cwd: string, ...args: string[]): void => {
  execFileSync('openssl', args, { cwd, stdio: 'pipe' });
};

export function createAppleChain(name = 'Test'): AppleChain {
  const dir = mkdtempSync(join(tmpdir(), 'qp-apple-'));
  try {
    const ext = (file: string, lines: string[]): void =>
      writeFileSync(join(dir, file), `${lines.join('\n')}\n`);
    openssl(dir, 'ecparam', '-name', 'secp384r1', '-genkey', '-noout', '-out', 'root.key');
    openssl(
      dir,
      'req',
      '-new',
      '-x509',
      '-key',
      'root.key',
      '-sha384',
      '-days',
      '30',
      '-subj',
      `/CN=${name} Root CA`,
      '-out',
      'root.pem',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
    );
    ext('inter.ext', ['basicConstraints=critical,CA:TRUE', '1.2.840.113635.100.6.2.1=ASN1:NULL']);
    openssl(dir, 'ecparam', '-name', 'secp384r1', '-genkey', '-noout', '-out', 'inter.key');
    openssl(
      dir,
      'req',
      '-new',
      '-key',
      'inter.key',
      '-subj',
      `/CN=${name} Intermediate`,
      '-out',
      'inter.csr',
    );
    openssl(
      dir,
      'x509',
      '-req',
      '-in',
      'inter.csr',
      '-CA',
      'root.pem',
      '-CAkey',
      'root.key',
      '-CAcreateserial',
      '-days',
      '30',
      '-sha384',
      '-extfile',
      'inter.ext',
      '-out',
      'inter.pem',
    );
    ext('leaf.ext', ['basicConstraints=critical,CA:FALSE', '1.2.840.113635.100.6.11.1=ASN1:NULL']);
    openssl(dir, 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.key');
    openssl(
      dir,
      'req',
      '-new',
      '-key',
      'leaf.key',
      '-subj',
      `/CN=${name} Leaf`,
      '-out',
      'leaf.csr',
    );
    openssl(
      dir,
      'x509',
      '-req',
      '-in',
      'leaf.csr',
      '-CA',
      'inter.pem',
      '-CAkey',
      'inter.key',
      '-CAcreateserial',
      '-days',
      '30',
      '-sha256',
      '-extfile',
      'leaf.ext',
      '-out',
      'leaf.pem',
    );
    const der = (file: string): string =>
      readFileSync(join(dir, file), 'utf8').replace(/-----[A-Z ]+-----|\s/gu, '');
    const x5c = [der('leaf.pem'), der('inter.pem'), der('root.pem')];
    const leafKey = readFileSync(join(dir, 'leaf.key'), 'utf8');
    const rootPem = readFileSync(join(dir, 'root.pem'), 'utf8');
    return {
      rootPem,
      sign(payload) {
        const header = Buffer.from(JSON.stringify({ alg: 'ES256', x5c })).toString('base64url');
        const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signature = createSign('SHA256')
          .update(`${header}.${body}`)
          .sign({ key: leafKey, dsaEncoding: 'ieee-p1363' })
          .toString('base64url');
        return `${header}.${body}.${signature}`;
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const BUNDLE_ID = 'app.quizparty.test';
export const APPLE_PRODUCT = 'quizparty_full_game';

/** What StoreKit 2 puts in a signed transaction for a one-time purchase. */
export function appleTransaction(
  accountToken: string | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const id = String(Math.floor(Math.random() * 1e12));
  const now = Date.now();
  return {
    transactionId: id,
    originalTransactionId: id,
    bundleId: BUNDLE_ID,
    productId: APPLE_PRODUCT,
    purchaseDate: now,
    originalPurchaseDate: now,
    signedDate: now,
    type: 'Non-Consumable',
    environment: 'Sandbox',
    ...(accountToken ? { appAccountToken: accountToken } : {}),
    ...overrides,
  };
}

/** A server notification (V2) wrapping a signed transaction. */
export function appleNotification(
  chain: AppleChain,
  type: string,
  transaction: Record<string, unknown>,
): { signedPayload: string; uuid: string } {
  const uuid = randomUUID();
  return {
    uuid,
    signedPayload: chain.sign({
      notificationType: type,
      notificationUUID: uuid,
      version: '2.0',
      signedDate: Date.now(),
      data: {
        environment: 'Sandbox',
        bundleId: BUNDLE_ID,
        signedTransactionInfo: chain.sign(transaction),
      },
    }),
  };
}
