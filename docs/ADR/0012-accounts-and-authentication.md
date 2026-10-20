# ADR-0012: Accounts and authentication

Status: Accepted · Date: 2026-10-06

## Context
GDD §4.5/§24: anonymous players (nickname only) and **host accounts** ("email/social login or
equivalent") needed for purchase ownership. Apple guideline 4.8 requires an additional privacy
preserving login option when an app offers third-party/social login; account deletion must be
available in-app (guideline 5.1.1(v), GDD §49). Players must never be forced to register.

## Decision
- **Anonymous players** get only a room session (ADR-0009). No account, no email.
- **Accounts** are created on first sign-in. Methods behind an `AuthProvider` interface:
  1. **Email one-time code** (always on): 6-digit code, 10 min TTL, stored as HMAC, max 5 attempts per
     code, resend cooldown 30 s, per-email and per-IP rate limits, generic responses (no account
     enumeration). First-party login, so guideline 4.8 is not triggered.
  2. **Sign in with Apple** and **Google** via ID-token exchange (`POST /v1/auth/apple|google`),
     verified against the providers' JWKS with `jose` (audience/issuer/nonce checked). Implemented
     but **feature-flagged off** until client ids are configured; Apple ships whenever Google does.
- **Account sessions**: opaque 256-bit bearer token (stored hashed), 30-day sliding expiry, listable
  and revocable (`GET/DELETE /v1/me/sessions`). Web uses an `HttpOnly; Secure; SameSite=Lax` cookie
  + `Origin` allow-list + custom header for state-changing calls; mobile uses the bearer token from
  secure storage.
- **Mail delivery** through an `EmailSender` interface: `console` (dev/test), `smtp` (nodemailer).
  Production without a configured sender refuses to enable email login (fail closed).
- **Roles** (`account_roles`): `ADMIN`, `EDITOR`, `MODERATOR`, `SUPPORT`. Enforced on the server per
  route (`requireRole`), never only in the UI. Bootstrap admins come from `ADMIN_BOOTSTRAP_EMAILS`.
- **Deletion**: `DELETE /v1/me` revokes sessions, removes email and provider ids, anonymizes the
  account row and keeps purchase transactions with the account link nulled and a tombstone (legal
  record keeping). The client warns that the entitlement is lost with the account.
- Minimal data: email (or provider subject), display name, avatar id, locale.

## Verification
OTP rate-limit/lockout/expiry tests, enumeration-resistance test (identical responses/timing class),
JWKS verification tests with a locally generated key set, role-guard test that walks the route
registry and fails if any route lacks an explicit auth policy.
