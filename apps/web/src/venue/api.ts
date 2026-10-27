import { AccountApiError } from '../lib/account';

/** The staff page's calls (ADR-0024). Same-origin cookie session; writes carry the CSRF header. */
export type StaffRole = 'OWNER' | 'STAFF';

export interface StaffTable {
  id: string;
  roomCode: string;
  state: 'RUNNING' | 'PAUSED' | 'ENDED';
  remainingMs: number;
  endsAt: number | null;
  purchasedMinutes: number;
  startedAt: number;
  timeUp: boolean;
  roomLive: boolean;
}

export interface VenueSettingsView {
  reward: {
    enabled: boolean;
    text: string;
    minPlayers: number;
    maxPerDay: number;
    rematchCooldownMinutes: number;
  };
  /** How a table starts (ADR-0026 §7); absent from an older server. */
  play?: {
    defaultMode: 'INDIVIDUAL' | 'TEAMS';
    simpleRuleset: boolean;
    teamNames: string[];
    simpleAnswerSeconds: number | null;
  };
  defaultMinutes: number;
  extendSteps: number[];
  timezone: string;
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

export const venueApi = {
  mine: () =>
    call<{ venues: { id: string; name: string; role: StaffRole }[] }>('/v1/venue/me', 'GET'),
  tables: (venueId: string) =>
    call<{
      serverTime: number;
      items: StaffTable[];
      role: StaffRole;
      steps: number[];
      defaultMinutes: number;
    }>(`${v(venueId)}/sessions`, 'GET'),
  open: (venueId: string, minutes: number, target: { roomCode: string } | { link: string }) =>
    call<StaffTable>(`${v(venueId)}/sessions`, 'POST', { minutes, ...target }),
  extend: (venueId: string, id: string, minutes: number) =>
    call<StaffTable>(`${v(venueId)}/sessions/${id}/extend`, 'POST', { minutes }),
  pause: (venueId: string, id: string) =>
    call<StaffTable>(`${v(venueId)}/sessions/${id}/pause`, 'POST', {}),
  resume: (venueId: string, id: string) =>
    call<StaffTable>(`${v(venueId)}/sessions/${id}/resume`, 'POST', {}),
  end: (venueId: string, id: string) =>
    call<StaffTable>(`${v(venueId)}/sessions/${id}/end`, 'POST', {}),
  redeem: (venueId: string, code: string) =>
    call<{ text: string; winner: string; issuedAt: number; redeemedAt: number }>(
      `${v(venueId)}/rewards/redeem`,
      'POST',
      { code },
    ),
  settings: (venueId: string) =>
    call<{ settings: VenueSettingsView; role: StaffRole }>(`${v(venueId)}/settings`, 'GET'),
  saveSettings: (venueId: string, patch: Partial<VenueSettingsView>) =>
    call<{ settings: VenueSettingsView }>(`${v(venueId)}/settings`, 'POST', patch),
  staff: (venueId: string) =>
    call<{ staff: { accountId: string; email: string | null; role: StaffRole }[] }>(
      `${v(venueId)}/staff`,
      'GET',
    ),
  invite: (venueId: string, email: string) =>
    call<{ accountId: string }>(`${v(venueId)}/staff`, 'POST', { email }),
  remove: (venueId: string, accountId: string) =>
    call<{ ok: true }>(`${v(venueId)}/staff/${accountId}/remove`, 'POST', {}),
};
