import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Test support: a local HTTP server standing in for a remote service (the model API, an embedding
 * service). It speaks real HTTP, so the clients' request building, headers, JSON handling and
 * timeouts all run unchanged; only the far end is replaced.
 */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface Reply {
  status?: number;
  json?: unknown;
  text?: string;
  /** Never answer: for timeout tests. */
  hang?: boolean;
}

export interface HttpDouble {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startHttpDouble(
  handler: (request: RecordedRequest, index: number) => Reply,
): Promise<HttpDouble> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = raw;
      try {
        body = raw === '' ? null : (JSON.parse(raw) as unknown);
      } catch {
        // keep the raw text
      }
      const request: RecordedRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body,
      };
      const index = requests.push(request) - 1;
      const reply = handler(request, index);
      if (reply.hang) return;
      res.writeHead(reply.status ?? 200, {
        'content-type': reply.text === undefined ? 'application/json' : 'text/plain',
      });
      res.end(reply.text ?? JSON.stringify(reply.json ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
