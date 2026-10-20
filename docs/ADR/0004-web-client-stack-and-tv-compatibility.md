# ADR-0004: Web client stack and TV browser compatibility

Status: Accepted · Date: 2026-10-06 · **Deviates from GDD §4.2 (recommendation: Next.js)**

## Context
The GDD recommends Next.js. Hard requirements (GDD §2, §34): boots fast on Smart-TV browsers,
small bundle, no full-page re-render per timer tick, graceful degradation, console-browser support
only when physically verified. Smart-TV engines in the field range from Chromium 85 (Tizen 6.5,
webOS 22) to current. Next.js officially targets recent browsers only and ships an SSR/RSC runtime
the display client (a pure realtime app with no SEO value) does not need.

## Decision
- `apps/web` and `apps/admin` are **Vite + React 19 + TypeScript SPAs**, client-rendered, no SSR.
- Production web build uses `@vitejs/plugin-legacy` (module build for modern engines plus a
  `nomodule` build with targeted polyfills for old TV engines). The legacy bundle is parse-checked
  with `es-check` in CI. CSS avoids features missing before Chromium 85 (no `:has()`, container
  queries, `dvh`; `aspect-ratio` guarded with a padding fallback).
- **Capability detection before boot** (`apps/web/src/platform/capabilities.ts`): WebSocket, ES2018
  syntax, `Promise.allSettled`, `ResizeObserver`, CSS custom properties, `AudioContext` (optional),
  Fullscreen (optional). Missing hard capabilities show the *browser compatibility screen* (localized,
  large type, with the supported-browser list) instead of a blank page. A "low-power" profile
  (fewer particles, no blur filters) is selected automatically from capabilities and the user-agent
  class, and can be forced with `?perf=low`.
- Routes (`react-router`): `/`, `/tv`, `/join/:roomCode`, `/game/:roomCode`, `/unlock/:intentId`,
  `/purchase`, `/privacy`, `/terms`, `/support`, `/blind/respond/:inviteToken`.
  `/tv` = display client; `/join/:code` = join landing (app-store links + "continue in browser");
  `/game/:code` = browser controller. Legal pages are pre-rendered to static HTML at build time so
  store reviewers and crawlers read them without JavaScript.
- `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` are generated from
  env (`APPLE_TEAM_ID`, bundle id, Android package and SHA-256 fingerprints) at build time by
  `scripts/gen-association-files.ts` and served as `application/json` without redirects.
- Bundle budget enforced by `size-limit`: display entry ≤ 180 kB gzip JS (modern build); controller
  entry ≤ 120 kB. No UI kit and no animation library: CSS keyframes/WAAPI, a small canvas confetti
  module and Web Audio synthesis (zero audio files).
- State is held in a framework-agnostic store (`packages/controller-client`) and read with
  `useSyncExternalStore` selectors; the countdown is an isolated component driven by
  `requestAnimationFrame`, so ticks never re-render the screen.
- Fonts are self-hosted (`@fontsource`, Latin + **Latin-Extended for Turkish ğ ş ı İ ç ö ü**).
- Remote/keyboard navigation: a roving-focus helper; every TV action is reachable with arrows +
  Enter/Back; audio is unlocked by a first-run "press OK to start" gate that also requests fullscreen.

## Consequences
- Console and Smart-TV support stays *unclaimed* until a physical target-device QA pass is
  documented in `docs/BROWSER_MATRIX.md`; the sandbox can only run current Chromium.
- Two SPA toolchains (web, admin) share one Vite config base.

## Verification
Playwright capability suite (modern Chromium), `es-check` on the legacy bundle, `size-limit`,
viewport matrix 1280×720 / 1920×1080 / 3840×2160 screenshots, reduced-motion and low-power runs.

## Amendment (M1c, 2026-10-06): what shipped, and why it differs from the text above
- **One modern bundle, no `nomodule` legacy build.** `@vitejs/plugin-legacy` guards its modern entry
  with an inline `data:` module script and loads lazy CSS only in modern mode. Both clash with the
  strict CSP below (`script-src 'self'` + hashes, no `data:`), and a second bundle doubles what must
  be tested. The build targets Chromium 63+ / Safari 12+ (every TV engine still in warranty) with
  core-js `modernPolyfills`; older engines get a static, localized "unsupported browser" page from a
  `nomodule` script (`public/unsupported.js`) instead of a blank screen.
- **No `react-router`.** A 90-line history-API router (`lib/router.tsx`: `matchPath`, `Link`,
  `navigate`, lazy route chunks) covers `/`, `/tv`, `/join/:code?`, `/game/:code` and the static
  pages; it is unit-tested and ~25 kB gzip smaller.
- **Strict CSP, served by the realtime process** (`http/static-web.ts`): scripts only from `self`
  plus the hashes of the two inline bootstrap scripts, no `unsafe-inline`/`unsafe-eval`,
  `connect-src` limited to self and the WebSocket origin, `frame-ancestors 'none'`. Styling is CSS
  Modules plus CSSOM writes (`element.style`), which CSP allows. `tests/websocket/static.test.ts`
  and the Playwright suite run against exactly these headers.
- **Conservative CSS** for shared styles: no flex `gap`, `aspect-ratio`, `inset`, `:focus-visible`
  or `color-mix` (Chromium < 84 lacks some of them); screens are authored on a fixed 1920×1080
  stage that is scaled with one CSS transform (`--qp-scale`).
- **Fonts:** Paytone One (display) and Baloo 2 (text), self-hosted via `@fontsource`. The first
  choices (Fredoka, Titan One) have no Ş/Ğ/İ and would have broken Turkish.
- **Measured size** (gzip, `pnpm build:web`): shared entry 89 kB, TV chunk 21 kB, phone chunk 8 kB,
  polyfills 44 kB, confetti 5 kB (lazy) — the TV path loads ~155 kB of JavaScript, inside the
  180 kB budget; art is lazy and cached.
- Capability detection (`platform/capabilities.ts`) is replaced by `lib/device.ts` (TV user agents,
  Chromium major, hardware hints → low-motion mode) and the `nomodule` notice; `?perf=low` is
  honoured through `data-motion="low"`.
