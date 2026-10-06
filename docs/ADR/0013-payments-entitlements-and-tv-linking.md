# ADR-0013: Payments, entitlements and linking the TV to a phone purchase

Status: Accepted · Date: 2026-10-06

## Context
GDD §6 + brief §20–22: one non-consumable product `QUIZPARTY_FULL_GAME`, bought with StoreKit or
Google Play Billing, verified on the server, restorable, visible to a TV room without refresh; TV
never takes card data; QR codes must never carry reusable secrets. Open points: how the TV is bound
to the buyer, how a transaction is bound to an account (anti-replay across accounts), refunds, the
free tier, and the Apple root certificate (apple.com is unreachable from the sandbox, so it can only
be supplied by configuration).

## Decision
### Data model (migration 0004)
`purchase_transactions(id, platform IOS|ANDROID, product_id, external_transaction_id, purchase_token,
account_id, status PENDING|VERIFIED|REJECTED|REFUNDED, verified_at, environment, raw_summary jsonb)`
with `UNIQUE(platform, external_transaction_id)`; `entitlements(id, account_id, product, platform,
source_transaction_id, status ACTIVE|REVOKED, granted_at, revoked_at, metadata)` with a **partial
unique index** `(account_id, product) WHERE status='ACTIVE'`. Grants use
`INSERT … ON CONFLICT DO NOTHING` inside one transaction ⇒ idempotent by construction.
Each account owns a random `store_account_token` (UUID).

### Verification (client data is never trusted)
- **iOS (StoreKit 2)**: client sends the signed transaction JWS. The server verifies it with Apple's
  official `@apple/app-store-server-library` `SignedDataVerifier` (chain → Apple Root CA G3 supplied
  as `APPLE_ROOT_CERTS_PEM`; production start-up fails if payments are enabled without it), then checks
  `bundleId`, `productId`, `type == Non-Consumable`, `environment`, no `revocationDate`, and that
  `appAccountToken == account.store_account_token`.
- **Android**: client sends `purchaseToken` (+ productId). The server calls the Google Play Developer
  API (service-account JWT via `jose`, token cached) to read the purchase, checks `purchased` state,
  product, package name and `obfuscatedExternalAccountId == store_account_token`, then
  **acknowledges** it (else Google refunds after 3 days) — only after the DB grant commits.
- Price, product name and account id from the client are ignored; the server uses its own product
  catalogue; displayed prices come from the stores.
- A transaction already bound to a *different* account → `TRANSACTION_ALREADY_BOUND` (no transfer);
  restore works for the same account on any device.

### Flows
- **A (TV → phone)**: display (host) sends `REQUEST_UNLOCK_LINK` → server creates a **link intent**
  (128-bit random id, bound to the room, 10 min TTL, ≤ 5 open per room) and returns
  `https://<web>/unlock/<intentId>` for the QR. The phone (app or browser→app) signs in, calls
  `POST /v1/link-intents/:id/claim`; if the account is entitled the room's `hostAccountId` is set at
  once, otherwise the app shows the store purchase UI and, once the grant commits, the same claim is
  applied. The server pushes `ENTITLEMENT_CHANGED{tier:FULL}` to the display and the leader → the TV
  unlocks immediately. The intent carries no authority by itself: it needs an authenticated account
  and can only *attach that account's entitlement* to the room.
- **B (bought elsewhere)**: signing in on any device shows the entitlement (`GET /v1/entitlements`);
  claiming a link intent attaches it; restore re-verifies store data idempotently.
- **C (crash after purchase)**: on launch the app reads unfinished/current transactions
  (`Transaction.unfinished`/`currentEntitlements`, `queryPurchases`) and posts them to
  `POST /v1/purchases/restore`; the grant is idempotent; the store transaction is finished/acknowledged
  only after the server confirms.
- **Refund/revoke**: Apple App Store Server Notifications V2 (`REFUND`, `REVOKE`) and Google RTDN /
  voided-purchases polling mark the transaction REFUNDED and the entitlement REVOKED, then push
  `ENTITLEMENT_CHANGED` to open rooms of that account. A running game is not interrupted; the tier is
  re-checked at the next `START_GAME`/`REMATCH`.

### Tiers
`FREE`: Classic mode, one rotating free category (week-number based), ≤ 6 rounds, no Blind Quiz/Custom
Quiz/current events. `FULL`: everything. Anonymous hosts are FREE. Players never pay. Enforced only
on the server at `START_GAME`; the TV renders what the server says. Limits are `GameConfig.freeTier`.

### Web checkout
Not built (feature flag `webPurchase` off, no code path): storefront rules for steering to external
payment must be re-checked before any such feature. `/purchase` is an informational page (how to
buy in the app, how to restore) with no payment form.

## Verification
Integration tests with a locally generated certificate chain for the Apple verifier and a local HTTP
double of the Google API (the verification *code* is the production code; only the remote endpoint
and trust anchor are test fixtures): fake receipt, wrong bundle/product/account token, replay on a
second account, duplicate callback, restore, refund, crash-then-restore; WebSocket test that the
display receives `ENTITLEMENT_CHANGED` without refresh. **EXTERNAL:** real store sandbox purchases.
