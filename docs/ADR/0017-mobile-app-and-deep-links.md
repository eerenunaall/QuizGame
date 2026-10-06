# ADR-0017: Mobile app, deep links and what the cloud sandbox cannot verify

Status: Accepted · Date: 2026-10-06

## Context
Brief §6/§7: one React Native codebase for iOS + Android, universal/app links, deferred room-code
recovery, optional haptics, StoreKit/Play Billing. The sandbox has no Xcode, no Android SDK, no
devices; native builds and store flows need accounts and signing.

## Decision
- **Expo SDK 57 with a development client / prebuild (CNG)**, `expo-router`, TypeScript. No Expo Go
  dependency (native IAP needs a dev client). EAS Build configuration is committed (`eas.json`);
  builds run outside the sandbox.
- **All protocol and state logic is shared**: `packages/controller-client` (WebSocket client,
  reconnect with back-off + token rotation, time sync, view store) is used by the browser controller
  and the app. Native code is only UI, haptics, secure storage, deep links, camera scan, IAP.
  This is what makes the mobile logic testable in the sandbox.
- **IAP**: `expo-iap` (StoreKit 2 + Play Billing) behind an app-level `IapGateway` interface; unit
  tests drive the gateway with scripted purchase/restore/interrupted scenarios; the production
  implementation is the thin binding. The app never grants anything locally – it only posts store
  data to the server and renders the returned entitlement.
- **Deep links**: canonical HTTPS `https://<PUBLIC_WEB_URL>/join/<CODE>` and `/unlock/<id>`.
  - iOS: Associated Domains (`applinks:<host>`) + AASA with `components` for `/join/*`, `/unlock/*`.
  - Android: `intentFilters` with `autoVerify`, `assetlinks.json` with the signing SHA-256.
  - Both files are generated from env at build time (ADR-0004) and unit-tested for shape.
  - Every route parameter passes `packages/validation` (`roomCode`, `intentId`, `inviteToken` regexes,
    length caps, no scheme/host smuggling); invalid links land on a safe "link not valid" screen.
  - **Deferred recovery**: Android – the join page's Play Store link carries
    `referrer=join_<CODE>`; on first launch the app reads it once through the Play Install Referrer API
    and pre-fills the Join screen (validated like any other link parameter). iOS – there is no reliable
    Safari→fresh-install handoff and clipboard tricks trigger paste prompts and privacy concerns, so the
    app opens on the Join screen with the six-character code input focused. Joining is never blocked by
    recovery failing, and the code is never a credential.
  - No reusable secret is ever placed in a QR/link (room code and intent id are not credentials).
- **Haptics** optional (`expo-haptics`, setting persisted in secure storage, off for reduced-motion).
- **UI**: one dominant interaction area during questions, ≥ 64 pt targets, answers by letter + shape +
  colour, VoiceOver/TalkBack labels, dynamic type support, no required shaking/haptics.

## What is verified where
| Item | Sandbox | External |
|---|---|---|
| Typecheck, lint, Jest component/logic tests, config generation | ✔ | |
| `expo export`/bundling smoke | ✔ (best effort) | |
| iOS/Android binaries, signing, store submission | | EAS + accounts |
| StoreKit/Play sandbox purchases, restore on device | | physical devices |
| Universal/App Link association checks | | real domain + signed builds |
| Frame rate on a mid-range Android | | device |

## Verification
Jest tests for deep-link parsing (including malicious inputs), gateway scenarios (Flow A/B/C),
reconnect behaviour via the shared client, config snapshot tests for `app.config.ts`.
