import { useEffect, useState } from 'react';

/**
 * Whether the server sells anything (`GET /v1/config`, ADR-0030 §6). `null` until known or when the
 * server cannot be asked: callers treat unknown like "off", because hiding a purchase surface is the safe
 * side and today's production runs without payments. The answer is read once per page load.
 */
let cached: Promise<boolean> | null = null;

export function readPaymentsEnabled(apiUrl: string): Promise<boolean> {
  cached ??= fetch(`${apiUrl}/v1/config`, { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error('config'))))
    .then((body: { paymentsEnabled?: unknown }) => body.paymentsEnabled === true)
    .catch(() => {
      cached = null;
      return false;
    });
  return cached;
}

/** Test seam: forget the remembered answer. */
export function resetPaymentsEnabled(): void {
  cached = null;
}

export function usePaymentsEnabled(apiUrl: string): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void readPaymentsEnabled(apiUrl).then((value) => {
      if (live) setEnabled(value);
    });
    return () => {
      live = false;
    };
  }, [apiUrl]);
  return enabled;
}
