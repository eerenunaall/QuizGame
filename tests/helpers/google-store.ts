import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';

/**
 * Test support: a local stand-in for Google's token endpoint and Play Developer API, speaking the
 * real wire contract (service-account JWT in, bearer-authenticated REST out). The production client
 * code runs unchanged; only the far end is ours.
 */
export const GOOGLE_PACKAGE = 'app.quizparty.test';
export const GOOGLE_PRODUCT = 'quizparty_full_game';

export interface PlayPurchase {
  orderId: string;
  purchaseState: 0 | 1 | 2;
  acknowledgementState: 0 | 1;
  obfuscatedExternalAccountId?: string;
  purchaseType?: 0;
}

export interface GooglePlay {
  apiBase: string;
  tokenUri: string;
  serviceAccountJson: string;
  purchases: Map<string, PlayPurchase>;
  /** Every request that reached the Developer API, in order. */
  calls: { method: string; path: string }[];
  acknowledged: string[];
  tokenRequests: number;
  /** Make the Developer API answer with this status until cleared. */
  failWith: number | null;
  close(): Promise<void>;
}

export async function startGooglePlay(): Promise<GooglePlay> {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const state: GooglePlay = {
    apiBase: '',
    tokenUri: '',
    serviceAccountJson: '',
    purchases: new Map(),
    calls: [],
    acknowledged: [],
    tokenRequests: 0,
    failWith: null,
    close: () => Promise.resolve(),
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const url = req.url ?? '';
      if (url === '/token') {
        state.tokenRequests += 1;
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const assertion = form.get('assertion')?.split('.') ?? [];
        if (
          form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' ||
          assertion.length !== 3
        )
          return send(400, { error: 'invalid_grant' });
        return send(200, { access_token: 'test-access-token', expires_in: 3600 });
      }
      state.calls.push({ method: req.method ?? '', path: url });
      if (req.headers.authorization !== 'Bearer test-access-token') return send(401, {});
      if (state.failWith !== null) return send(state.failWith, {});
      const match = new RegExp(
        `^/androidpublisher/v3/applications/${GOOGLE_PACKAGE}/purchases/products/${GOOGLE_PRODUCT}/tokens/([^/:]+)(:acknowledge)?$`,
        'u',
      ).exec(url);
      if (!match) return send(404, {});
      const token = decodeURIComponent(match[1]!);
      const purchase = state.purchases.get(token);
      if (!purchase) return send(400, { error: { message: 'The purchase token was not found.' } });
      if (match[2]) {
        purchase.acknowledgementState = 1;
        state.acknowledged.push(token);
        return send(200, {});
      }
      return send(200, {
        kind: 'androidpublisher#productPurchase',
        productId: GOOGLE_PRODUCT,
        ...purchase,
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.apiBase = base;
  state.tokenUri = `${base}/token`;
  state.serviceAccountJson = JSON.stringify({
    client_email: 'play@quizparty-test.iam.gserviceaccount.com',
    private_key: privateKey,
    token_uri: state.tokenUri,
  });
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return state;
}
