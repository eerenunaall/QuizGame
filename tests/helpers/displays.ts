import type { TestServer } from './server';
import { call } from './payments';

/**
 * A TV browser as the server sees it (ADR-0028): its own cookie jar (HttpOnly cookies are only ever
 * replayed, never read by page code), and the Origin header a browser sends on every POST.
 */
export class TvBrowser {
  readonly jar = new Map<string, string>();
  origin: string | null;

  constructor(
    private readonly server: TestServer,
    origin: string | null = 'http://localhost:5173',
  ) {
    this.origin = origin;
  }

  async send<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T; setCookies: string[] }> {
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await fetch(`${this.server.httpUrl}${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(this.origin ? { origin: this.origin } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const setCookies = response.headers.getSetCookie();
    for (const line of setCookies) {
      const [pair = ''] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/max-age=0/iu.test(line) || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T, setCookies };
  }

  startPairing() {
    return this.send<{ code: string; expiresAt: number; pairUrl: string }>(
      'POST',
      '/v1/display/pairing',
      {},
    );
  }

  poll() {
    return this.send<{
      lock: boolean;
      paired: boolean;
      pairing?: { expiresAt: number } | null;
      display?: { name: string };
      delivery?: {
        roomId: string;
        code: string;
        joinUrl: string;
        display: { sessionId: string; reconnectToken: string };
      };
    }>('POST', '/v1/display/poll', {});
  }

  createRoom() {
    return this.send<{ code: string; roomId: string; display: { sessionId: string } }>(
      'POST',
      '/v1/rooms',
      { client: { kind: 'DISPLAY', version: 'test' } },
    );
  }

  get credential(): string | null {
    return this.jar.get('qp_display') ?? null;
  }
}

/** The panel's display calls, as a bearer-token client (the guard's CSRF rule is tested separately). */
export function displayApi(server: TestServer, who: { token: string } | null, venueId: string) {
  const base = `/v1/venues/${venueId}/displays`;
  const send = <T = Record<string, unknown>>(method: string, path: string, body?: unknown) =>
    call<T>(server, method, path, {
      cookies: false,
      ...(who ? { token: who.token } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  return {
    list: () =>
      send<{
        items: { id: string; name: string; online: boolean; roomCode: string | null }[];
        seats: number;
        error?: { code: string };
      }>('GET', base),
    pair: (code: string, name = 'Salon TV') =>
      send<{ id: string; name: string; error?: { code: string } }>('POST', `${base}/pair`, {
        code,
        name,
      }),
    open: (displayId: string, minutes?: number) =>
      send<{
        roomCode: string;
        created: boolean;
        table: { id: string } | null;
        error?: { code: string; params?: Record<string, string> };
      }>('POST', `${base}/${displayId}/open`, minutes === undefined ? {} : { minutes }),
    revoke: (displayId: string) =>
      send<{ ok?: true; error?: { code: string } }>('POST', `${base}/${displayId}/revoke`, {}),
  };
}

/** Pairs a fresh TV to the venue through the real flow; returns the TV and its display id. */
export async function pairTv(
  server: TestServer,
  owner: { token: string },
  venueId: string,
  name = 'Salon TV 1',
): Promise<{ tv: TvBrowser; displayId: string }> {
  const tv = new TvBrowser(server);
  const started = await tv.startPairing();
  if (started.status !== 201) throw new Error(`pairing failed: ${started.status}`);
  const claimed = await displayApi(server, owner, venueId).pair(started.body.code, name);
  if (claimed.status !== 201) throw new Error(`claim failed: ${JSON.stringify(claimed.body)}`);
  const polled = await tv.poll();
  if (!polled.body.paired) throw new Error('the TV did not receive its credential');
  return { tv, displayId: claimed.body.id };
}
