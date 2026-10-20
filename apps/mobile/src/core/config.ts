/** Runtime configuration, read once from `app.config.ts` → `extra` (public identifiers only). */
export interface AppConfig {
  apiUrl: string;
  wsUrl: string;
  webUrl: string;
  /** Hosts whose https links the app accepts (universal / app links). */
  webHosts: string[];
  /** The store product id of the one non-consumable (ADR-0013). */
  productId: string;
  version: string;
}

const str = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value !== '' ? value.replace(/\/+$/, '') : fallback;

export function resolveAppConfig(extra: unknown, version = '0.0.0'): AppConfig {
  const record = (typeof extra === 'object' && extra !== null ? extra : {}) as Record<
    string,
    unknown
  >;
  const apiUrl = str(record.apiUrl, 'http://localhost:8080');
  const webUrl = str(record.webUrl, apiUrl);
  const wsUrl = str(record.wsUrl, `${apiUrl.replace(/^http/, 'ws')}/ws`);
  let host = '';
  try {
    host = new URL(webUrl).host.toLowerCase();
  } catch {
    // a malformed URL simply accepts no https links
  }
  return {
    apiUrl,
    wsUrl,
    webUrl,
    webHosts: host ? [host] : [],
    productId: str(record.productId, 'quizparty_full_game'),
    version,
  };
}
