import { hasAdminKey, adminText } from '@quizparty/i18n';

/** An API answer that was not 2xx; `code` is the server's machine-readable error code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: Record<string, unknown> | undefined;

  constructor(status: number, code: string, detail: Record<string, unknown> | undefined) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Raw text body (file uploads are sent as JSON strings, never multipart). */
  signal?: AbortSignal;
}

let onUnauthorized: () => void = () => undefined;
/** The shell registers one handler: a 401 anywhere drops the console back to the sign-in form. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function url(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}))
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function failure(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; detail?: Record<string, unknown> };
  } | null;
  return new ApiError(response.status, body?.error?.code ?? 'INTERNAL', body?.error?.detail);
}

/**
 * Cookie-authenticated unsafe requests need the CSRF header (the server also checks Origin), so it is
 * sent on every call. Credentials never leave the same origin.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'x-quizparty-csrf': '1',
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  const response = await fetch(url(path, options.query), init);
  if (!response.ok) {
    const error = await failure(response);
    if (response.status === 401 && !path.startsWith('/v1/auth/')) onUnauthorized();
    throw error;
  }
  return (await response.json()) as T;
}

/** Fetches a text download (export files) with the same headers. */
export async function apiText(path: string, query?: Query): Promise<string> {
  const response = await fetch(url(path, query), {
    credentials: 'same-origin',
    headers: { 'x-quizparty-csrf': '1' },
  });
  if (!response.ok) {
    const error = await failure(response);
    if (response.status === 401) onUnauthorized();
    throw error;
  }
  return response.text();
}

const asList = (value: unknown): string =>
  Array.isArray(value) ? value.map(String).join(', ') : '';

/** A sentence for an error, from the admin copy, never the raw server text. */
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return adminText('admin.error.generic');
  const key = `admin.error.${error.code}`;
  if (!hasAdminKey(key)) return adminText('admin.error.generic');
  const detail = error.detail ?? {};
  return adminText(key, {
    fields: asList(detail.fields),
    codes: asList(detail.codes ?? detail.blockers),
    max: typeof detail.max === 'number' ? detail.max : '',
  });
}
