/** Runtime endpoints. Same-origin by default (the realtime server serves this app); env overrides for split deployments. */
export interface Endpoints {
  /** Base URL of the HTTP API ('' = same origin). */
  apiUrl: string;
  /** Full WebSocket URL. */
  wsUrl: string;
}

export interface LocationLike {
  protocol: string;
  host: string;
}

export interface EnvLike {
  VITE_API_URL?: string | undefined;
  VITE_WS_URL?: string | undefined;
}

export function resolveEndpoints(location: LocationLike, env: EnvLike = {}): Endpoints {
  const apiUrl = (env.VITE_API_URL ?? '').replace(/\/+$/u, '');
  const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = env.VITE_WS_URL ?? `${wsScheme}://${location.host}/ws`;
  return { apiUrl, wsUrl };
}

export const APP_VERSION = '0.1.0';

/** The only place the brand name lives for non-localised surfaces (page titles come from i18n). */
export const BRAND_NAME = 'Quiz Party';
