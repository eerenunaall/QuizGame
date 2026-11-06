import { call } from './api';

export type BankScope = 'GLOBAL' | 'VENUE';

export interface BankQuestion {
  id: string;
  text: string;
  explanation: string | null;
  status: string;
  difficulty: string;
  category: string;
  options: { text: string; correct: boolean }[];
}

export interface BankPage {
  total: number;
  hasMore: boolean;
  items: BankQuestion[];
}

export interface BankCategory {
  id: string;
  label: string;
  count: number;
}

const base = (venueId: string): string => `/v1/venues/${encodeURIComponent(venueId)}/bank`;

/** The owner's answers view (ADR-0030 §5): read-only, the server fixes the scope and checks the role. */
export const bankApi = {
  categories: (venueId: string, scope: BankScope, language: 'tr' | 'en') =>
    call<{ categories: BankCategory[] }>(
      `${base(venueId)}/categories?scope=${scope}&language=${language}`,
      'GET',
    ),
  questions: (
    venueId: string,
    query: {
      scope: BankScope;
      language: 'tr' | 'en';
      q: string;
      category: string;
      offset: number;
    },
  ) => {
    const params = new URLSearchParams({
      scope: query.scope,
      language: query.language,
      offset: String(query.offset),
    });
    if (query.q.trim().length >= 2) params.set('q', query.q.trim());
    if (query.category) params.set('category', query.category);
    return call<BankPage>(`${base(venueId)}/questions?${params.toString()}`, 'GET');
  },
};
