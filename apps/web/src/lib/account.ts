/**
 * The few account calls the web app makes (sign-in by emailed code, linking a TV room). Same-origin
 * cookie session; every request carries the CSRF header the server insists on for cookie callers.
 */
export class AccountApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly params: Record<string, string | number>;
  constructor(status: number, code: string, params: Record<string, string | number> = {}) {
    super(`${status} ${code}`);
    this.name = 'AccountApiError';
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

export interface AccountView {
  id: string;
  email: string | null;
  roles: string[];
  sessionKind: string;
}

async function call<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
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

export const accountApi = {
  me: () => call<{ account: AccountView }>('/v1/me', 'GET').then((r) => r.account),
  requestCode: (email: string, locale: 'tr' | 'en') =>
    call<{ ok: true }>('/v1/auth/email/request', 'POST', { email, locale }),
  verifyCode: (email: string, code: string) =>
    call<{ account: AccountView }>('/v1/auth/email/verify', 'POST', {
      email,
      code,
      client: 'WEB',
    }).then((r) => r.account),
  logout: () => call<{ ok: true }>('/v1/auth/logout', 'POST', {}),
  peekLink: (token: string) =>
    call<{
      roomCode: string;
      tier: 'FREE' | 'FULL';
      mode: string;
      /** Who Said It is on for this build (it needs no quiz of the account's). */
      whoSaidIt?: boolean;
      quizzes: { id: string; kind: QuizKind; title: string; ready: boolean }[];
    }>(`/v1/link-intents/${encodeURIComponent(token)}`, 'GET'),
  claimLink: (token: string) =>
    call<{ roomCode: string; tier: 'FREE' | 'FULL' }>(
      `/v1/link-intents/${encodeURIComponent(token)}/claim`,
      'POST',
      {},
    ),
  attachQuiz: (token: string, quizId: string | null) =>
    call<{ mode: string; title: string | null }>(
      `/v1/link-intents/${encodeURIComponent(token)}/quiz`,
      'POST',
      { quizId },
    ),
  attachWhoSaidIt: (token: string) =>
    call<{ mode: string; title: string | null }>(
      `/v1/link-intents/${encodeURIComponent(token)}/quiz`,
      'POST',
      { mode: 'WHO_SAID_IT' },
    ),

  // ───────────── personal quizzes (creator) ─────────────
  quizzes: () => call<{ items: QuizSummary[]; catalog: string[] }>('/v1/quizzes', 'GET'),
  createQuiz: (kind: QuizKind, title: string, language: 'tr' | 'en') =>
    call<QuizSummary>('/v1/quizzes', 'POST', { kind, title, language }),
  quiz: (id: string) => call<QuizDetail>(`/v1/quizzes/${id}`, 'GET'),
  deleteQuiz: (id: string) => call<{ ok: true }>(`/v1/quizzes/${id}`, 'DELETE'),
  addPrompt: (id: string, prompt: { catalogKey: string } | { text: string }) =>
    call<{ id: string }>(`/v1/quizzes/${id}/prompts`, 'POST', prompt),
  removePrompt: (id: string, promptId: string) =>
    call<{ ok: true }>(`/v1/quizzes/${id}/prompts/${promptId}`, 'DELETE'),
  addTarget: (id: string, displayName: string) =>
    call<{ id: string; inviteUrl: string }>(`/v1/quizzes/${id}/targets`, 'POST', { displayName }),
  rotateInvite: (id: string, targetId: string) =>
    call<{ inviteUrl: string }>(`/v1/quizzes/${id}/targets/${targetId}/invite`, 'POST', {}),
  removeTarget: (id: string, targetId: string) =>
    call<{ ok: true }>(`/v1/quizzes/${id}/targets/${targetId}`, 'DELETE'),
  addQuestion: (
    id: string,
    question: { text: string; options: string[]; correctIndex: number; explanation?: string },
  ) => call<{ id: string }>(`/v1/quizzes/${id}/questions`, 'POST', question),
  removeQuestion: (id: string, questionId: string) =>
    call<{ ok: true }>(`/v1/quizzes/${id}/questions/${questionId}`, 'DELETE'),

  // ───────────── the person who answers (invite token, no account) ─────────────
  respondView: (token: string) => call<RespondView>(`/v1/blind/respond/${token}`, 'GET'),
  respondConsent: (token: string) =>
    call<{ ok: true }>(`/v1/blind/respond/${token}/consent`, 'POST', {}),
  respondPut: (token: string, promptId: string, answer: string, decoys: string[]) =>
    call<{ ok: true }>(`/v1/blind/respond/${token}/prompts/${promptId}`, 'PUT', { answer, decoys }),
  respondApproval: (token: string, promptId: string, approved: boolean) =>
    call<{ ok: true }>(`/v1/blind/respond/${token}/prompts/${promptId}/approval`, 'POST', {
      approved,
    }),
  respondDelete: (token: string) => call<{ ok: true }>(`/v1/blind/respond/${token}`, 'DELETE'),
};

export type QuizKind = 'BLIND' | 'CUSTOM';
export interface QuizSummary {
  id: string;
  kind: QuizKind;
  title: string;
  language: 'tr' | 'en';
  createdAt: string;
  retainUntil: string;
  ready: boolean;
}
export interface QuizDetail extends QuizSummary {
  prompts: { id: string; position: number; catalogKey: string | null; text: string | null }[];
  targets: {
    id: string;
    displayName: string;
    status: 'PENDING' | 'ANSWERED' | 'APPROVED';
    answered: number;
    approved: number;
    total: number;
  }[];
  questions: {
    id: string;
    text: string;
    options: string[];
    correctIndex: number;
    explanation: string | null;
  }[];
}
export interface RespondView {
  quiz: { title: string; language: 'tr' | 'en' };
  target: { name: string; consented: boolean };
  prompts: {
    promptId: string;
    position: number;
    source: 'CATALOG' | 'CUSTOM';
    catalogKey: string | null;
    text: string | null;
    response: { answer: string; decoys: string[]; approved: boolean } | null;
  }[];
}
