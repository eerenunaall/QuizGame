import { useState, type ReactNode } from 'react';
import { adminText, type AdminKey } from '@quizparty/i18n';
import { errorText } from './api';

export const t = adminText;

/** Admin copy by a runtime-built key (statuses, outcomes…); unknown values fall back to the raw code. */
export function label(prefix: string, value: string): string {
  const key = `${prefix}.${value}`;
  return key in ADMIN_KEYS ? adminText(key as AdminKey) : value;
}
import { adminTr } from '@quizparty/i18n';
const ADMIN_KEYS: Record<string, true> = Object.fromEntries(
  Object.keys(adminTr).map((key) => [key, true]),
);

export function Loading(): ReactNode {
  return <p className="muted">{t('admin.loading')}</p>;
}

export function ErrorNote({ message }: { message: string | null }): ReactNode {
  return message ? (
    <p role="alert" className="note error" data-testid="error">
      {message}
    </p>
  ) : null;
}

export function Ok({ message }: { message: string | null }): ReactNode {
  return message ? (
    <p role="status" className="note ok" data-testid="ok">
      {message}
    </p>
  ) : null;
}

export function Pager({
  total,
  offset,
  limit,
  onChange,
}: {
  total: number;
  offset: number;
  limit: number;
  onChange: (offset: number) => void;
}): ReactNode {
  if (total <= limit) return null;
  return (
    <nav className="pager" aria-label="pager">
      <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        {t('admin.previous')}
      </button>
      <span>
        {t('admin.page', { from: offset + 1, to: Math.min(total, offset + limit), total })}
      </span>
      <button disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        {t('admin.next')}
      </button>
    </nav>
  );
}

export const when = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function Badge({ tone, children }: { tone?: string; children: ReactNode }): ReactNode {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export const statusTone = (status: string): string =>
  status === 'ACTIVE' || status === 'APPROVED'
    ? 'good'
    : status === 'REJECTED' || status === 'RETIRED'
      ? 'bad'
      : status === 'REVIEW'
        ? 'warn'
        : '';

/**
 * Runs an action, shows its result line, and refuses to run twice at once. `confirmText` asks
 * first for the actions that cannot be taken back.
 */
export function useAction(): {
  busy: boolean;
  error: string | null;
  ok: string | null;
  run: (action: () => Promise<string | void>, confirmText?: string) => Promise<boolean>;
  clear: () => void;
} {
  const [state, setState] = useState<{ busy: boolean; error: string | null; ok: string | null }>({
    busy: false,
    error: null,
    ok: null,
  });
  return {
    ...state,
    clear: () => setState({ busy: false, error: null, ok: null }),
    run: async (action, confirmText) => {
      if (state.busy) return false;
      if (confirmText && !window.confirm(confirmText)) return false;
      setState({ busy: true, error: null, ok: null });
      try {
        const message = await action();
        setState({ busy: false, error: null, ok: message ?? null });
        return true;
      } catch (error) {
        setState({ busy: false, error: errorText(error), ok: null });
        return false;
      }
    },
  };
}
