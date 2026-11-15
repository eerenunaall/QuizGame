/* eslint-disable @typescript-eslint/no-explicit-any -- the TV and host views are inspected loosely by the tests */
import type { Command, QuizConfig } from '@quizparty/quiznight';
import { call } from './payments';
import type { TestServer } from './server';

/** Quiz night fixtures (ADR-0029): a small valid night with recognisable secrets in its answers. */
export function nightConfig(
  over: Partial<QuizConfig['settings']> = {},
  withFinal = false,
): QuizConfig {
  const q = (id: string, points: number) => ({
    id,
    text: `Soru ${id}?`,
    options: ['Bir', 'Iki', 'Uc', 'Dort'],
    answer: { type: 'OPTION' as const, index: 2 },
    explanation: `ACIKLAMA-${id}`,
    points,
    jokerAllowed: true,
  });
  return {
    title: 'Cuma Quiz Gecesi',
    date: '2026-11-13',
    rounds: [
      {
        id: 'r1',
        kind: 'NORMAL',
        title: 'Genel kültür',
        questions: [q('a', 1), q('b', 1), q('c', 2)],
      },
      {
        id: 'r2',
        kind: 'ESTIMATE',
        title: 'Tahmin',
        questions: [
          {
            id: 'e',
            text: 'Kaç gün?',
            answer: { type: 'NUMBER', value: 365 },
            explanation: 'ACIKLAMA-e',
            points: 3,
            jokerAllowed: false,
          },
        ],
      },
    ],
    tieBreak: null,
    ...(withFinal
      ? {
          finalWager: {
            category: 'FINAL-KATEGORI',
            question: {
              id: 'fin',
              text: 'Final sorusu?',
              options: ['Bir', 'Iki', 'Uc', 'Dort'],
              answer: { type: 'OPTION' as const, index: 1 },
              explanation: 'ACIKLAMA-final',
              points: 0,
              jokerAllowed: false,
            },
          },
        }
      : {}),
    teams: [1, 2, 3].map((n) => ({
      id: `t${n}`,
      name: `Takım ${n}`,
      badge: { color: '#e4572e', emoji: '🦁' },
      table: n,
    })),
    settings: {
      jokersPerTeam: 2,
      wrongDoublePenalty: false,
      timerSec: 30,
      halfTimeAfterRound: 0,
      entranceText: 'Giriş 100 TL',
      prizeText: 'Bedava çay',
      ...over,
    },
  };
}

interface HostLike {
  seq: number;
  step: { kind: string; round?: number; q?: number } | null;
  podiumReached: boolean;
  winnerTeamIds: string[];
  [k: string]: unknown;
}

/** The owner's quiz night calls, as a bearer-token client. */
export function nightApi(server: TestServer, who: { token: string } | null, venueId: string) {
  const base = `/v1/venues/${venueId}/quiznights`;
  const send = <T = Record<string, any>>(method: string, path: string, body?: unknown) =>
    call<T>(server, method, path, {
      cookies: false,
      ...(who ? { token: who.token } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  return {
    base,
    list: () => send('GET', base),
    create: (config: QuizConfig = nightConfig()) => send('POST', base, config),
    detail: (id: string) => send('GET', `${base}/${id}`),
    saveConfig: (id: string, config: unknown) => send('POST', `${base}/${id}/config`, config),
    remove: (id: string) => send('POST', `${base}/${id}/delete`, {}),
    state: (id: string) => send<{ host: HostLike }>('GET', `${base}/${id}/state`),
    command: (id: string, cmd: Command | Record<string, unknown>, expectedSeq?: number) =>
      send<{ host: HostLike; seq: number; error?: { code: string; params?: { reason?: string } } }>(
        'POST',
        `${base}/${id}/command`,
        { cmd, ...(expectedSeq !== undefined ? { expectedSeq } : {}) },
      ),
    log: (id: string) => send('GET', `${base}/${id}/log`),
    link: (id: string) =>
      send<{ url: string; expiresAt: number }>('POST', `${base}/${id}/links`, {}),
    revoke: (id: string) => send('POST', `${base}/${id}/links/revoke`, {}),
    reward: (id: string, body: Record<string, unknown> = {}) =>
      send<{
        code?: string;
        teamName?: string;
        text?: string;
        error?: { code: string; params?: { reason?: string } };
      }>('POST', `${base}/${id}/reward`, body),
    redeem: (code: string) =>
      send<{ text?: string; winner?: string; error?: { code: string } }>(
        'POST',
        `${base}/rewards/redeem`,
        { code },
      ),
  };
}

/** What the TV fetches with its display link. */
export async function tvFrame(server: TestServer, url: string) {
  const token = new URL(url).searchParams.get('l')!;
  return call<{ view?: any }>(server, 'GET', `/v1/quiznight/tv?l=${encodeURIComponent(token)}`, {
    cookies: false,
  });
}
export const tvFrameByToken = (server: TestServer, token: string) =>
  call<{ view?: any }>(server, 'GET', `/v1/quiznight/tv?l=${encodeURIComponent(token)}`, {
    cookies: false,
  });
