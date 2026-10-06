import type { KeyValueStorage } from '@quizparty/controller-client';

/**
 * localStorage that never throws: private windows, blocked site data and storage-less embedded
 * browsers fall back to memory for the life of the page (the game still works, it just forgets).
 */
export function createStorage(
  backing: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = browserStorage(),
): KeyValueStorage {
  const memory = new Map<string, string>();
  return {
    get(key) {
      try {
        const value = backing?.getItem(key);
        if (value !== undefined && value !== null) return value;
      } catch {
        // fall through to memory
      }
      return memory.get(key) ?? null;
    },
    set(key, value) {
      memory.set(key, value);
      try {
        backing?.setItem(key, value);
      } catch {
        // quota or privacy mode: memory copy remains
      }
    },
    remove(key) {
      memory.delete(key);
      try {
        backing?.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // accessing localStorage itself can throw
  }
}

export interface Preferences {
  /** 0–1 master volume for synthesized sounds. */
  volume: number;
  muted: boolean;
  /** Overrides the browser language. */
  locale: 'tr' | 'en' | null;
}

const PREFS_KEY = 'qp.prefs';
export const DEFAULT_PREFS: Preferences = { volume: 0.7, muted: false, locale: null };

export function loadPreferences(storage: KeyValueStorage): Preferences {
  try {
    const raw = storage.get(PREFS_KEY);
    if (typeof raw !== 'string') return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      volume:
        typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : DEFAULT_PREFS.volume,
      muted: parsed.muted === true,
      locale: parsed.locale === 'tr' || parsed.locale === 'en' ? parsed.locale : null,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePreferences(storage: KeyValueStorage, prefs: Preferences): void {
  void Promise.resolve(storage.set(PREFS_KEY, JSON.stringify(prefs))).catch(() => undefined);
}
