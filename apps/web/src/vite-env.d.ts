/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the HTTP API when it is not served from the same origin. */
  readonly VITE_API_URL?: string;
  /** Full WebSocket URL when it is not served from the same origin. */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
