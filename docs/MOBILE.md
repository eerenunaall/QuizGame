# Mobile app (Expo) — how it works, what is proven, what the owner must do

`apps/mobile` is the phone controller for iOS and Android (ADR-0017). It is a thin UI over code that the
browser controller already runs: `packages/controller-client` (socket, reconnect, token rotation, clock, view
store, power rules), `packages/i18n` (Turkish + English), `packages/ui-tokens` (colours), `packages/validation`
(link parsing). The server stays authoritative; the app sends intents and renders views.

## Commands
```
pnpm install
pnpm --filter @quizparty/mobile check      # lint (--max-warnings=0) + typecheck + Jest
pnpm test:mobile                           # Jest only (also its own CI job)
pnpm --filter @quizparty/mobile export:android   # Metro bundle smoke (no SDK needed)
pnpm --filter @quizparty/mobile start      # needs a development build on a device / emulator
QP_APPLE_TEAM_ID=… QP_BUNDLE_ID=… QP_ANDROID_PACKAGE=… QP_ANDROID_SHA256=AA:…,… \
  pnpm --filter @quizparty/mobile association   # writes apps/web/public/.well-known/*
```
Root `pnpm check` also lints and typechecks the app (no Jest there; Jest runs in the `mobile` CI job).

## Layout
| Path | What |
|---|---|
| `app/` | expo-router routes (thin): `/`, `/join`, `/join/[code]`, `/j/[code]` (short link), `/room/[code]`, `/unlock/[id]`, `/purchase`, `/profile`, `+not-found`, `+native-intent.ts` (validates every system URL) |
| `src/core/` | no React Native imports, so the protocol test runs it in Node: `runtime.ts` (wires `GameClient`), `links.ts`, `api.ts`, `auth.ts`, `purchases.ts` (`PurchaseProvider`, `PurchaseFlow`), `config.ts`, `association.ts`, `banner.ts` |
| `src/screens/` | pure, prop-driven screens: Home, Join, Lobby, Prep (stake / Double Down / Cover / Pot / Duel invite and challenge / sabotage menu), Answer (50/50, SHUFFLE, FOG, JAM, Blind Clock), Reveal / Score / Results, Reconnect banner, Purchase, Profile, SignIn, Unlock, Invalid link |
| `src/containers/`, `src/native/` | the only code that touches the router, SecureStore, haptics and `expo-iap` |
| `app.config.ts` | env-driven (`QP_API_URL`, `QP_WS_URL`, `QP_WEB_URL`, `QP_BUNDLE_ID`, `QP_ANDROID_PACKAGE`, `QP_PRODUCT_ID`); production profile refuses cleartext URLs and placeholder ids |
| `association/*.template.json` | shape of the two association files with `OWNER-TO-FILL` markers (the real ones are generated) |
| `eas.json` | `development` / `preview` / `production` profiles with `OWNER-TO-FILL` values. **`eas build` has never been run.** |

No secrets live in the app: only public URLs and identifiers. Account token and seat tokens are in SecureStore.

## What is proven in the sandbox
| Claim | Evidence |
|---|---|
| Phase → screen mapping, every phase | Jest `ControllerScreen.test.tsx`, `PickViews.test.tsx` (fixtures from `controller-client`) |
| Stake / Double Down / sabotage commit exactly what the server accepts; 50/50, SHUFFLE, FOG, lockout states | Jest `PickViews.test.tsx`, `PickViews.risks.test.tsx` (ADR-0023), `ControllerScreen.test.tsx` |
| Join form, reconnect banner states, purchase screen, profile (sign out, export, two-step delete), sign-in | Jest `screens.test.tsx` |
| Link parsing incl. malicious URLs; `app.config.ts` links; association files | Jest `links.test.ts`, `config.test.ts`, `association.test.ts` |
| Purchase flows A/B/C: bound to the server's account token, finished only after the server confirms, restore, crash recovery, refusal paths | Jest `purchases.test.ts` (scripted store, scripted HTTP) |
| The app's own runtime plays join → prep → answer → results against the **real server and database**, survives a socket drop with token rotation, resumes after an app restart, never holds the correct option before REVEAL | ws `tests/websocket/mobile-phone.test.ts` |
| Email-code sign-in as a `MOBILE` session, a Play purchase verified by the server's production code (Google API double), TV room unlocking live, restore on a second device, refusal for another account, export and deletion | same file |
| `/.well-known` association files are served as JSON (and nothing else under dot paths) | ws `static.test.ts` |
| The JS bundle builds for Android | `expo export --platform android` (Hermes bytecode, ~3.7 MB), CI `mobile` job |

## NOT provable here (no Xcode, Android SDK, devices, store or Apple/Google access)
- Native builds, signing, `eas build` / `eas submit`, app launch, layout on real screen sizes, performance.
- StoreKit 2 / Play Billing: purchase sheet, sandbox accounts, ask-to-buy, restore on device, `expo-iap`'s native side
  (`src/native/expoIapProvider.ts` is type-checked only). The server side of verification is proven with test doubles
  that speak the stores' wire formats (M4); real receipts are not.
- Universal-link / app-link association: Apple's CDN fetching the AASA, Google verifying `assetlinks.json`, opening
  links from Camera, Safari, Messages, Notes, cold start vs warm start.
- Haptics (`expo-haptics`), Android back behaviour, keyboard avoidance, screen-reader (VoiceOver / TalkBack) behaviour
  beyond the accessibility props set in code, dynamic type.
- Push notifications (not built), Play Install Referrer deferred link (not built), Sign in with Apple / Google
  (server side exists behind flags; no UI).
- Store review outcomes (guideline 4.8, 5.1.1(v) is covered by in-app deletion; screenshots, privacy labels).

## Owner checklist
1. **Apple Developer Program** account; App Store Connect app record; note the **Team ID**.
2. **Google Play Console** account; create the app; opt into **Play App Signing**; note the SHA-256 of the app signing key
   (and the upload key while testing).
3. **Identifiers** — replace the placeholder `com.example.quiznight` (search `OWNER-TO-FILL`):
   `QP_BUNDLE_ID` (iOS) and `QP_ANDROID_PACKAGE` (Android) as EAS environment variables. They cannot change after release.
   Server env must match: `APPLE_BUNDLE_ID`, `GOOGLE_PACKAGE_NAME`.
4. **Store products**: one non-consumable per store with the id `quizparty_full_game` (what the server's
   `APPLE_PRODUCT_ID` / `GOOGLE_PRODUCT_ID` default to; if you pick another id set both the server env and `QP_PRODUCT_ID`).
5. **Server payments env** (ADR-0013): `PAYMENTS_ENABLED=1`, `APPLE_ROOT_CERTS_PEM`, App Store Server API key + notification URL
   (`/v1/webhooks/apple`), Google service account JSON with Play Developer API access, Pub/Sub push to
   `/v1/webhooks/google/<secret>`, `GOOGLE_WEBHOOK_SECRET`. Accepting sandbox purchases stays on until review passes.
6. **Production URLs**: `QP_API_URL`, `QP_WS_URL` (`wss://…`), `QP_WEB_URL` (https; its host becomes the associated domain)
   in the `production` and `preview` EAS profiles (`eas.json`); the server's `ALLOWED_ORIGINS` / `PUBLIC_WEB_URL` to match.
7. **Association files**: run the `association` script with your Team ID, bundle id, package and fingerprints, then deploy
   `apps/web` (the files are written to `apps/web/public/.well-known/`, which is git-ignored on purpose). They must be reachable
   over https without redirects at `https://<web host>/.well-known/apple-app-site-association` and `…/assetlinks.json`.
8. **EAS**: `eas login`, `eas init` (project id into `app.config.ts` `extra.eas` / `expo.owner` if you use one),
   fill `eas.json` (`ascAppId`, Play service-account key path **outside the repo**), then
   `eas build --profile development` for the first device runs, `preview` for testers, `production` for release.
9. **Store listing**: name, subtitle, description (TR + EN), screenshots per device class, icon (replace
   `apps/mobile/assets/*` placeholders, currently the web icon), age rating, privacy policy URL, data-safety / privacy labels
   (we store: nickname for the game, email + purchase records for accounts; ADR-0018), support URL, export-compliance answer
   (`ITSAppUsesNonExemptEncryption=false` is preset).
10. **Device test pass** (use `development` builds): see below.

### Device test pass (what to check by hand)
- Scan the TV QR with the system camera → app opens on Join with the code filled (iOS and Android, cold and warm start);
  with the app not installed the browser controller must open instead.
- Type a code, join, play a full game with two phones; lock the screen and return mid-question (reconnect banner, state restored).
- Airplane mode for 10 s mid-game, then back.
- Buy with a sandbox / test account; kill the app right after paying and relaunch (crash recovery); Restore on a second device;
  refund in the store console → TV tier follows at the next game.
- Scan the TV's "unlock" QR as an owner and as a non-owner.
- Haptics on/off; VoiceOver / TalkBack on the answer screen; largest font size; Turkish and English.
- Sign in by email code; export; delete account (then sign in again with the same address creates a fresh account).

## Known gaps (tracked)
Lobby category picker, kick / make leader, question reporting and the Who Said It *reveal art* are web-controller-only for now
(the Who Said It statement form is in). Avatars are system emoji, not the web illustrations. No offline mode.
