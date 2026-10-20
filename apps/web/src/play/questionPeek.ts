import { useCallback, useState } from 'react';
import type { KeyValueStorage } from '@quizparty/controller-client';
import { loadPreferences, savePreferences } from '../lib/storage';

export interface PeekEnv {
  VITE_PHONE_SHOWS_QUESTION?: string | undefined;
}

/**
 * Build default for "does the phone show the question text?". Off: the TV is the stage and the
 * phone only carries the answers; a venue that wants the old behaviour builds with
 * VITE_PHONE_SHOWS_QUESTION=1. A player's own choice (saved per device) always wins over it.
 */
export function phoneShowsQuestionDefault(env: PeekEnv = import.meta.env): boolean {
  const value = (env.VITE_PHONE_SHOWS_QUESTION ?? '').trim().toLowerCase();
  return value === '1' || value === 'true';
}

export function resolveShowQuestion(
  storage: KeyValueStorage,
  fallback: boolean = phoneShowsQuestionDefault(),
): boolean {
  return loadPreferences(storage).phoneShowsQuestion ?? fallback;
}

/** The "show question" switch of this device: read once, written through to `qp.prefs` on change. */
export function useShowQuestion(
  storage: KeyValueStorage,
  fallback: boolean = phoneShowsQuestionDefault(),
): readonly [boolean, (next: boolean) => void] {
  const [shown, setShown] = useState(() => resolveShowQuestion(storage, fallback));
  const set = useCallback(
    (next: boolean): void => {
      setShown(next);
      savePreferences(storage, { ...loadPreferences(storage), phoneShowsQuestion: next });
    },
    [storage],
  );
  return [shown, set];
}
