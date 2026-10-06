import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GOOD } from './audit';

export interface ModelRequest {
  path: string;
  headers: IncomingMessage['headers'];
  body: {
    model: string;
    max_tokens: number;
    temperature: number;
    system: string;
    messages: { role: string; content: string }[];
  };
}

export interface ModelServer {
  url: string;
  requests: ModelRequest[];
  close(): Promise<void>;
}

const TASKS: [string, keyof typeof GOOD][] = [
  ['TASK: fact check', 'FACT_CHECK'],
  ['TASK: ambiguity critic', 'AMBIGUITY'],
  ['TASK: language editor', 'LANGUAGE'],
  ['TASK: difficulty judge', 'DIFFICULTY'],
  ['TASK: game designer', 'GAMEPLAY'],
];

/**
 * A local server that speaks the Messages API wire format: the stand-in for the remote model
 * service, so the real client, prompts, parsing and routing run unchanged. `answer` receives each
 * request and returns the text of the model's reply (or a status to fail with).
 */
export async function startModelServer(
  answer: (request: ModelRequest) => { text: string } | { status: number },
): Promise<ModelServer> {
  const requests: ModelRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request: ModelRequest = {
        path: req.url ?? '',
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as ModelRequest['body'],
      };
      requests.push(request);
      let reply: { text: string } | { status: number };
      try {
        reply = answer(request);
      } catch {
        reply = { status: 400 }; // a bug in the double: fail loudly and do not invite retries
      }
      if ('status' in reply) {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'overloaded_error' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: reply.text }],
          usage: { input_tokens: 120, output_tokens: 40 },
        }),
      );
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

/**
 * A well-behaved model: it answers the blind question correctly (it is given the answers by
 * question text) and rates every pass as the rubric's best.
 */
export function wellBehavedModel(correctIndexByText: ReadonlyMap<string, number>) {
  return (request: ModelRequest): { text: string } => {
    const user = request.body.messages[0]?.content ?? '';
    if (request.body.system.startsWith('You are an expert quiz player')) {
      const document = JSON.parse(user) as { question: string };
      const answer = correctIndexByText.get(document.question) ?? null;
      return { text: JSON.stringify({ answer, confidence: 0.9, note: 'known fact' }) };
    }
    const task = TASKS.find(([marker]) => request.body.system.includes(marker));
    if (!task) throw new Error('unknown audit task');
    const good = GOOD[task[1]]!;
    return {
      text: `\`\`\`json\n${JSON.stringify({
        status: 'PASS',
        scores: good.scores,
        dimensions: good.dimensions,
        hardRejectReasons: [],
        reviewReasons: [],
        suggestedRewrite: null,
      })}\n\`\`\``,
    };
  };
}
