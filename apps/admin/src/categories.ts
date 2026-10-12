import { api } from './api';
import { useLoad } from './hooks';

export interface CategoryRow {
  id: string;
  labelTr: string;
  labelEn: string;
  enabled: boolean;
  freeRotation: boolean;
  sourceRequired: boolean;
  sortOrder: number;
  questions: { total: number; active: number; review: number };
}

export function useCategories() {
  return useLoad(() => api<{ items: CategoryRow[] }>('/v1/admin/categories'), 'categories');
}
