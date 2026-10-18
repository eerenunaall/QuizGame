/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the HTTP API when it is not served from the same origin. */
  readonly VITE_API_URL?: string;
  /** Full WebSocket URL when it is not served from the same origin. */
  readonly VITE_WS_URL?: string;
  /** Default theme id for this deployment (party | venue-gold | high-contrast | gusto). */
  readonly VITE_DEFAULT_THEME?: string;
  /** Optional venue logo: same-origin path or https URL of the owner's SVG/PNG/WebP. Empty = no logo. */
  readonly VITE_VENUE_LOGO_URL?: string;
  /** Optional venue name shown as a credit on the TV title screen. Empty = hidden (the gusto theme has a default). */
  readonly VITE_VENUE_NAME?: string;
  /** Optional second credit line (e.g. "by ..."). */
  readonly VITE_VENUE_CREDIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
