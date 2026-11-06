import { AccountApiError } from '../lib/account';

/** The venue question sets' calls (ADR-0025). Same-origin cookie session; writes carry the CSRF header. */
export interface VenueIssue {
  field: string;
  code: string;
  params?: Record<string, string | number>;
}
export type RowStatus = 'OK' | 'REVIEW' | 'REJECT' | 'INVALID' | 'DUPLICATE' | 'FULL';
export interface RowReport {
  line: number;
  status: RowStatus;
  preview: string;
  category: string | null;
  issues: VenueIssue[];
}
export interface Analysis {
  ok: true;
  fileName: string;
  warnings: VenueIssue[];
  alreadyImported: { uploadId: string; uploadedAt: string; imported: number } | null;
  counts: {
    total: number;
    ok: number;
    review: number;
    reject: number;
    invalid: number;
    duplicate: number;
    full: number;
  };
  categories: { id: string; label: string; isNew: boolean; count: number }[];
  rows: RowReport[];
  rowsOmitted: number;
  sample: RowReport[];
  batch: { code: string }[];
}
export type Report = Analysis | { ok: false; issue: VenueIssue };
export type ImportResult =
  | { analysis: Analysis; uploadId: string | null; imported: number }
  | { ok: false; issue: VenueIssue };

export interface UploadSummary {
  id: string;
  fileName: string;
  uploadedAt: string;
  rowsImported: number;
  state: 'ACTIVE' | 'RETIRED';
  active: number;
}
export interface SetSummary {
  role: 'OWNER' | 'STAFF';
  canManage: boolean;
  uploads: UploadSummary[];
  totals: { active: number; review: number; retired: number; max: number };
  categories: { id: string; label: string; active: number }[];
}
export interface ReportItem {
  id: string;
  questionId: string;
  reason: string;
  questionText: string;
}

async function request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> {
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
  return response;
}
const call = async <T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> =>
  (await (await request(path, method, body)).json()) as T;

const base = (venueId: string): string => `/v1/venues/${encodeURIComponent(venueId)}/questions`;

/** Bytes of a file or pasted text as base64 (the server decodes UTF-8, Windows-1254 or UTF-16 itself). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const questionsApi = {
  summary: (venueId: string) => call<SetSummary>(base(venueId), 'GET'),
  dryRun: (venueId: string, fileName: string, bytes: Uint8Array) =>
    call<Report>(`${base(venueId)}/dry-run`, 'POST', { fileName, data: toBase64(bytes) }),
  import: (venueId: string, fileName: string, bytes: Uint8Array) =>
    call<ImportResult>(`${base(venueId)}/import`, 'POST', { fileName, data: toBase64(bytes) }),
  retire: (venueId: string, uploadId: string) =>
    call<{ retired: number }>(`${base(venueId)}/uploads/${uploadId}/retire`, 'POST', {}),
  prompt: async (venueId: string, format: 'csv' | 'jsonl') =>
    (await call<{ prompt: string }>(`${base(venueId)}/prompt?format=${format}`, 'GET')).prompt,
  text: async (venueId: string, path: 'template?format=csv' | 'template?format=jsonl' | 'export') =>
    (await request(`${base(venueId)}/${path}`, 'GET')).text(),
  reports: (venueId: string) => call<{ items: ReportItem[] }>(`${base(venueId)}/reports`, 'GET'),
  resolve: (venueId: string, reportId: string, action: 'DISMISS' | 'RETIRE') =>
    call<{ ok: true }>(`${base(venueId)}/reports/${reportId}/resolve`, 'POST', { action }),
  settings: (venueId: string) =>
    call<{ settings: { questions: { source: string; venueSharePercent: number } } }>(
      `/v1/venues/${encodeURIComponent(venueId)}/settings`,
      'GET',
    ),
  saveSource: (venueId: string, questions: { source: string; venueSharePercent: number }) =>
    call<unknown>(`/v1/venues/${encodeURIComponent(venueId)}/settings`, 'POST', { questions }),
};
