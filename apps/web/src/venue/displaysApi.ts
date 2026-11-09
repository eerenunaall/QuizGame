import { AccountApiError } from '../lib/account';

/** The panel's calls for TVs and the question studio (ADR-0028). Same-origin cookie session; writes carry the CSRF header. */
export interface DisplayItem {
  id: string;
  name: string;
  pairedAt: number;
  lastSeenAt: number | null;
  online: boolean;
  roomCode: string | null;
}
export interface ManualForm {
  category: string;
  question: string;
  options: string[];
  correctIndex: number;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT';
  explanation: string;
  sourceUrl: string;
}
export interface ManualAnswer {
  status: 'OK' | 'REVIEW' | 'REJECT' | 'INVALID' | 'DUPLICATE' | 'FULL';
  saved: boolean;
  issues: { field: string; code: string; params?: Record<string, string | number> }[];
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

const v = (venueId: string): string => `/v1/venues/${encodeURIComponent(venueId)}`;

export const displaysApi = {
  list: (venueId: string) =>
    call<{ items: DisplayItem[]; seats: number }>(`${v(venueId)}/displays`, 'GET'),
  pair: (venueId: string, code: string, name: string) =>
    call<DisplayItem>(`${v(venueId)}/displays/pair`, 'POST', { code, name }),
  open: (venueId: string, displayId: string, minutes?: number) =>
    call<{ roomCode: string; created: boolean }>(
      `${v(venueId)}/displays/${displayId}/open`,
      'POST',
      minutes === undefined ? {} : { minutes },
    ),
  remove: (venueId: string, displayId: string) =>
    call<{ ok: true }>(`${v(venueId)}/displays/${displayId}/revoke`, 'POST', {}),
};

export const studioApi = {
  manual: (venueId: string, mode: 'check' | 'save', form: ManualForm) =>
    call<ManualAnswer>(`${v(venueId)}/questions/manual`, 'POST', {
      mode,
      category: form.category,
      question: form.question,
      options: form.options,
      correctIndex: form.correctIndex,
      difficulty: form.difficulty,
      ...(form.explanation.trim() ? { explanation: form.explanation } : {}),
      ...(form.sourceUrl.trim() ? { sourceUrl: form.sourceUrl } : {}),
    }),
  categories: (venueId: string) =>
    call<{ categories: { id: string; label: string }[] }>(`${v(venueId)}/questions`, 'GET'),
};

// ───────────── documents to question drafts (ADR-0028 §6) ─────────────

export interface AuthoringState {
  enabled: boolean;
  quota: { limit: number; used: number; resetAt: number | null };
  limits: { maxBytes: number; maxPages: number; maxChars: number };
}
export interface AuthoringRun {
  id: string;
  status: 'RUNNING' | 'OK' | 'EMPTY' | 'FAILED';
  failure: 'unavailable' | 'rejected_key' | 'bad_output' | 'interrupted' | null;
  fileName: string;
  drafts: number;
  discarded: number;
}
export interface DraftPayload {
  category: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT';
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  sourceQuote: string;
  page: string;
}
export interface DraftItem {
  id: string;
  fileName: string;
  expiresAt: number;
  payload: DraftPayload;
}
export type DraftIssue = ManualAnswer['issues'][number];
export type DraftEditBody = Omit<DraftPayload, 'sourceQuote' | 'page'>;

/** Base64 of a file in slices: `btoa` over one huge string would copy a 10 MB file several times. */
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at < bytes.length; at += 0x8000)
    out += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(out);
}
const readFile = (file: File): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });

export const authoringApi = {
  state: (venueId: string) => call<AuthoringState>(`${v(venueId)}/authoring`, 'GET'),
  start: async (venueId: string, file: File, category: string) =>
    call<{ runId: string }>(`${v(venueId)}/authoring/runs`, 'POST', {
      fileName: file.name,
      data: toBase64(await readFile(file)),
      category,
    }),
  run: (venueId: string, runId: string) =>
    call<AuthoringRun>(`${v(venueId)}/authoring/runs/${encodeURIComponent(runId)}`, 'GET'),
  drafts: (venueId: string) =>
    call<{ items: DraftItem[] }>(`${v(venueId)}/authoring/drafts`, 'GET'),
  edit: (venueId: string, id: string, body: DraftEditBody) =>
    call<{ draft: DraftItem; issues: DraftIssue[] }>(
      `${v(venueId)}/authoring/drafts/${encodeURIComponent(id)}`,
      'POST',
      body,
    ),
  remove: (venueId: string, id: string) =>
    call<{ ok: true }>(
      `${v(venueId)}/authoring/drafts/${encodeURIComponent(id)}/delete`,
      'POST',
      {},
    ),
  approve: (venueId: string, which: string[] | 'all') =>
    call<{ approved: number; problems: { id: string; issues: DraftIssue[] }[] }>(
      `${v(venueId)}/authoring/drafts/approve`,
      'POST',
      which === 'all' ? { all: true } : { ids: which },
    ),
};
