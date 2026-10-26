# Archonbite sitesini yayına alma (telefondan, kopyala-yapıştır)

Bu klasör (`sites/archonbite`) **hazır bir statik sitedir**: derleme yok, komut yok, sunucu yok. Klasörü olduğu gibi
yayınlayan her yer çalışır. İki kolay yol: **Cloudflare Pages** (önerilen) ya da **Render Static Site**.

Önce tek şeyi anla: **iki ayrı adres var.**

| Adres | Ne | Nerede çalışır |
| --- | --- | --- |
| `archonbite.com` | Bu site (stüdyo, mağaza sayfaları, kılavuz) | Cloudflare Pages veya Render Static |
| `quiz.archonbite.com` | QuizNight **oyunun kendisi** (TV + telefon) | Oyun sunucusu (Render veya VPS), `docs/GUSTO_GO_LIVE.md` |

---

## A. Cloudflare Pages (önerilen)

1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → bu depoyu seç.
2. Ayarlar:
   - **Framework preset:** `None`
   - **Build command:** *(boş bırak)*
   - **Build output directory:** `sites/archonbite`
   - **Root directory:** *(boş bırak)*
3. **Save and Deploy**. 1 dakikada `https://<proje>.pages.dev` adresinde site açılır. Kontrol et.
4. Alan adı: projede **Custom domains** → **Set up a custom domain** → `archonbite.com` (ve `www.archonbite.com`).
   Alan adın Cloudflare'deyse kayıtlar kendiliğinden eklenir. Değilse kayıt şirketinde `CNAME` ekle:
   `@` (ya da `www`) → `<proje>.pages.dev`.
5. `_headers` dosyası otomatik uygulanır (güvenlik başlıkları ve önbellek). Ek ayar gerekmez.

## B. Render Static Site

1. render.com → **New +** → **Static Site** → depoyu seç.
2. **Build Command:** `echo ok` (ya da boş) · **Publish Directory:** `sites/archonbite`.
3. **Create Static Site**. Sonra **Settings → Custom Domains** → `archonbite.com` ekle; Render'ın verdiği `CNAME`
   değerini DNS'ine gir.
4. Render `_headers` dosyasını **okumaz**. **Settings → Headers** bölümünde şu kuralı ekle (Path `/*`):

   | Header | Değer |
   | --- | --- |
   | `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` |
   | `X-Content-Type-Options` | `nosniff` |
   | `X-Frame-Options` | `DENY` |
   | `Referrer-Policy` | `strict-origin-when-cross-origin` |
   | `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |

   Uzun önbellek için ayrıca `/assets/fonts/*` yoluna `Cache-Control: public, max-age=31536000, immutable` ekle.
5. 404 sayfası: Render, yayın klasöründeki `404.html` dosyasını kendisi kullanır.

---

## C. Oyun adresi: `quiz.archonbite.com`

Oyun sunucusu bu sitenin içinde **değildir**; ayrı yayınlanır. Adım adım rehber zaten var:
**`docs/GUSTO_GO_LIVE.md` → "Kendi alan adınla yayınlamak"** ve `docs/DEPLOYMENT.md`. Kısaca:

1. DNS'e `quiz` kaydı ekle:
   - **Oyun Render'daysa:** `quiz` → `CNAME` → Render'ın servis ayarlarında gösterdiği adres (`....onrender.com`).
     **Cloudflare'de bulutu GRİ yap (DNS only).** Turuncu bulut Render'ın sertifikasını ve WebSocket bağlantısını bozar.
   - **Oyun bir VPS'teyse:** `quiz` → `A` → VPS'in IP adresi, yine **DNS only (gri bulut)**.
2. Render'da oyun servisi → **Custom Domains** → `quiz.archonbite.com` ekle → **Verify** (sertifika 1 saate kadar sürebilir).
3. Oyun servisinde şu iki ayarı yap, sonra **Restart**:
   - `PUBLIC_WEB_URL` = `https://quiz.archonbite.com`
   - `ALLOWED_ORIGINS` = `https://quiz.archonbite.com`
   Bu ayar yanlışsa TV "Oyun Başlat"a basınca bağlanamaz (sunucu WebSocket'i `403` ile reddeder). Bunu kendi denemelerimde
   gördüm.
4. Kontrol: `https://quiz.archonbite.com/tv` açılıyor mu? QR kod `quiz.archonbite.com/join` adresini gösteriyor mu?

## D. Sitede ne değiştirmelisin?

Tek dosya: **`assets/config.js`** (GitHub'da dosyayı aç → kalem simgesi → değiştir → **Commit**; site kendiliğinden yenilenir).

| Ayar | Anlamı | Ne yap |
| --- | --- | --- |
| `PLAY_URL` | Oyunun adresi | `https://quiz.archonbite.com` (sonunda `/` olmasın) |
| `PLAY_LIVE` | Oyun yayında mı? | Sunucu hazır değilse `false` yaz: Oyna sayfası "yakında" der |
| `CONTACT_EMAIL` | İletişim e-postası | **Gerçek, okuduğun** bir adres yaz (şu an yer tutucu) |
| `SITE_URL` | Sitenin adresi | `https://archonbite.com` |

Metinleri değiştirmek: `assets/i18n/tr.json` (Türkçe) ve `assets/i18n/en.json` (İngilizce). Oyun bilgileri:
`data/games.json`. Salty Pirate için ne gerektiği: **`OWNER-FILL.md`**.

## E. Başka bir sitede "Oyna" düğmesi (iframe YOK)

Mevcut bir siteye ya da mesaja sadece **bağlantı** koy:

```html
<a href="https://archonbite.com/play/">QuizNight'ı oyna</a>
<!-- ya da doğrudan oyuna: -->
<a href="https://quiz.archonbite.com/tv" target="_blank" rel="noopener">QuizNight'ı TV'de aç</a>
```

**Neden iframe değil?** Oyun kendi güvenlik başlığıyla (`frame-ancestors 'none'`) başka sayfada gömülmeyi **kasten
engeller**; oyun ayrıca tarayıcı çerezi (`SameSite=Strict`), WebSocket, tam ekran ve ses izni kullanır. Gömülünce giriş
ve bağlantı çalışmaz. Doğru yol bağlantıdır (bkz. `docs/GUSTO_GO_LIVE.md`).

## F. Bilgisayarda deneme (isteğe bağlı)

```
node sites/archonbite/tools/serve.mjs      # http://localhost:8099
node sites/archonbite/tools/check.mjs      # bağlantılar, diller, CSP kuralları kontrolü
```

Sayfa yapısını ya da metni toplu değiştirirsen `node sites/archonbite/tools/sync-pages.mjs` ortak üst/alt bölümleri ve
statik Türkçe metni yeniler. Yayın için **hiçbirine gerek yok**.
