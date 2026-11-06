import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MailRequest {
  provider: 'resend' | 'brevo';
  path: string;
  headers: IncomingMessage['headers'];
  /** What the provider would deliver, normalised from its wire shape. */
  mail: { from: string; to: string; subject: string; text: string };
}

export interface EmailServer {
  url: string;
  requests: MailRequest[];
  /** Make the next calls answer this status (one entry per call), then behave normally. */
  failNext(...statuses: number[]): void;
  /** Hold the next call for this long without answering. */
  stallNext(ms: number): void;
  close(): Promise<void>;
}

const WIRE_ERRORS: Record<number, [string, string]> = {
  401: ['missing_api_key', 'unauthorized'],
  403: ['restricted_api_key', 'permission_denied'],
  422: ['validation_error', 'invalid_parameter'],
  429: ['rate_limit_exceeded', 'too_many_requests'],
  500: ['internal_server_error', 'internal_server_error'],
  503: ['application_error', 'service_unavailable'],
};

/**
 * A local server that speaks the real wire contract of the two supported mail APIs: Resend
 * (`POST /emails`, Bearer key, `{from,to[],subject,text}` -> 200 `{id}`) and Brevo (`POST
 * /v3/smtp/email`, `api-key` header, `{sender{},to[{email}],subject,textContent}` -> 201
 * `{messageId}`). It validates the request shape like the services do, so a client that drifts from
 * the contract gets the provider's 4xx, not a silent pass.
 */
export async function startEmailServer(
  provider: 'resend' | 'brevo',
  apiKey: string,
): Promise<EmailServer> {
  const requests: MailRequest[] = [];
  const forced: number[] = [];
  let stall = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const reply = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const error = (status: number): void => {
        const [name, code] = WIRE_ERRORS[status] ?? ['error', 'error'];
        reply(
          status,
          provider === 'resend'
            ? { statusCode: status, name, message: 'The request failed.' }
            : { code, message: 'The request failed.' },
        );
      };
      const run = (): void => {
        const forcedStatus = forced.shift();
        if (forcedStatus) return error(forcedStatus);
        const path = req.url ?? '';
        const wantPath = provider === 'resend' ? '/emails' : '/v3/smtp/email';
        if (req.method !== 'POST' || path !== wantPath) return reply(404, { message: 'not found' });
        const authorised =
          provider === 'resend'
            ? req.headers.authorization === `Bearer ${apiKey}`
            : req.headers['api-key'] === apiKey;
        if (!authorised) return error(401);
        if (!String(req.headers['content-type']).startsWith('application/json')) return error(422);
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        } catch {
          return error(422);
        }
        let mail: MailRequest['mail'] | null = null;
        if (provider === 'resend') {
          const keys = Object.keys(body).sort().join();
          if (
            keys === 'from,subject,text,to' &&
            typeof body.from === 'string' &&
            Array.isArray(body.to) &&
            body.to.length === 1 &&
            typeof body.to[0] === 'string' &&
            typeof body.subject === 'string' &&
            typeof body.text === 'string' &&
            typeof req.headers['idempotency-key'] === 'string'
          )
            mail = { from: body.from, to: body.to[0], subject: body.subject, text: body.text };
        } else {
          const sender = body.sender as { email?: unknown; name?: unknown } | undefined;
          const to = body.to as { email?: unknown }[] | undefined;
          if (
            Object.keys(body).sort().join() === 'sender,subject,textContent,to' &&
            typeof sender?.email === 'string' &&
            Array.isArray(to) &&
            to.length === 1 &&
            typeof to[0]?.email === 'string' &&
            typeof body.subject === 'string' &&
            typeof body.textContent === 'string'
          )
            mail = {
              from:
                typeof sender.name === 'string' ? `${sender.name} <${sender.email}>` : sender.email,
              to: to[0].email,
              subject: body.subject,
              text: body.textContent,
            };
        }
        if (!mail) return error(422);
        requests.push({ provider, path, headers: req.headers, mail });
        if (provider === 'resend') reply(200, { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
        else reply(201, { messageId: '<201798300811.5787683@relay.example.com>' });
      };
      if (stall > 0) {
        const ms = stall;
        stall = 0;
        setTimeout(run, ms).unref();
      } else run();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    failNext: (...statuses) => void forced.push(...statuses),
    stallNext: (ms) => void (stall = ms),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
