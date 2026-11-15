import type { Command, HostView, LogEvent, QuizConfig, TvView } from '@quizparty/quiznight';
import { AccountApiError } from '../../lib/account';

/** The Quiz Gecesi calls (ADR-0029). Same-origin cookie session; writes carry the CSRF header. */
export type NightStatus = 'DRAFT' | 'READY' | 'LIVE' | 'FINISHED';
export interface NightSummary {
  id: string;
  title: string;
  date: string;
  status: NightStatus;
  rounds: number;
  questions: number;
  teams: number;
}
export interface NightDetail extends NightSummary {
  config: QuizConfig;
  issues: { issue: string; where?: string }[];
  host: HostView;
  reward: { teamName: string; text: string; issuedAt: number; redeemedAt: number | null } | null;
}

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'x-quizparty-csrf': '1',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; params?: Record<string, string | number> };
    } | null;
    throw new AccountApiError(
      response.status,
      payload?.error?.code ?? 'INTERNAL',
      payload?.error?.params,
    );
  }
  return (await response.json()) as T;
}

const base = (venueId: string): string => `/v1/venues/${encodeURIComponent(venueId)}/quiznights`;

export const nightsApi = {
  list: (venueId: string) => call<{ nights: NightSummary[] }>(base(venueId), 'GET'),
  create: (venueId: string, config: QuizConfig) =>
    call<{ night: NightDetail }>(base(venueId), 'POST', config),
  detail: (venueId: string, id: string) =>
    call<{ night: NightDetail }>(`${base(venueId)}/${id}`, 'GET'),
  saveConfig: (venueId: string, id: string, config: QuizConfig) =>
    call<{ night: NightDetail }>(`${base(venueId)}/${id}/config`, 'POST', config),
  remove: (venueId: string, id: string) =>
    call<{ ok: true }>(`${base(venueId)}/${id}/delete`, 'POST', {}),
  state: (venueId: string, id: string) =>
    call<{ host: HostView }>(`${base(venueId)}/${id}/state`, 'GET'),
  command: (venueId: string, id: string, cmd: Command, expectedSeq?: number) =>
    call<{ host: HostView; seq: number }>(`${base(venueId)}/${id}/command`, 'POST', {
      cmd,
      ...(expectedSeq !== undefined ? { expectedSeq } : {}),
    }),
  log: (venueId: string, id: string) =>
    call<{ events: LogEvent[] }>(`${base(venueId)}/${id}/log`, 'GET'),
  link: (venueId: string, id: string) =>
    call<{ url: string; expiresAt: number }>(`${base(venueId)}/${id}/links`, 'POST', {}),
  revoke: (venueId: string, id: string) =>
    call<{ revoked: number }>(`${base(venueId)}/${id}/links/revoke`, 'POST', {}),
  reward: (venueId: string, id: string, teamId?: string) =>
    call<{ code: string; teamName: string; text: string; expiresAt: number }>(
      `${base(venueId)}/${id}/reward`,
      'POST',
      teamId ? { teamId } : {},
    ),
  /** The venue's own question pool (ADR-0025, the owner's CSV export) for the "pick from the pool" dialog. */
  pool: async (venueId: string): Promise<PoolQuestion[]> => {
    const response = await fetch(`/v1/venues/${encodeURIComponent(venueId)}/questions/export`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return [];
    return parsePoolCsv(await response.text());
  },
  tv: async (token: string): Promise<{ view: TvView & { venueName: string } } | null> => {
    const response = await fetch(`/v1/quiznight/tv?l=${encodeURIComponent(token)}`, {
      credentials: 'omit',
      cache: 'no-store',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new AccountApiError(response.status, 'INTERNAL');
    return (await response.json()) as { view: TvView & { venueName: string } };
  },
};

export interface PoolQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string | undefined;
  category?: string | undefined;
}

/** Minimal CSV reader (quotes, doubled quotes, newlines inside cells) for the pool export. */
export function parsePoolCsv(text: string): PoolQuestion[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/u, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const out: PoolQuestion[] = [];
  for (const r of rows.slice(1)) {
    const options = r.slice(3, 9).filter((x) => x !== '');
    const correct = 'ABCDEF'.indexOf(r[9] ?? '');
    if (!r[2] || options.length < 2 || correct < 0 || correct >= options.length) continue;
    out.push({
      question: r[2],
      options,
      correctIndex: correct,
      ...(r[10] ? { explanation: r[10] } : {}),
      ...(r[0] ? { category: r[0] } : {}),
    });
  }
  return out;
}
