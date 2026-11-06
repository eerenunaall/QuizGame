import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from './api';

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Runs `load` whenever `key` changes; ignores answers that arrive after a newer request started. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadRef
      .current()
      .then((data) => {
        if (current) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (current) setState((s) => ({ data: s.data, error: errorText(error), loading: false }));
      });
    return () => {
      current = false;
    };
  }, [key, tick]);
  return { ...state, reload: useCallback(() => setTick((n) => n + 1), []) };
}

export interface Route {
  segments: string[];
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const [path = '', search = ''] = hash.replace(/^#\/?/u, '').split('?');
  return { segments: path.split('/').filter(Boolean), query: new URLSearchParams(search) };
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const listener = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  return parseHash(hash);
}

export function go(path: string): void {
  window.location.hash = `#/${path.replace(/^\//u, '')}`;
}
