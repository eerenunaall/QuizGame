import { describe, expect, it } from 'vitest';
import { createStorage, DEFAULT_PREFS, loadPreferences, savePreferences } from './storage';

const throwing = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
  setItem: (): void => {
    throw new Error('quota');
  },
  removeItem: (): void => {
    throw new Error('blocked');
  },
};

function memoryBacking() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('createStorage', () => {
  it('reads and writes through the backing store', () => {
    const backing = memoryBacking();
    const storage = createStorage(backing);
    void storage.set('a', '1');
    expect(backing.data.get('a')).toBe('1');
    expect(storage.get('a')).toBe('1');
    void storage.remove('a');
    expect(backing.data.has('a')).toBe(false);
    expect(storage.get('a')).toBeNull();
  });

  it('never throws when the browser blocks storage and keeps values in memory', () => {
    const storage = createStorage(throwing);
    expect(() => void storage.set('k', 'v')).not.toThrow();
    expect(storage.get('k')).toBe('v');
    expect(() => void storage.remove('k')).not.toThrow();
    expect(storage.get('k')).toBeNull();
  });

  it('works without any backing store at all', () => {
    const storage = createStorage(null);
    void storage.set('k', 'v');
    expect(storage.get('k')).toBe('v');
  });
});

describe('preferences', () => {
  it('round-trips valid values', () => {
    const storage = createStorage(memoryBacking());
    savePreferences(storage, { volume: 0.25, muted: true, locale: 'en' });
    expect(loadPreferences(storage)).toEqual({ volume: 0.25, muted: true, locale: 'en' });
  });

  it('falls back to defaults for missing, corrupt or out-of-range data', () => {
    const storage = createStorage(memoryBacking());
    expect(loadPreferences(storage)).toEqual(DEFAULT_PREFS);
    void storage.set('qp.prefs', '{not json');
    expect(loadPreferences(storage)).toEqual(DEFAULT_PREFS);
    void storage.set('qp.prefs', JSON.stringify({ volume: 7, muted: 'yes', locale: 'de' }));
    expect(loadPreferences(storage)).toEqual({
      volume: DEFAULT_PREFS.volume,
      muted: false,
      locale: null,
    });
  });
});
