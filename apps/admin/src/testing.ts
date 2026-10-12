import { vi } from 'vitest';

export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
type Handler = (call: Call) => { status?: number; json?: unknown; text?: string } | undefined;

/** A stand-in for the network only: it answers with the server's real wire shapes. */
export function fakeServer(handler: Handler): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        path: input,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      const answer = handler(call) ?? { status: 404, json: { error: { code: 'NOT_FOUND' } } };
      const status = answer.status ?? 200;
      return Promise.resolve(
        new Response(answer.text ?? JSON.stringify(answer.json ?? {}), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return { calls };
}
