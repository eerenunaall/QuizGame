import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local server that speaks the Messages API of the remote model service as the authoring adapter uses
 * it (`POST /v1/messages`, `x-api-key`, `anthropic-version`, a forced tool call answered with a
 * `tool_use` block, the service's error envelopes). It rejects a request that drifts from the contract
 * (wrong key, wrong version, no forced tool, malformed body) the way the service does, so the adapter
 * cannot pass on a bad shape. What the "model" answers is up to the test.
 */
export interface AuthoringRequest {
  headers: IncomingMessage['headers'];
  body: {
    model: string;
    max_tokens: number;
    system: string;
    messages: { role: string; content: string }[];
    tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
    tool_choice: { type: string; name: string };
  };
  /** The untrusted document as the adapter sent it. */
  document: { ref: string; text: string }[];
}

export type AuthoringReply =
  | { questions: unknown[]; raw?: never }
  /** The tool input exactly as given (to send malformed output). */
  | { toolInput: unknown }
  /** A plain text answer with no tool call: a model that ignored the forced tool. */
  | { text: string }
  | { status: number }
  | { questions: unknown[]; delayMs: number };

export interface AuthoringServer {
  url: string;
  requests: AuthoringRequest[];
  /** Answer the next calls with these statuses (one per call), then behave normally. */
  failNext(...statuses: number[]): void;
  setAnswer(answer: (request: AuthoringRequest) => AuthoringReply): void;
  close(): Promise<void>;
}

const ERROR_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  429: 'rate_limit_error',
  500: 'api_error',
  529: 'overloaded_error',
};

export async function startAuthoringServer(
  apiKey: string,
  model: string,
  answer: (request: AuthoringRequest) => AuthoringReply,
): Promise<AuthoringServer> {
  const requests: AuthoringRequest[] = [];
  const failures: number[] = [];
  let current = answer;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const send = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const refuse = (status: number): void =>
        send(status, {
          type: 'error',
          error: { type: ERROR_TYPES[status] ?? 'api_error', message: 'refused' },
        });
      if (req.method !== 'POST' || req.url !== '/v1/messages') return refuse(400);
      if (req.headers['x-api-key'] !== apiKey) return refuse(401);
      if (req.headers['anthropic-version'] !== '2023-06-01') return refuse(400);
      if (!String(req.headers['content-type']).startsWith('application/json')) return refuse(400);
      let body: AuthoringRequest['body'];
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as AuthoringRequest['body'];
      } catch {
        return refuse(400);
      }
      const user = body.messages?.[0]?.content;
      if (
        body.model !== model ||
        !Number.isInteger(body.max_tokens) ||
        typeof body.system !== 'string' ||
        body.messages?.length !== 1 ||
        body.messages[0]?.role !== 'user' ||
        typeof user !== 'string' ||
        body.tool_choice?.type !== 'tool' ||
        body.tool_choice.name !== body.tools?.[0]?.name
      )
        return refuse(400);
      let document: AuthoringRequest['document'] = [];
      try {
        const parsed = JSON.parse(user) as {
          document: { sections: { ref: string; text: string }[] };
        };
        document = parsed.document.sections;
      } catch {
        return refuse(400);
      }
      const request: AuthoringRequest = { headers: req.headers, body, document };
      requests.push(request);
      const forced = failures.shift();
      if (forced !== undefined) return refuse(forced);
      const reply = current(request);
      if ('status' in reply) return refuse(reply.status);
      const respond = (content: unknown[]): void =>
        send(200, {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model,
          content,
          stop_reason: content.some((part) => (part as { type: string }).type === 'tool_use')
            ? 'tool_use'
            : 'end_turn',
          usage: { input_tokens: 900, output_tokens: 300 },
        });
      const done = (): void => {
        if ('text' in reply) return respond([{ type: 'text', text: reply.text }]);
        const input = 'toolInput' in reply ? reply.toolInput : { questions: reply.questions };
        respond([{ type: 'tool_use', id: 'toolu_test', name: body.tools[0]!.name, input }]);
      };
      if ('delayMs' in reply) setTimeout(done, reply.delayMs).unref();
      else done();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    failNext: (...statuses) => {
      failures.push(...statuses);
    },
    setAnswer: (next) => {
      current = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Questions a careful model would write from `SAMPLE_PARAGRAPHS`: each quote is in the document. */
export function galataQuestions(): unknown[] {
  const q = (
    question: string,
    options: string[],
    correctIndex: number,
    difficulty: string,
    explanation: string,
    sourceQuote: string,
  ) => ({ question, options, correctIndex, difficulty, explanation, sourceQuote });
  return [
    q(
      'Galata Kulesi hangi yılda inşa edilmiştir?',
      ['1204', '1348', '1453', '1520'],
      1,
      'EASY',
      'Kule 1348 yılında Cenevizliler tarafından inşa edilmiştir.',
      '1348 yilinda Cenevizliler tarafindan insa edilmistir',
    ),
    q(
      "Galata Kulesi'nin yüksekliği yaklaşık kaç metredir?",
      ['47', '57', '67', '77'],
      2,
      'MEDIUM',
      'Kulenin tepesinden şehrin panoramik manzarası görülebilir.',
      'Kulenin yüksekliği yaklaşık 67 metredir',
    ),
    q(
      'Osmanlı döneminde Galata Kulesi hangi amaçla kullanılmıştır?',
      ['Yangın gözetleme', 'Cephanelik', 'Hapishane', 'Medrese'],
      0,
      'MEDIUM',
      'Kule yangınları izlemek için bir gözetleme kulesi olarak görev yapmıştır.',
      'kule yangın gözetleme kulesi olarak görev yapmış',
    ),
    q(
      "Galata Kulesi'nden uçtuğu rivayet edilen kişi kimdir?",
      ['Hezarfen Ahmed Çelebi', 'Evliya Çelebi', 'Piri Reis', 'Katip Çelebi'],
      0,
      'HARD',
      'Bu hikaye İstanbul efsanelerinin en meşhurlarındandır.',
      "Hezarfen Ahmed Çelebi'nin kuleden uçtuğu rivayet edilir",
    ),
    q(
      'Galata Kulesi hangi şehirde bulunur?',
      ['Ankara', 'İzmir', 'İstanbul', 'Bursa'],
      2,
      'EASY',
      'Kule İstanbul turizminin en önemli duraklarından biridir.',
      'İstanbul turizminin en önemli duraklarından biridir',
    ),
  ];
}
