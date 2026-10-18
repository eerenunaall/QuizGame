# External checklist: what only the owner can do

Nothing in this list can be done from the cloud build sandbox: it needs your identity, money, signature, a
physical device or a lawyer. Each item says what is blocked until it is done. Tick, date and initial.
Statements about law are pointers for your counsel, not legal advice.

## 1. Domain, server, certificate

- [ ] Buy/own the domain; DNS A (and AAAA) record to the VPS. Blocks: every public URL, QR codes on phones off your Wi-Fi, app links, store review. (`docs/DEPLOYMENT.md`)
- [ ] Rent a VPS (2 GB RAM or more), open 80/443, install Docker. Blocks: deployment.
- [ ] Caddy obtains the certificate on first start. Blocks: https (the server refuses non-https production settings). `[UNTESTED HERE]`
- [ ] Build the Docker image once (`docker compose -f docker-compose.prod.yml build`) and fix anything that fails: the Dockerfile has never been built in the sandbox (no Docker daemon).
- [ ] Mail service for sign-in codes (`EMAIL_WEBHOOK_URL`), with SPF/DKIM for your sending domain. Blocks: admin sign-in, account sign-in.
- [ ] Uptime monitor on `/readyz` and a place for alerts to reach you. Blocks: the "monitoring works" gate (the repository ships no dashboards or alert rules).
- [ ] Off-server backup destination and the first restore drill (`docs/BACKUP.md`). Blocks: the "backup strategy" gate in practice.
- [ ] Enable GitHub secret scanning / push protection and branch protection on the repository. (ADR-0018 mentions a secret scan; it is not in CI.)

## 2. Accounts and money

- [ ] Apple Developer Program membership; App Store Connect app record; Team ID. Blocks: iOS build, TestFlight, iOS purchases.
- [ ] Google Play Console developer account; app record; Play App Signing; SHA-256 fingerprints. Blocks: Android build, Android purchases.
- [ ] Choose the real bundle id and Android package (replace `com.example.quiznight`, search `OWNER-TO-FILL`); they cannot change after release. Blocks: builds, app links.
- [ ] Store products: one non-consumable per store with id `quizparty_full_game` (or your id in the server env and the app). Blocks: purchases.
- [ ] Apple: root certificates PEM (`APPLE_ROOT_CERTS_PEM`), App Store Server notifications URL `https://<domain>/v1/webhooks/apple`, `APPLE_APP_ID`. The server cannot fetch from apple.com at run time, so you supply the roots.
- [ ] Google: service account with Play Developer API access (`GOOGLE_SERVICE_ACCOUNT_JSON`), Pub/Sub push to `/v1/webhooks/google/<GOOGLE_WEBHOOK_SECRET>`.
- [ ] Sandbox purchase, restore on a second device, and refund observed end to end; then `PAYMENTS_ACCEPT_SANDBOX=0`. Blocks: acceptance U (partial), V-X on real stores.
- [ ] Payment, tax and invoicing set-up in both stores (and company/tax registration for sales in Turkey/EU). Counsel/accountant.
- [ ] Optional model services (question audit, AI decoys, embeddings): API keys and their data-processing terms. The audit passes stay "not run" without them; the heuristics still run.

## 3. Signing, builds, store listings

- [ ] EAS account; `eas init`; fill `eas.json` (`ascAppId`, Play service-account key kept outside the repository); development, preview and production builds (`docs/MOBILE.md`).
- [ ] Generate the app-link association files with your Team ID, package and fingerprints (`apps/mobile/scripts/association.ts`), deploy them at `https://<domain>/.well-known/apple-app-site-association` and `/assetlinks.json` without redirects. Blocks: acceptance E (opening from camera/Safari/Messages).
- [ ] Store listings: names, subtitles, TR + EN descriptions, screenshots per device class, icons (replace the placeholder icons in `apps/mobile/assets`), age rating, support URL, privacy-policy URL, data-safety (Google) and privacy "nutrition" labels (Apple) matching `docs/PRIVACY.md`, export-compliance answer (`ITSAppUsesNonExemptEncryption=false` is preset).
- [ ] Apple review notes and a demo path for the reviewer (a TV is needed to play: describe the browser TV page and give a room-code route).
- [ ] Trademark/name clearance for the game name and the brand assets in `docs/design/brand`.

## 4. Real devices and networks (cannot be simulated)

- [ ] Device pass for the app: `docs/MOBILE.md` "Device test pass".
- [ ] Browser/TV pass: `docs/BROWSER_MATRIX.md` section 3.
- [ ] Real-network pass: phones on mobile data and a venue Wi-Fi joining a TV on another network (acceptance D), and one lossy-network run (airplane mode 10 s mid-game).
- [ ] Reading distance, glare and colour checks on the actual TVs; large-text and screen-reader pass on phones.
- [ ] Load: run `pnpm perf` from a machine on a different network (the sandbox numbers are loopback only) if you expect big events.

## 5. Legal and policy texts (the web app has no pages for them yet)

The app serves `/credits` only; the routes `/privacy`, `/terms` and `/support` planned in ADR-0004 are **not built**. Store listings need a
privacy-policy URL and a support URL, so this blocks submission.

- [ ] Privacy policy (TR + EN) based on `docs/PRIVACY.md`, published at a stable URL; terms of use; support contact page; a security contact (`docs/SECURITY.md` section 4).
- [ ] Controller identity: who is the data controller (name, address, contact); KVKK "aydınlatma metni" (information notice) and, where required, explicit-consent texts; GDPR art. 13 notice if you serve the EU.
- [ ] KVKK: whether VERBIS registration applies to you; how you respond to data-subject requests within the statutory period; the breach-notification procedure (`docs/RUNBOOK.md` section 4). GDPR: representative in the EU if you have no establishment there; DPO need.
- [ ] Data-processing agreements and transfer basis for: the VPS provider, the mail service, any model provider, Apple/Google. Where servers are located (Turkey/EU/elsewhere) matters for cross-border transfer rules.
- [ ] Decide the retention periods you will publish; today they are only partly enforced (`docs/PRIVACY.md` section 3); implement the missing jobs or run the SQL.
- [ ] Children: choose the age rating and the position on under-age users; the game has no age gate.
- [ ] Blind Quiz / Who Said It: consent text wording shown to targets, the notice for statements, and a position on content that is about third parties who are not users. Review before switching on `mode.blind_quiz`, `mode.who_said_it`, `mode.custom_quiz`.
- [ ] AI decoys (`ai.decoys`): sends a person's personal answer to a model provider; needs notice, consent and a processing agreement before the flag is turned on.
- [ ] Terms for user-written content (Custom Quiz, statements): prohibited content, takedown path, who answers reports (`docs/RUNBOOK.md`).

## 6. Content rights: cult franchises and licensed material

The temporary demo bank (`seed/demo`) holds original Turkish questions *about* well-known franchises (television series, films, comics,
games). It is marked development content; the server never serves it in production and the importer refuses it there.

- [ ] Have a lawyer review whether quiz questions that name franchises, characters, titles, quotations or plot points are acceptable for a commercial
  product in your markets: trademark use of franchise names in the product name, listing, screenshots and category icons; descriptive/nominative use; and any quoted
  text, plot summaries or images. Rights holders and the stores enforce this differently; the stores may also reject listings that imply endorsement.
- [ ] Do not use official logos, posters, stills, character art, music or fonts from franchises anywhere (the category art must be original or licensed; the current art is Fluent/Noto emoji, permissive licences, credited on `/credits`).
- [ ] Keep questions factual and short and give counsel the rule for quoted text; categories can require a source per question (the "source required" setting in the admin console) and `docs/QUESTION_QUALITY.md` describes the review process.
- [ ] Decide whether franchise categories ship at launch, ship with a disclaimer ("unofficial, not affiliated with ..."), or wait for licences. Remove the demo bank first (`seed/demo/README.md` has the exact SQL).
- [ ] Music, sound and font licences: sounds are synthesised in the browser (no audio files); the fonts Paytone One and Baloo 2 are self-hosted through `@fontsource` (check their licence texts yourself; they are not listed on `/credits`); the illustrations (Fluent Emoji, MIT; Noto Emoji animation, CC BY 4.0) are credited on `/credits`.
- [ ] Question accuracy: model-assisted audit needs your key; otherwise use the manual audit round (`docs/QUESTION_QUALITY.md`) and a human reviewer for current-events items.

## 7. People and process

- [ ] Name the people who may hold the ADMIN role (at least two) and who handles moderation reports daily during events.
- [ ] Keep the offline copy of `.env` (especially `SERVER_SECRET`, `BLIND_DATA_KEYS`) in a password manager. These cannot be recovered.
- [ ] Decide the support promise (reply times) and the refund policy (stores handle refunds; the server revokes on notification).
