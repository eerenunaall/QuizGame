# Monetization research: browser payments and pricing for QuizNight

Status: Research / proposal (not an ADR yet) · Date: 2026-10-19 · Scope: web-only sales, host pays, players never pay

**This is not legal or tax advice.** It is an engineering and product summary of public sources, written so the
owner knows which questions to take to a *mali müşavir* (SMMM) and a lawyer. Rules, fees and country lists change
often. Every fact below is marked:

- **[V]**: verified on the provider's or regulator's own page (seen through search results on that official domain;
  direct page fetches were blocked in the research sandbox).
- **[S]**: secondary source (blog, review, aggregator). Probably right, but check before relying on it.
- **[I]**: inferred by us from the sources plus general knowledge. Treat it as a hypothesis.

Context: QuizNight is played in the browser (TV/laptop is the stage, phones are the controllers). The owner is an
individual in Turkey with no company yet. He sells in Turkey first and worldwide later, and will **not** publish to the
Apple or Google stores. What exists today (ADR-0012/0013): email-OTP accounts, `FREE`/`FULL` entitlements per host
account, idempotent grants, refund revocation, a TV unlock through a link intent (QR), live `ENTITLEMENT_CHANGED` to
rooms, and an off `webPurchase` flag with no code path.

---

## 1. Recommendation in one paragraph

**Launch with Paddle (Merchant of Record). Keep iyzico as the fallback.** Paddle is the legal seller to the buyer.
It collects and remits VAT/KDV worldwide, including Turkey's 20 % KDV on digital services [V]. It handles card fraud,
chargebacks and receipts. It accepts individuals and sole traders: business verification is skipped for them and only
identity verification is required [V]. Turkey is not on its unsupported-seller list [V], and it supports TRY prices
through per-country overrides [V]. It has an official Node SDK that verifies webhooks, a sandbox, test cards and a
webhook simulator [V]. The owner then sells one thing to one foreign company (Paddle), which keeps his Turkish
paperwork small. That is a B2B service-export invoice, not one invoice per consumer. The costs are a fee of about
5 % + $0.50 per transaction [S], custom pricing for items under $10 [S], and USD/EUR payouts by wire or Payoneer [V].
If Paddle declines the account or the fees on small TRY tickets prove too heavy, **iyzico** is the fallback. It is
Turkey's most mature PSP, with TRY, taksit, an official SDK, a sandbox and signed webhooks [V]. With iyzico the owner
becomes the seller himself: KDV, an e-Arşiv invoice per sale, a distance-sales contract and an ETBİS registration.
**Polar** is the other Merchant of Record (MoR) worth knowing. Turkey is on its payout list [V], but it charges in USD
only [S].

---

## 2. Provider comparison

### 2.1 Table

| Provider | Model | Turkish individual / şahıs can sign up? | Documents | Payout to Turkey | Fees (list) | VAT/KDV | TRY prices | Refunds / chargebacks | Webhook signature + official SDK | Test mode |
|---|---|---|---|---|---|---|---|---|---|---|
| **Paddle** | MoR | **Yes**: "business verification not required for individuals or sole traders"; Turkey not on the unsupported list [V] | Domain review (live site with terms, refund policy, privacy notice) + identity check [V] | Wire or Payoneer; "$15 SWIFT fee may apply for certain countries" [V]; balances in USD/EUR/GBP/AUD/CAD, not TRY [S] | 5 % + $0.50; **items < $10 need custom pricing** [S] | Paddle collects and remits; Turkey 20 % B2C listed [V] | Yes: TRY is a supported currency, per-country price overrides [V] | Refunds are "adjustments" (`adjustment.created/updated`); EU/UK buyers get a 14-day right under Paddle's refund policy [V]; chargebacks handled by Paddle, fee disputed [S] | HMAC-SHA256 `Paddle-Signature: ts=…;h1=…`; `@paddle/paddle-node-sdk` `webhooks.unmarshal` [V] | Sandbox (`sandbox-api.paddle.com`), test cards, webhook simulator [V] |
| **Polar** | MoR | Yes: payouts via Stripe Connect Express to residents or businesses of listed countries, **Turkey listed** [V] | Stripe Connect identity KYC [I] | To a bank account in your own country and currency (TRY) [V] | 4 % + $0.40, +1.5 % non-US cards [V]; a reported May 2026 change to 5 % + $0.50 [S, conflicting] | Polar collects and remits [V] | **No**: USD-only presentment (design doc, Jan 2026) [S] | Polar handles them; `order.refunded` [S] | Standard Webhooks (`webhook-id/-timestamp/-signature`); `@polar-sh/sdk` `validateEvent` [S] | Sandbox environment [V] |
| **Lemon Squeezy** | MoR, moving to Stripe Managed Payments | Unclear: bank payouts in a limited list, PayPal does not pay out in Turkey [S] | n/a | Unconfirmed [S] | 5 % + $0.50 [S] | Yes | Limited | Yes | Signed webhooks | Test mode |
| **Stripe** (direct / Managed Payments) | PSP / MoR | **No**: Turkey is not on Stripe's business country list [V]; Managed Payments (GA in 39 countries, Apr 2026 [V]) does not list Türkiye as a business location (checked Aug 2026) [S] | Needs a foreign entity (e.g. Atlas) [S] | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **FastSpring** | MoR | Possibly: markets to Turkish companies [V]; individual acceptance unclear | Sales-led onboarding [S] | Turkey not on the restricted-payout list [V] | Quote-based (one source: 8.9 %) [S] | Yes | Yes [I] | Yes | Signed webhooks [I] | Test mode [I] |
| **Gumroad** | Marketplace / MoR | Unclear | | Turkey's bank-payout status unconfirmed; excluded from PayPal payouts [S] | 10 % + processing [S] | Yes | No [I] | Yes | Weak, no signed-webhook story for entitlements [I] | Limited |
| **Creem / Dodo Payments** | MoR (newer) | Turkey payout unconfirmed [S] | | Creem payout fee max(7, 1 %) [S] | ~5 % [S] | Yes | Dodo claims TRY [S] | Yes | Signed webhooks [S] | Yes [S] |
| **iyzico** | Turkish PSP (you are the seller) | Needs a **şahıs şirketi** (tax-registered) [S] | Vergi levhası, imza beyannamesi/sirküleri, kimlik, IBAN document [S] | TRY to a Turkish bank [I] | ~2.49–3.99 % + small fixed fee (conflicting) [S] | **You** charge 20 % KDV and issue an e-Arşiv invoice per sale [I] | Native TRY + taksit | You handle them (cayma, iade); chargebacks through iyzico [I] | `X-IYZ-SIGNATURE-V3` HMAC-SHA256, enabled on request [V]; official `iyzipay` Node SDK [I] | Sandbox [I] |
| **PayTR** | Turkish PSP | Şahıs şirketi [S]; "iş modeli uygun bulunmamıştır" rejections reported [S] | Same as iyzico [S] | TRY | Negotiated, ~0.99–4 % [S] | You | Native | You | Callback `hash` (HMAC-SHA256, base64, merchant_key/salt), `test_mode` [V]; no official Node SDK [I] | Test mode [V] |
| **Param** | Turkish PSP | Şahıs şirketi [S] | Vergi levhası, imza sirküleri, kimlik [S] | TRY | 0.56–2.19 %+ (conflicting) [S] | You | Native | You | Docs only after approval [S] | Yes [S] |
| **Shopier** | Turkish storefront/link | Individual membership possible [S] | Tax status unclear | TRY | 2.99–5.99 % + ₺0.49 by volume [S] | You | Native | You | Not built for server-to-server entitlements [I] | n/a |

### 2.2 Why Paddle and not the others

- **Stripe is out.** A Turkey-based seller cannot hold a Stripe account without a foreign company, and Stripe's own
  MoR product does not list Türkiye as a business location.
- **Lemon Squeezy is migrating** to Stripe Managed Payments, which has no Turkish sellers. Building on a product in
  transition is a bad bet.
- **A MoR is the only way to sell worldwide as an individual without registering for VAT abroad.** EU OSS, UK VAT and
  US states each need their own registration, and Turkish digital-service KDV applies from the first sale with no
  threshold [S]. Among the MoRs, Paddle has the most verified points for this case: individuals accepted, Turkey
  allowed, TRY prices, a games category ("Consumer Software and Games") [V], an official SDK, a sandbox and a simulator.
- **Polar is the fallback MoR** if Paddle rejects the domain review. Its payouts land in TRY in a Turkish bank [V],
  but buyers are charged in USD. Turkish cards then pay foreign-transaction costs and lose taksit [I], which hurts the
  first market.
- **iyzico is the fallback PSP** for Turkey only. It is cheaper per transaction and native for Turkish buyers, but it
  makes the owner the seller of record, with all the Turkish e-commerce obligations in §4. It also does not solve
  foreign VAT, so with iyzico alone international sales should stay off.

### 2.3 Paddle facts the design depends on

- Create a transaction on the server (`POST /transactions` with `items[{price_id, quantity}]` and `custom_data`), then
  open the overlay with `Paddle.Checkout.open({ transactionId })`. Items cannot be changed in the checkout [V].
- `transaction.completed` fires when processing is done [V]. Refunds are adjustments with `action: refund`. On live
  accounts they usually start as `pending_approval`, and `adjustment.updated` reports `approved`/`rejected` [V].
  Sandbox auto-approves refunds every 10 minutes [V].
- The signature is `HMAC_SHA256(secret, ts + ":" + rawBody)` in `Paddle-Signature: ts=…;h1=…`. It must be computed over
  the **raw body**. The SDK applies a 5 s timestamp tolerance by default [S]. Each notification destination has its own
  secret, so sandbox and live use different secrets [V].
- Retries: live 60 retries over 3 days, sandbox 3 retries over 15 min [S].
- Test cards: `4242 4242 4242 4242`, `4000 0038 0000 0446` (3DS), `4000 0000 0000 0002` (declined) [V].

Sources: [Paddle verification phases](https://www.paddle.com/help/start/account-verification/what-is-business-verification) ·
[Paddle unsupported countries](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle) ·
[Paddle payouts](https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid) ·
[Paddle tax countries](https://paddle.com/help/sell/tax/which-countries-does-paddle-charge-sales-tax-or-vat-for/) ·
[Paddle supported currencies](https://developer.paddle.com/concepts/sell/supported-currencies) ·
[Paddle localized pricing](https://developer.paddle.com/build/products/offer-localized-pricing/) ·
[Paddle AUP / what not to sell](https://paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle) ·
[Paddle refund policy](https://www.paddle.com/legal/refund-policy) ·
[Pass a transaction to checkout](https://developer.paddle.com/build/transactions/pass-transaction-checkout) ·
[Create a transaction](https://developer.paddle.com/api-reference/transactions/create-transaction) ·
[transaction.completed](https://developer.paddle.com/webhooks/transactions/transaction-completed) ·
[Refund adjustments](https://developer.paddle.com/build/transactions/create-transaction-adjustments) ·
[adjustment.updated](https://developer.paddle.com/webhooks/adjustments/adjustment-updated) ·
[Signature verification](https://developer.paddle.com/webhooks/signature-verification) ·
[Sandbox](https://developer.paddle.com/sdks/sandbox/) · [Webhook simulator](https://developer.paddle.com/webhooks/simulator/) ·
[paddle-node-sdk](https://github.com/PaddleHQ/paddle-node-sdk) ·
[Paddle fees (secondary)](https://dodopayments.com/blogs/paddle-fees-explained) ·
[Paddle sub-$10 pricing (secondary)](https://www.stackscored.com/pricing/saas-billing/paddle/) ·
[Polar supported countries](https://polar.sh/docs/merchant-of-record/supported-countries) ·
[Polar pricing](https://polar.sh/resources/pricing) · [Polar multi-currency design doc](https://handbook.polar.sh/engineering/design-documents/multi-currency) ·
[Polar webhooks (secondary)](https://hookdeck.com/webhooks/platforms/guide-to-polar-webhooks-features-and-best-practices) ·
[Lemon Squeezy 2026 update](https://www.lemonsqueezy.com/blog/2026-update) ·
[Lemon Squeezy supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries) ·
[Stripe global](https://stripe.com/global) · [Stripe Managed Payments eligibility](https://docs.stripe.com/payments/managed-payments/eligibility) ·
[SaaS payments from Türkiye (secondary)](https://ceaksan.com/en/saas-payment-infrastructure-turkey) ·
[FastSpring payouts](https://developer.fastspring.com/docs/payout-portal) · [FastSpring for Turkish companies](https://fastspring.com/blog/turkish-companies-expanding-without-local-entities/) ·
[Gumroad getting paid](https://gumroad.com/help/article/13-getting-paid) · [Creem countries](https://docs.creem.io/merchant-of-record/supported-countries) ·
[iyzico webhooks](https://docs.iyzico.com/en/advanced/webhook) · [iyzico (secondary)](https://www.ideasoft.com.tr/iyzico-nedir-nasil-kullanilir/) ·
[PayTR iFrame API step 2](https://dev.paytr.com/en/iframe-api/iframe-api-2-adim) · [PayTR documents (secondary)](https://www.ticimax.com/blog/paytr-nedir-nasil-basvuru-yapilir) ·
[PayTR rejections](https://www.sikayetvar.com/paytr/sanal-pos-basvurularim-aciklama-olmadan-surekli-reddediliyor) ·
[Param (secondary)](https://www.ideasoft.com.tr/yardim/parampos-pos-kurulumu/) · [Shopier fees (secondary)](https://www.ideasoft.com.tr/shopier-komisyon-oranlari/) ·
[Turkey digital-service VAT](https://fonoa.com/countries/turkiye/tax-on-digital-services).

---

## 3. Pricing research and recommendation

### 3.1 How comparable games make money

| Product | Model | Price point |
|---|---|---|
| Jackbox Party Pack 11 | One-time pack of 5 games; players free on phones | $29.99, often discounted to ~$22–25 [V] |
| Jackbox Party Starter (incl. Quiplash 3) | One-time "best of" bundle | $19.99 MSRP, low $8.99 [S] |
| Jackbox Megapicker | Free launcher, funnels into packs | Free [V] |
| Among Us (PC) | One-time; mobile free with ads | $4.99 [S] |
| AirConsole (TV + phone controllers) | Free tier + "Hero" premium | $7.99/month, or $29.99 lifetime [S] |
| Kahoot! personal (Kahoot!+) | Subscription tiers by player count | ~$3–19/month billed yearly [S] |
| Gartic Phone, skribbl.io | Free, ad-supported | $0 (video ads before rounds) [S] |
| Hosted trivia nights (services) | Per event | $399–725 per event [S] (a ceiling, not a peer) |

What this shows:
1. **The host pays once and players are free.** This is the norm for TV party games (Jackbox, AirConsole). It matches
   our model, so no change is needed.
2. **Prices under $10 feel impulsive for a single game, $20–30 for a bundle.** A single trivia game with many modes sits
   below a Jackbox pack. €7.99–9.99, the GDD §6.3 hypothesis, fits.
3. **Ads ruin the TV moment.** The free web games that rely on ads put them on the shared screen, which the GDD forbids.
4. **Subscriptions feel wrong for a game played a few times a year** (party nights, holidays). AirConsole sells a
   lifetime option next to its subscription for this reason.
5. **Turkey needs its own price, not a converted one.** Steam's 2023 switch to USD pricing in Turkey raised prices by up
   to 80 % and caused backlash. In 2026 Valve's tool again recommends lower purchasing-power prices for Turkey [S]. A
   local benchmark: Spotify Premium Bireysel is **₺115/month** from October 2026 [S]. USD/TRY was about **49.2** in
   early October 2026 [S].

Sources: [Jackbox Party Pack 11 checkout](https://checkout.jackboxgames.com/products/the-jackbox-party-pack-11) ·
[Jackbox Party Starter](https://www.dekudeals.com/items/the-jackbox-party-starter) ·
[Jackbox Megapicker](https://www-origin.jackboxgames.com/blog/the-jackbox-megapicker-has-arrived) ·
[Among Us price](https://steambase.io/games/among-us/price) · [AirConsole IAP prices](https://apppricinglab.com/iap/apple/1017688554) ·
[Kahoot pricing (secondary)](https://nibble-app.com/blog/kahoot-cost) · [Gartic Phone review](https://www.whistleout.com/CellPhones/Apps/gartic-phone-app-review) ·
[Hosted trivia pricing](https://coursehorse.com/groups/virtual/event/private-virtual-trivia) ·
[Steam regional pricing 2026](https://www.webtekno.com/steam-yeni-yerel-fiyat-tavsiyesi-sistemi-h214348.html) ·
[Steam USD switch](https://www.teknoblog.com/steam-turk-lirasindan-dolara-gecti-fiyatlar-artti/) ·
[Spotify TR Oct 2026](https://www.politikam.com/spotify-premium-fiyatlarina-zam-geldi-ekim-2026-ogrenci-bireysel-duo-ve-aile-paketi-guncel-fiyat-listesi-aciklandi) ·
[USD/TRY Oct 2026](https://www.turkgun.com/ekonomi/dolar-bugun-ne-kadar-7-ekim-2026-dolar-euro-kuru-kac-tl/405055).

### 3.2 The QuizNight offer: no subscriptions, no ads, no pay-to-win

Players never pay and never see a price. Nothing bought changes scoring, powers or odds. Purchases change only
*content and length* for the room the buyer hosts.

| Product (catalogue id) | What the host gets | Turkey (KDV incl.) | International | Why |
|---|---|---|---|---|
| **Free** (no purchase) | Unlimited free games: Classic mode, rotating free category, ≤ 5 rounds (`GameConfig.freeTier`), all powers, all players | ₺0 | $0 | Enough for the "this is fun" moment (GDD §6.2); no ads, no daily cap |
| **Party Night pass** `QUIZPARTY_PARTY_NIGHT` | Full game for **24 hours from the first game started**, in every room the account hosts; the clock does not start at purchase; must be started within 12 months | **₺129** | **$3.99 / €3.99** | Cheaper than one Spotify month; "buy it for Saturday" is fair, and a pass bought on Tuesday is not wasted |
| **Lifetime** `QUIZPARTY_FULL_GAME` (existing SKU) | Everything, forever, including all future base-game updates and modes | **₺349** | **$9.99 / €9.99** | About 3 months of Spotify in Turkey; inside the GDD's €7.99–9.99 range; a third of a Jackbox pack |
| **Upgrade credit** `QUIZPARTY_FULL_UPGRADE` | Lifetime for anyone who bought a Party Night pass in the last 7 days (not refunded, credit not used yet) | **₺220** | **$5.99 / €5.99** | Pass + upgrade costs the same as Lifetime, so trying first is free of regret |
| **Category pack** `QUIZPARTY_PACK_<slug>` (later, optional) | One themed pack (e.g. 90'lar, Türk sineması, Futbol), forever; playable by hosts with Lifetime or an active pass | **₺99** | **$2.99** | Optional extras, never needed to play well; launch only once ≥ 3 good packs exist, and also offer a 3-pack bundle (₺229 / $6.99) |
| **Gift** `GIFT_FULL_GAME`, `GIFT_PARTY_NIGHT` | A single-use code worth that product, redeemed by any signed-in account | same as product | same as product | Lets a fan buy QuizNight for the friend who hosts |

Net revenue per sale with Paddle's list fee (5 % + $0.50, before the sub-$10 negotiation; KDV/VAT removed) [I]:

| Sale | Gross | Tax removed | Fee | Net to owner | Fee share of net-of-tax |
|---|---|---|---|---|---|
| Lifetime TR ₺349 | $7.09 | $5.91 | $0.85 | **≈ $5.06** | 14 % |
| Lifetime US $9.99 (tax added on top) | $9.99 | $9.99 | $1.00 | **≈ $8.99** | 10 % |
| Party Night TR ₺129 | $2.62 | $2.18 | $0.63 | **≈ $1.55** | 29 % |
| Party Night intl $3.99 | $3.99 | ~$3.33 (EU VAT) | $0.70 | **≈ $2.63** | 21 % |

The fixed $0.50 is what hurts the small TRY tickets. This is why **every product is under $10 and the owner must ask
Paddle for its micro-transaction pricing** before launch. If the answer is poor, two levers exist. One: sell Party
Night in Turkey only through iyzico (a dual-provider setup, phase 2). Two: drop Party Night in TR and lean on Lifetime.
Prices live in the Paddle catalogue (one base price in USD plus a `TR` override in TRY and a `EUR` group), never in
game code (GDD §6.3).

### 3.3 Fairness rules (product decisions the code enforces)

- A pass does not start until the host starts the first game. A game in progress when the pass ends **always plays to
  the end**, consistent with ADR-0013's "a running game is not interrupted". A pass bought on top of a running pass is
  queued after it.
- There are no upsell screens during a game. The "Party Night ended / keep it forever for ₺220" message appears only
  on the lobby or results screen, at most once per night.
- Lifetime means lifetime of the product: written in the terms as "for as long as QuizNight is operated", with a
  promise to give notice before any shutdown.
- An unused pass can be refunded within 14 days, no questions asked (see §4.3).

---

## 4. Turkish legal basics the owner must handle (not legal advice)

### 4.1 With Paddle (the recommended setup)
- **Who sells to the consumer:** Paddle is the reseller and Merchant of Record. Paddle's checkout shows Paddle's buyer
  terms, issues the receipt, and collects and remits KDV/VAT [V]. The owner sells to Paddle.
- **Tax registration:** income from Paddle is commercial income. The owner needs a **şahıs işletmesi**: a tax office
  registration, then a *vergi levhası*, Bağ-Kur, and e-Arşiv/e-Fatura readiness [I]. Ask the SMMM about:
  - **Invoice to Paddle** as a service export with the **KDV istisnası (KDVK 11/1-a)**, and whether the
    *hizmet ihracatı kazanç indirimi* (GVK 89/13) applies. A Turkish accountant warns that "Paddle paid the VAT, so I
    need not declare" is wrong [S].
  - **Genç girişimci istisnası** (GVK 20/A), if the owner is under 29 [S].
  - The **GVK mükerrer 20/B** exemption (15 % withholding through a dedicated bank account) targets content creators
    and *mobile* apps sold through app-store platforms. A browser game sold through Paddle probably does **not**
    qualify [I]. Confirm with the SMMM.
- **e-Arşiv:** since 2026, invoices to buyers that are not e-Fatura users must generally be e-Arşiv. Simple-method and
  business-account taxpayers have transitional limits until the end of 2026 [S]. With Paddle that is one monthly
  invoice to a foreign company, which an e-Arşiv portal or integrator handles.
- **Website texts** (Paddle also requires terms, a refund policy and a privacy notice for its domain review [S]):
  *Kullanım Koşulları*, *İade Politikası*, *Gizlilik Politikası* plus a **KVKK aydınlatma metni**, a cookie notice, and
  the seller identity block (name, address, email, tax number) under the e-commerce law 6563 [I].
- **KVKK:** we process account emails, so an aydınlatma metni is required. **VERBİS** registration is likely exempt:
  under 50 employees, and taxpayers not on the balance-sheet basis are judged on employee count only [S]. Never send
  buyer emails to Paddle from our server. The buyer types the email into Paddle's checkout, and we send only an opaque
  account token. This keeps us out of a cross-border transfer of our own (KVKK md. 9) [I].

### 4.2 With iyzico (the fallback): everything in 4.1, plus
- **Ön bilgilendirme formu** and **mesafeli satış sözleşmesi**, shown and accepted before payment, then emailed or kept
  available (Mesafeli Sözleşmeler Yönetmeliği) [S].
- **An e-Arşiv invoice for every sale**, through an integrator API (e.g. Paraşüt, BirFatura) [I].
- **ETBİS** registration, required for selling on one's own website [S].
- **20 % KDV** included in displayed consumer prices [I].

### 4.3 Cayma hakkı (right of withdrawal) and digital content
Mesafeli Sözleşmeler Yönetmeliği art. 15 excludes "electronic services performed instantly and intangible goods
delivered instantly" from the 14-day withdrawal right. The 2026 amendment removed the electronic-devices exception but
did not touch this one [S]. Our design:
- Before checkout, show a required checkbox (TR/EN copy in `packages/i18n`): *"Dijital içeriğin hemen sağlanmasına onay
  veriyorum; bu nedenle cayma hakkımın sona erdiğini biliyorum."* Store the consent (text version and timestamp) with
  the transaction.
- **Lifetime** is delivered instantly, so the exception applies once consent is given [I]. **A Party Night pass is not
  performed until its first game.** We treat an unused pass as refundable within 14 days. This is fair, and it is the
  safe reading [I].
- Paddle's own refund policy gives EU/UK consumers 14 days on some digital purchases [V]. Our webhook handles any
  refund Paddle approves, whatever the reason.

Sources: [Mesafeli Sözleşmeler Yönetmeliği (mevzuat.gov.tr)](https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.20237.pdf) ·
[2026 amendment notice](https://moral.av.tr/tr/hukuki-haberler/mesafeli-sozlesmeler-yonetmeliginde-degisiklik-yapilmasina-dair-yonetmelik-yayimlandi-2895) ·
[Cayma exceptions (secondary)](https://upjen.com/blog/cayma-hakki-hangi-urunlerde-gecerli-degil-e-ticaret-saticisi-icin-14-gun-iade-kuralinin-istisnalari) ·
[MoR tax guide (TR)](https://evrenozmen.com.tr/paddle-lemon-squeezy-merchant-of-record-vergi) ·
[Paddle income taxation (TR)](https://evrenozmen.com.tr/paddle-uzerinden-elde-edilen-gelirlerin-vergilendirilmesi-2025-rehberi) ·
[20/B and digital services (TR)](https://ozmconsultancy.com/gvk-mukerrer-20-b-ve-dijital-hizmet-gelirleri-turkiyeden-global-saas-veya-veri-isleme-hizmeti-sunanlar-icin-tam-rehber-2026/) ·
[20/B scope](https://www.teknoblog.com/sosyal-icerik-ureticileri-mobil-uygulama-gelistiricileri-kazanc-istisnasi) ·
[e-Arşiv 2026 (secondary)](https://www.ideasoft.com.tr/e-ticaret-icin-e-fatura-zorunlulugu/) ·
[ETBİS 2026 (secondary)](https://www.ffkpartnerhukuk.com.tr/etbis-kaydi-kimler-icin-zorunludur-2026-guncel-rehber/) ·
[VERBİS exemptions](https://www.erdem-erdem.av.tr/bilgi-bankasi/verbis-kayit-yukumlulugune-iliskin-istisna-kriteri-degistirildi).

---

## 5. Integration design for our server (Paddle)

The existing rules carry over unchanged: the server decides; the client's price, product name and account claims are
ignored; grants are idempotent; a transaction belongs to one account forever; a refunded transaction stays refunded;
the TV never takes card data. The proposal below should become **ADR-0024 (web checkout through a Merchant of
Record)** and an amendment to ADR-0013, which currently says "no web checkout code path".

### 5.1 Data model: migration `0009_web_purchases.sql` (sketch)

```sql
-- WEB purchases go through a Merchant of Record; the provider is recorded per row.
ALTER TABLE purchase_transactions DROP CONSTRAINT purchase_transactions_platform_check;
ALTER TABLE purchase_transactions ADD CONSTRAINT purchase_transactions_platform_check
  CHECK (platform IN ('IOS', 'ANDROID', 'WEB'));
ALTER TABLE purchase_transactions
  ADD COLUMN provider text CHECK (provider IN ('PADDLE', 'IYZICO')),   -- NULL for store rows
  ADD COLUMN catalogue_product text,                                    -- our id, chosen by the server
  ADD COLUMN amount_minor bigint, ADD COLUMN currency text,             -- what the provider charged (records)
  ADD COLUMN consent jsonb;                                             -- §4.3 consent: text version + time

ALTER TABLE entitlements DROP CONSTRAINT entitlements_platform_check;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_platform_check
  CHECK (platform IN ('IOS', 'ANDROID', 'WEB'));
ALTER TABLE entitlements
  ADD COLUMN kind text NOT NULL DEFAULT 'PERMANENT' CHECK (kind IN ('PERMANENT', 'PASS')),
  ADD COLUMN activate_by timestamptz,     -- a pass must be started before this (12 months)
  ADD COLUMN starts_at timestamptz,       -- set at the first START_GAME
  ADD COLUMN expires_at timestamptz,      -- starts_at + 24 h (or queued after a running pass)
  ADD CONSTRAINT entitlements_pass_shape CHECK (
    (kind = 'PERMANENT' AND activate_by IS NULL AND starts_at IS NULL AND expires_at IS NULL) OR
    (kind = 'PASS' AND activate_by IS NOT NULL AND (starts_at IS NULL) = (expires_at IS NULL)));
-- One live permanent entitlement per product; passes are one row per purchase.
DROP INDEX entitlements_one_active;
CREATE UNIQUE INDEX entitlements_one_active ON entitlements (account_id, product)
  WHERE status = 'ACTIVE' AND kind = 'PERMANENT';

ALTER TABLE store_notifications DROP CONSTRAINT store_notifications_platform_check;
ALTER TABLE store_notifications ADD CONSTRAINT store_notifications_platform_check
  CHECK (platform IN ('IOS', 'ANDROID', 'WEB'));

-- Gift codes: the code is derived (HMAC of the transaction id) so the buyer can see it again; only its hash is stored.
CREATE TABLE gift_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  product text NOT NULL,
  source_transaction_id uuid NOT NULL UNIQUE REFERENCES purchase_transactions (id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REDEEMED', 'VOID')),
  redeemed_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  redeemed_at timestamptz
);
```

The account-move and refunded-stays-refunded triggers from 0005 still apply. Deletion and export (`DELETE /v1/me`,
`GET /v1/me/export`) include WEB rows in the same way.

### 5.2 Catalogue (server-side, `apps/realtime/src/payments/catalog.ts`)
A typed map `product → { kind, grants, paddlePriceId (per environment from env/config), eligibility }`. Our product
ids: `QUIZPARTY_FULL_GAME`, `QUIZPARTY_PARTY_NIGHT`, `QUIZPARTY_FULL_UPGRADE` (grants `QUIZPARTY_FULL_GAME`),
`QUIZPARTY_PACK_*`, `GIFT_*`. The client sends only a catalogue id. The server picks the Paddle price id, checks
eligibility, and refuses anything else. Examples: Lifetime is refused if the account already owns it, and
`FULL_UPGRADE` is refused without an eligible pass. Display prices come from Paddle's pricing preview
(localized, cached per country for 10 min), never from our code.

### 5.3 Flow
```
TV (FREE room) ── REQUEST_UNLOCK_LINK ──► server ── QR /unlock/<token> ──► phone browser
phone: sign in (email OTP, ADR-0012) → /unlock shows "Party Night ₺129 · Lifetime ₺349" + consent checkbox
phone ── POST /v1/checkout/sessions {product, linkToken?, consent:{version}} ──► server
server: auth=session, limit=purchase, Origin+custom header, zod .strict()
        → eligibility → Paddle POST /transactions {items:[{price_id,quantity:1}],
             custom_data:{sat: account.store_account_token, cs: <our checkout id>}}
        → INSERT purchase_transactions(platform WEB, provider PADDLE, external_transaction_id txn_…,
             account_id, status PENDING, catalogue_product, consent, environment)
        → claim the link intent (as today), so this room unlocks on grant
        ◄─ {transactionId, clientToken, environment}
phone: /checkout page loads Paddle.js → Paddle.Checkout.open({transactionId}) (buyer types email + card in Paddle)
Paddle ── POST /v1/webhooks/paddle (transaction.completed) ──► server
server: raw body → SDK unmarshal (signature + ts tolerance) → INSERT store_notifications(WEB, event_id) (dedupe)
        → find our PENDING row by txn id (unknown → 200 + security event, nothing granted)
        → re-read GET /transactions/{id} from Paddle (status completed, price id == row's product,
             currency/amount plausible, custom_data.sat == account token, environment matches config)
        → EntitlementService.grantWeb (same transaction semantics as record(): idempotent, refund-safe)
        → onChanged(account, tier, 'GRANTED') → ENTITLEMENT_CHANGED to the TV + leader → TV unlocks
phone: the checkout "completed" event only starts polling GET /v1/entitlements; it never grants anything
```

- **Refunds and chargebacks:** `adjustment.created` / `adjustment.updated` with `action ∈ {refund, chargeback}` and
  `status = approved` lead to `EntitlementService.revoke('WEB', {externalTransactionId: txn}, event_id)`. Pending or
  rejected adjustments change nothing. A partial refund is logged for a human decision (as with `REFUND_REVERSED`
  today). A chargeback also raises a security event on the account. A refunded gift transaction voids the code, or
  revokes the redeemer's entitlement through `source_transaction_id`.
- **Reconciliation** (covers lost webhooks; Paddle retries live for 3 days): a job every 15 min re-reads PENDING rows
  aged 10 min–3 days, and a daily job lists adjustments since a stored cursor. Both use the same code path as the
  webhook.
- **Pass lifecycle** (time injected through `Clock`; the window math is a pure function with property tests):
  - Grant inserts `kind=PASS, activate_by = now + 12 months`.
  - `tierOf(account, now)` is `FULL` if a permanent full entitlement exists, a pass is running
    (`starts_at ≤ now < expires_at`), or an unstarted pass exists.
  - At `START_GAME`, if no pass is running, the oldest unstarted pass starts (`expires_at = now + 24 h`), inside the
    same database transaction as the tier check. A second pass is queued.
  - Expiry is evaluated at read time, so no job is needed for correctness. A light sweep sends
    `ENTITLEMENT_CHANGED{tier:'FREE', reason:'EXPIRED'}` (a new reason: protocol + i18n) to rooms that are **not**
    mid-game; a running game finishes and the next `START_GAME`/`REMATCH` re-checks.
- **Restore:** entitlements belong to the account. Signing in with the same email on any device restores everything
  (`GET /v1/entitlements`), and there is no "restore purchases" button for the web. Support can look up a Paddle
  `txn_…` from the buyer's receipt to find which account it is bound to. There is no transfer, as in ADR-0013.
- **Gift codes:** `POST /v1/gifts/redeem {code}` (session auth, `purchase` rate class plus per-account and per-IP
  lockout after 5 failures). A single-use update `OPEN → REDEEMED` inserts the entitlement for the redeemer with the
  gift's `source_transaction_id`. Codes are 16 base32 characters (80 bits) derived from `HMAC(secret, 'gift', txnId)`,
  shown to the buyer in their account page.
- **Config (fails closed, as ADR-0013):** `WEB_PURCHASE_ENABLED` (the existing `webPurchase` flag), `PADDLE_ENV`
  (`sandbox|production`), `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_PRICE_*`,
  `PADDLE_API_BASE` (tests only). Production refuses a sandbox key or a half configuration, and sandbox events are
  refused in production.
- **CSP (ADR-0018):** Paddle.js is loaded **only** on the dedicated `/checkout` route, with a route-specific CSP adding
  Paddle's script and frame hosts (exact hosts from Paddle's docs at build time [I]). The TV and game pages keep
  `default-src 'self'`. If the native app is ever published to a store, the web checkout must stay unreachable from it
  (store steering rules, GDD §6.6).
- **Code shape:** `apps/realtime/src/payments/paddle.ts` contains a small fetch client for three calls
  (`POST /transactions`, `GET /transactions/{id}`, `GET /adjustments`) with a configurable base URL, plus webhook
  verification through the **official SDK** (`webhooks.unmarshal`, no network). `EntitlementService` stops
  hard-coding `FULL_GAME` and takes the product and kind from the catalogue. Routes are registered with explicit
  auth/limit/body policies (route-registry guard).

### 5.4 Anti-fraud and abuse
- Card fraud, 3DS and chargeback disputes are Paddle's job as MoR. Our job is to never grant without a signed event
  **and** a re-read from Paddle's API.
- Only transactions we created can grant (PENDING row lookup). `custom_data.sat` must equal the account's
  `store_account_token`, otherwise `PURCHASE_ACCOUNT_MISMATCH` plus a security event. A transaction is never moved to
  another account.
- Checkout creation: session auth, CSRF (Origin + custom header), `purchase` rate class, at most 5 open PENDING rows
  per account, and a verified-email account only (OTP sign-in already proves it).
- Webhooks: raw-body HMAC, 5 s timestamp tolerance, idempotency by `event_id`, `webhook` rate class, 200 for
  unknown-but-valid events, 400 plus a `WEBHOOK_REFUSED` security event for bad signatures.
- Refund abuse: more than 2 refunds or any chargeback on one account blocks new checkouts pending review (admin
  console, audited). Passes refunded after use are tracked as a metric.
- Gift codes: hashed at rest, 80-bit entropy, lockouts, and never logged (pino redaction list extended).
- Logs and analytics: no emails, card data or Paddle customer ids. Transaction ids are logged as keyed pseudonyms
  (ADR-0018).

### 5.5 Test plan (a double that speaks Paddle's real wire format)
Doubles stand in only for the remote system, as CLAUDE.md requires.
- **`PaddleWebhookSigner`** (tests/fixtures): builds events in Paddle's envelope (`event_id: "evt_…"`,
  `event_type`, `occurred_at`, `notification_id: "ntf_…"`, `data` with `id: "txn_…"`, `status`, `custom_data`,
  `items[].price.id`, `currency_code`, `details.totals`). It signs them exactly as Paddle does:
  `Paddle-Signature: ts=<unix>;h1=<hex HMAC_SHA256(secret, ts + ":" + rawBody)>`. Production code verifies them with
  the **official SDK**. Fixtures are copied from Paddle's documented sample payloads, with the doc version noted.
- **`PaddleApiDouble`**: a local HTTP server on the real paths (`POST /transactions`, `GET /transactions/{id}`,
  `GET /adjustments`), with Bearer auth, the `{data, meta:{request_id}}` envelope and Paddle's
  `{error:{type,code,detail}}` errors, wired in through `PADDLE_API_BASE`.
- **Unit:** catalogue eligibility, pass-window function (property tests: queued passes never overlap, expiry is
  monotonic, a game in progress is never cut), amount/currency checks, gift code derivation.
- **Integration (Postgres):**
  - valid event grants once; the same event twice does nothing; the same transaction under two events grants once
  - refund before completion (out of order) never grants
  - unknown txn ignored; account-token mismatch refused; sandbox event in production refused
  - reconciliation grants after a lost webhook
  - `approved` refund revokes; `pending_approval` does not; chargeback revokes and flags
  - upgrade-credit eligibility; gift lifecycle (redeem, replay, refund voids); delete/export include WEB rows
- **WebSocket:** phone purchase leads to `ENTITLEMENT_CHANGED{FULL}` on the TV without refresh. With an injected
  clock, the pass expires mid-game, the game finishes, and `EXPIRED` arrives on the results screen.
- **Red team:** forged signature, stale timestamp replay, webhook for another account's txn, client-supplied
  price/currency (strict schema refuses), gift brute force, CSRF on checkout creation, double-spend race on the same
  gift code.
- **E2E (Playwright):** TV QR → phone `/unlock` → sign in → consent → `/checkout` with a test-only Paddle.js double
  (implements `Initialize` and `Checkout.open`, emits `checkout.completed`) → the harness posts the signed webhook →
  the TV unlocks.
- **EXTERNAL** (not provable in the sandbox, ADR-0019): a real Paddle sandbox purchase with `4242…`, a 3DS card, a
  declined card, a sandbox refund (auto-approved within 10 min), and the Paddle webhook simulator against a staging
  URL.

---

## 6. Sahibi için özet (Türkçe): senin yapman gerekenler

**Öneri:** Satışı **Paddle** ile aç (Merchant of Record: Paddle alıcıya satıcı olur, Türkiye dahil KDV/VAT'ı o toplar,
kart dolandırıcılığı ve ters ibrazla o ilgilenir). Paddle olmazsa yedek **iyzico** (yalnız Türkiye; bu durumda satıcı
sensin, faturayı ve KDV'yi sen yönetirsin). Abonelik yok, reklam yok, oyunculara ödeme yok, parayla avantaj yok.

**Önerilen fiyatlar** (Türkiye KDV dahil / yurt dışı):
- Ücretsiz: sınırsız oyun, 5 tur, dönen kategori.
- Parti Gecesi (24 saat, ilk oyunu başlattığında başlar): **₺129 / $3.99**
- Ömür boyu tam oyun: **₺349 / $9.99**
- Son 7 günde Parti Gecesi alana ömür boyu yükseltme: **₺220 / $5.99**
- Kategori paketi (sonra, isteğe bağlı): ₺99 / $2.99. Hediye kodu: ürün fiyatıyla aynı.

**Yapılacaklar:**
1. **Mali müşavir (SMMM) ile görüş ve şahıs işletmesi aç:** vergi levhası, Bağ-Kur, e-Arşiv. Şunları sor:
   - Paddle'a kesilecek faturada hizmet ihracatı KDV istisnası (KDVK 11/1-a) uygulanır mı?
   - Hizmet ihracatı kazanç indirimi (GVK 89/13) uygulanır mı?
   - 29 yaş altıysan genç girişimci istisnası (GVK 20/A) var mı?
   - GVK 20/B istisnası tarayıcı oyununa uygulanır mı? (büyük ihtimalle hayır)
2. **Bankada TL + USD (veya EUR) hesap aç.** Paddle ödemeyi havale (SWIFT) ya da Payoneer ile gönderir.
3. **Paddle sandbox hesabı aç** (hemen, belge gerekmez). Sonra **canlı hesap**: alan adı incelemesi + kimlik
   doğrulaması (şahıslarda şirket belgesi istenmiyor).
   - Paddle satış ekibine **$10 altı ürünler için ücret** sor (liste ücreti 5 % + $0.50 küçük biletlerde ağır).
   - Hediye kodlarının kurallarına uygun olduğunu teyit ettir.
4. **Site metinleri** (avukata kontrol ettir): Kullanım Koşulları, İade Politikası, Gizlilik Politikası + KVKK
   aydınlatma metni, çerez bildirimi, satıcı bilgileri (ad, adres, e-posta, vergi no), "dijital içerik hemen
   sağlanır, cayma hakkı sona erer" onay metni. Kullanılmamış Parti Gecesi'ni 14 gün içinde iade et.
5. **Kararlar:** fiyat tablosunu onayla; marka adı (QuizNight / Quiz Party) ve alan adı; paketler açılışta mı sonra
   mı; hediye kodu olsun mu; Türkiye'de Parti Gecesi'ni Paddle'la mı yoksa ileride iyzico'yla mı satalım.
6. **ETBİS:** Paddle modelinde gerekip gerekmediğini avukata/SMMM'ye sor (iyzico'ya geçersek gerekli).
7. **Yedek (gerekirse):** iyzico başvurusu: vergi levhası, imza beyannamesi, kimlik, IBAN belgesi. Ek olarak mesafeli
   satış sözleşmesi, ön bilgilendirme formu ve her satışa e-Arşiv fatura.
8. **Bize ver** (ortam değişkeni olarak; asla sohbete ya da depoya yazma): `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`,
   `PADDLE_WEBHOOK_SECRET`, fiyat kimlikleri (`pri_…`), önce sandbox için.

*Bu belge hukuki veya mali tavsiye değildir; kesin karar için SMMM ve avukat görüşü alınmalıdır.*
