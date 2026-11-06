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
