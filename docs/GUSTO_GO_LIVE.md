# Gusto canlıya alma kılavuzu (yalnızca telefonla)

Bu kılavuz, Gusto Board Game Café için QuizNight'ı **gerçek (üretim) modunda**, ücretli kullanıma uygun şekilde
yayınlamanız içindir. Bilgisayar ya da kod bilgisi gerekmez; telefon tarayıcısı yeter. Demo (`render.yaml`) geliştirme
modunda çalışır ve **para alınan bir mekanda kullanılmamalıdır**. Teknik arka plan: `docs/DEPLOYMENT.md` bölüm 5 ve 12.

> Bu sandbox'ta Render ve e-posta sağlayıcısı denenemedi. Adımlar belgelerden ve kodun davranışından yazıldı;
> ekran adları Render/Resend güncellemeleriyle biraz değişebilir. Takıldığınız yerde "Eğer bir şey ters giderse"
> bölümüne bakın. **Canlı açılıştan önce mutlaka 11. adımdaki prova listesini yapın.**

Süre: yaklaşık 1,5 saat (alan adı doğrulaması beklemesi hariç). Aylık maliyet: Render web hizmeti (Starter) ve
Postgres (Basic) ücretlidir; güncel fiyatı Render'ın fiyat sayfasından görün. E-posta sağlayıcısı ücretsiz planla yeter.

## 0. Başlamadan önce hazır olsun

- Telefonda bir **parola yöneticisi** ya da güvenli not (aşağıdaki gizli değerleri saklayacaksınız).
- Girişte kullanacağınız **gerçek e-posta adresiniz** (örn. `sahip@gmail.com`). Yönetici bu adres olur.
- GitHub hesabı ve bu deponun (QuizGame) Render'a bağlanabilmesi için GitHub izni.
- E-posta göndermek için **sahibi olduğunuz bir alan adı** (örn. `gustocafe.com`). Yoksa bir kayıt şirketinden ucuz
  bir alan adı alın (Turhost, Namecheap, GoDaddy vb.). Alan adınız yoksa 3. adımdaki "Brevo" seçeneğine bakın.
- Soru bankası: depoda `seed/gusto/` klasöründe `questions.*.tr.jsonl` dosyaları bulunmalı. Yoksa sistem soru
  olmadan açılır ve oyun başlamaz (bankayı hazırlayan kişiden isteyin).

## 1. Render hesabı ve ödeme

1. `render.com` adresine gidin, GitHub ile kaydolun.
2. **Account Settings > Billing** bölümünden ödeme yöntemi ekleyin. Ücretsiz plan **kullanmayın**: ücretsiz web hizmeti
   15 dakika kullanılmayınca uyur (ilk misafir bir dakika bekler) ve ücretsiz veritabanı 30 gün sonra silinir.

## 2. Üretim şablonunu (Blueprint) oluşturun

1. Render ana sayfa: **New +** > **Blueprint**.
2. Depoyu seçin (GitHub'dan QuizGame). **Blueprint file path** kutusuna tam olarak `render.production.yaml` yazın
   (varsayılan `render.yaml` **değil**: o demodur).
3. Render sizden **gizli değerleri** ister (3. ve 4. adımdaki liste). Hazır değilseniz oluşturmayı durdurun, önce
   3. adımı yapın. Bu değerler GitHub'a **yazılmaz**, yalnızca Render'da durur.
4. **Apply** deyin. İki şey oluşur: `quiznight-gusto-db` (veritabanı) ve `gusto-quiznight` (oyun sunucusu). İlk kurulum
   10-15 dakika sürer.
5. Hizmet sayfasının üstünde adresi görürsünüz (örn. `https://gusto-quiznight.onrender.com`; ad doluysa sonuna
   harf eklenir). **Bu adres 4. adımdaki `PUBLIC_WEB_URL` olacak.**

## 3. E-posta sağlayıcısı (giriş kodları için)

Yönetici ve görevliler 6 haneli kodla girer; kod e-postayla gelir. Önerilen: **Resend** (en basit, ücretsiz plan günde
100 e-posta; bir kafenin personel girişi için fazlasıyla yeter. Güncel limiti sağlayıcı sayfasından doğrulayın).

1. `resend.com` > hesap açın.
2. **Domains > Add Domain**: alt alan adı olarak `mail.gustocafe.com` gibi bir ad girin.
3. Resend size 2-3 DNS kaydı gösterir (SPF, DKIM, isteğe bağlı DMARC). Bunları alan adınızı yönettiğiniz yerde
   (Turhost, Namecheap, GoDaddy, Cloudflare...) **DNS** bölümünde olduğu gibi ekleyin (Tür, Ad, Değer birebir).
   - SPF: e-postanın bu alan adından gönderilmesine izin verir. DKIM: e-postayı imzalar. İkisi de yoksa mailler
     spam'e düşer ya da reddedilir. DMARC isteğe bağlı: `_dmarc` adıyla TXT, değer `v=DMARC1; p=none`.
   - Cloudflare kullanıyorsanız e-posta kayıtlarını **DNS only** (gri bulut) bırakın.
4. Resend'de **Verify**'ye basın; durum **Verified** olana kadar bekleyin (dakikalar-bir gün).
5. **API Keys > Create API Key** (yetki: "Sending access"). Çıkan `re_...` anahtarı **bir kez** gösterilir: parola
   yöneticinize kaydedin. Bu, `EMAIL_API_KEY` olacak.
6. Gönderen adresi: `Gusto QuizNight <giris@mail.gustocafe.com>` (doğruladığınız alan adı üzerinde olmalı). Bu
   `EMAIL_FROM` olacak.
7. Alan adınız yoksa: **Brevo** (`brevo.com`, günde 300 e-posta ücretsiz) kullanılabilir: Senders & IP bölümünde tek bir
   gönderen adresi doğrulayın, **SMTP & API > API keys** bölümünden anahtar alın, **Security > Authorized IPs**
   kısıtlamasını **kapatın** (Render'ın çıkış adresleri değişir). `@gmail.com` gibi bir adresten gönderilen mailler sık sık
   spam'e düşer; mümkünse kendi alan adınızı kullanın. Bu durumda `EMAIL_PROVIDER` değeri `brevo` olur.

## 4. Gizli değerler (Render > gusto-quiznight > Environment)

Şablon aşağıdakileri sorar (ya da sonradan **Environment** sayfasından girersiniz; kaydedince hizmet yeniden başlar).
Hepsini parola yöneticinize de yazın.

| Değişken | Ne yazılır | Güvenli değer nasıl üretilir |
|---|---|---|
| `SERVER_SECRET` | Render kendisi üretir | **Dokunmayın.** Environment sayfasında görünür: bir kopyasını parola yöneticisine alın. Sonradan değiştirmek herkesi çıkışa zorlar ve açık ödül kodlarını geçersiz kılar. |
| `METRICS_TOKEN` | Render kendisi üretir | Dokunmayın. |
| `ADMIN_BOOTSTRAP_EMAILS` | Yönetici e-postanız, küçük harf. Birden çoksa virgülle: `sahip@gmail.com,ikinci@gmail.com` | Gerçek adresiniz; **kod bu adrese gelir**. Bir yedek yönetici eklemeniz önerilir. |
| `PUBLIC_WEB_URL` | `https://` ile başlayan site adresi, sonunda `/` yok | 2. adımın 5. maddesindeki adres; kendi alan adı kurduysanız o adres. Yanlışsa TV'deki QR kodu yanlış yere gider. |
| `ALLOWED_ORIGINS` | Aynı adres (aynen) | `PUBLIC_WEB_URL` ile aynı. Kendi alan adına geçerken ikisini birden yazabilirsiniz: `https://yeni.adres,https://eski.adres`. |
| `EMAIL_PROVIDER` | `resend` (ya da `brevo`) | 3. adım |
| `EMAIL_API_KEY` | Sağlayıcıdan aldığınız anahtar | 3. adım. Başkasıyla paylaşmayın, sohbete yapıştırmayın. |
| `EMAIL_FROM` | `Gusto QuizNight <giris@mail.gustocafe.com>` | 3. adım |
| `BLIND_DATA_KEYS` | **Boş bırakın** | Kişisel (Blind) quiz gerekmiyor; boşken o özellik kapalı kalır, mekan modu etkilenmez. (Kullanmak isterseniz bir bilgisayarda `echo "k1:$(openssl rand -base64 32)"` ile üretilir; `docs/BACKUP.md` bölüm 5.) |

Sunucu yanlış/eksik bir ayarla **açılmayı reddeder** ve nedeni Logs'ta yazar (örn. `PUBLIC_WEB_URL must be https`,
`EMAIL_PROVIDER, EMAIL_API_KEY and EMAIL_FROM go together`). Düzeltip kaydedin.

Şablon bunları zaten doğru ayarlar (dokunmayın): `NODE_ENV=production`, `QP_ALLOW_DEV_SEED=0`, `QP_SEED_DEV=0`,
`QP_SEED_DEMO=0`, `QP_BANK_DIR=/app/seed/gusto`, `TRUST_PROXY_HOPS=1`, Gusto teması (`VITE_DEFAULT_THEME=gusto`).
**Üretimde geliştirme soru bankası hiçbir zaman yüklenmez** ve oyunculara sunulmaz.

## 5. İlk açılışı kontrol edin

1. Render > gusto-quiznight > **Logs**: `bank:` ile başlayan satırlar soru yüklemesini, en sonda `listening` benzeri bir
   satırı gösterir. `retire-dev: ... retired` satırı, geliştirme sorularının kapatıldığını gösterir.
2. Telefonda `https://<adresiniz>/healthz` açın: `{"ok":true}` görmelisiniz. `https://<adresiniz>/readyz` veritabanını
   da denetler.
3. Kırmızı hata varsa: Logs'ta son satırlar nedenini söyler (ayar adı yazar).

## 6. İlk yönetici girişi

1. `https://<adresiniz>/admin/` açın, `ADMIN_BOOTSTRAP_EMAILS` içine yazdığınız adresi girin.
2. E-postanıza gelen **6 haneli kodu** girin (10 dakika geçerli; spam klasörüne de bakın). İlk girişte yönetici rolünüz
   oluşur; kimse düğmeyle yönetici yapılamaz.
3. Kod gelmezse: Render Logs'ta `resend answered 401` (anahtar yanlış), `422` (gönderen alan adı doğrulanmadı),
   `429` (günlük limit) arayın.
4. Hemen ikinci bir yönetici ekleyin: **Kullanıcılar**'da (adresi önceden `ADMIN_BOOTSTRAP_EMAILS`'e koymanız ya da o
   kişinin bir kez giriş yapması gerekir).

## 7. Mekanı oluşturun

Yönetim konsolu > **Mekanlar** > **Mekan oluştur**:

- **Mekan adı**: `Gusto Board Game Café`
- **Sahibin e-postası**: mekan sahibinin e-postası (yönetici ile aynı kişi olabilir). Hesap yoksa oluşturulur; kişi bu
  adresle `/staff` sayfasında kod alarak girer.

Sonra sahip, telefonundan `https://<adresiniz>/staff` açıp giriş yapar ve **Ayarlar** sekmesinde şunları belirler
(ayrıntı: `docs/VENUE.md`):

- **Kazanana ödül ver**: açık; ödül metni (örn. `Bir içecek bizden`); en az oyuncu 3; günde en fazla ödül 10;
  iki ödül arası 5 dk.
- **Varsayılan masa süresi** ve **uzatma düğmeleri** (15, 30, 60 dk).
- **Görevliler**: personelin e-posta adreslerini ekleyin. Davet e-postası gitmez; kişiye adresi sizin söylemeniz yeter,
  o adresle `/staff` sayfasında kod alıp girer.

## 8. `venue.sessions` anahtarını açın

Mekan modu varsayılan olarak **kapalıdır**. Kapalıyken `/staff` "Mekan modu bu sunucuda kapalı" der.

Yönetim konsolundan (tavsiye edilen):

1. `https://<adresiniz>/admin/` > **Özellik anahtarları**.
2. `venue.sessions` satırını bulun > **Aç** > onaylayın.
3. `https://<adresiniz>/staff` sayfasını yenileyin.

Konsol çalışmıyorsa (yedek yol, yalnızca gerekirse): Render > gusto-quiznight > **Shell** (ücretli planlarda var) ve:

```
cd /app/scripts && node -e "const {Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();console.log(await c.query(\"UPDATE feature_flags SET enabled=true WHERE key='venue.sessions' RETURNING key,enabled\"));await c.end()})()"
```

Çıktıda `enabled: true` görmelisiniz. (Bu komut sandbox'ta denenmedi; konsol yolu esastır.)

## 9. Personeli ekleyin ve ilk test masasını açın

1. Personel telefonlarından `https://<adresiniz>/staff` açıp kendi e-postasıyla kod alır, girer.
2. TV'de `https://<adresiniz>/tv` açın (TV tarayıcısında) > **TV'de oyunu başlat**: 6 harfli oda kodu çıkar.
3. Telefonda **Mekan paneli > Yeni masa**: süre seçin (test için 15 dk), TV'deki kodu yazın, **Masayı aç**.
4. TV'de sağ üstte kalan süre görünmeli. Kendi telefonunuzla TV'deki QR'ı okutup katılın, oyunu başlatın.
   **QR'ın adresinin sizin adresiniz olduğunu** kontrol edin.

## 10. Kendi alan adınla yayınlamak (isteğe bağlı)

Örneğin `quiz.gustocafe.com`. Sitenizin kendisi (`gustocafe.com`) olduğu gibi kalır; oyun **alt alan adında** çalışır.

1. Render > gusto-quiznight > **Settings > Custom Domains > Add Custom Domain**, `quiz.gustocafe.com` yazın.
2. Render size bir **CNAME** hedefi gösterir (genelde `gusto-quiznight.onrender.com`). Alan adınızı yönettiğiniz yerde
   **DNS** bölümüne şu kaydı ekleyin: Tür **CNAME**, Ad/Host `quiz`, Değer/Hedef Render'ın gösterdiği adres.
   - **Cloudflare**: kaydın bulutu **gri (DNS only)** olmalı, turuncu (Proxied) olmamalı. Proxy WebSocket'i ve sertifikanın
     alınmasını bozabilir.
   - **Namecheap**: Domain List > Manage > Advanced DNS > Add New Record > CNAME Record, Host `quiz`.
   - **GoDaddy**: Domain > DNS > Add > Tür CNAME, Ad `quiz`, Değer hedef adres.
   - **Turhost**: Müşteri paneli > Alan adları > DNS Yönetimi > yeni CNAME kaydı, Host `quiz`.
   - Aynı ada ait başka bir A/AAAA/CNAME kaydı varsa önce silin.
3. Render'da **Verify**'ye basın. Sertifikayı Render kendisi alır (birkaç dakika-bir saat). Durum **Certificate issued**
   olunca `https://quiz.gustocafe.com/healthz` açılır.
4. Render > Environment: `PUBLIC_WEB_URL` = `https://quiz.gustocafe.com`, `ALLOWED_ORIGINS` =
   `https://quiz.gustocafe.com` (geçiş sürecinde eski adresi de virgülle ekleyebilirsiniz) > kaydedin; hizmet yeniden başlar.
   Yoksa **Manual Deploy > Restart service**.
5. Kontrol: TV'yi **yeni adresten** açın, QR kodun yeni adresi gösterdiğini doğrulayın; personel `/staff` girişini yeni
   adresten bir kez yapsın (çerezler adrese özgüdür; eski adresteki oturum yeni adreste geçerli olmaz). Giriş
   e-postalarındaki bağlantı/adres yeni adrestir.
6. **"Certificate pending" / sertifika bekleniyor**: genellikle DNS henüz yayılmamıştır. 1 saat bekleyin; CNAME'in doğru
   (hedefte yazım hatası yok), başka kaydın çakışmadığı ve Cloudflare'de bulutun gri olduğunu kontrol edin; Render'da
   **Verify** tekrar. 24 saati aşarsa alt alan adını silip yeniden ekleyin. Sertifika gelene kadar eski `onrender.com`
   adresi çalışmaya devam eder (ALLOWED_ORIGINS'te kalmışsa).
7. **Siteye gömmek (iframe) desteklenmez.** Oyun tarayıcı çerezi (`SameSite=Strict`, `__Host-` önekli), WebSocket ve
   `frame-ancestors 'none'` güvenlik başlığı kullanır; bir sayfanın içine gömülünce giriş ve bağlantı çalışmaz. Doğru
   yol: sitenizden bir **bağlantı ya da düğme** ile `https://quiz.gustocafe.com` adresine yönlendirmek.

Kodda değişiklik gerekmez: CSP'nin `connect-src` kuralı, QR adresi ve izinli kökenler `PUBLIC_WEB_URL` ve
`ALLOWED_ORIGINS`'ten türetilir; oturum çerezi alan adına bağlıdır (`__Host-`), `Domain` özelliği yoktur.

## 11. Prova listesi (müşteri gelmeden mutlaka yapın)

- [ ] Yönetici, sahip ve en az bir görevli telefonundan kodla giriş yapabiliyor (kod 1 dakika içinde geliyor).
- [ ] **Süre dolması**: 2 dakikalık masa açın, oyunu başlatın; süre bitince o soru yarıda kesilmeden biter, sonuçlar
      gelir, TV "Süre doldu" der, yeni oyun başlamaz.
- [ ] **Uzatma**: **+15 dk**'ya basın; TV yenilenmeden açılır, "Revanş" ile oyun devam eder; kalan süre "şu andan itibaren
      15 dk" olur.
- [ ] **Duraklat / Devam** ve **Bitir** çalışıyor.
- [ ] **Ödül**: en az 3 telefonla bir oyun bitirin; kazananın telefonunda kod çıkar. Personel telefonunda **Ödül doğrula**
      ile kodu girin: "Geçerli!" görünür; aynı kod ikinci kez "zaten kullanıldı" der.
- [ ] Sorular Türkçe, geliştirme sorusu (örn. "Bir haftada kaç gün vardır?" gibi seed soruları) **hiç çıkmıyor**.
- [ ] Sunucuyu **Manual Deploy > Restart service** ile yeniden başlatın: açık masa ve kalan süre geri gelir.
- [ ] Yönetim konsolu > Mekanlar > Mekan oturumları raporunda deneme masaları görünür.
- [ ] Deneme verileri raporu karıştırmasın diye gerekirse deneme masalarını not alın (rapor gün bazlıdır).

## 12. Yedekler

- Render ücretli Postgres'i otomatik yedekler (kaç gün geriye gidebildiği plana göre değişir; veritabanı sayfasında
  **Recovery/Backups** bölümüne bakın). Geri yükleme yeni bir veritabanı oluşturur; `DATABASE_URL` ona çevrilir.
- Ayda bir ve her güncellemeden önce kendi yedeğinizi alın (`pg_dump`, bilgisayar gerekir; ayrıntı ve geri yükleme:
  `docs/BACKUP.md` bölüm 5b). Telefonla yapılabilen kısım: Render yedeklerinin açık olduğunu ve en yeni yedeğin tarihini
  ayda bir kontrol etmek.
- **`SERVER_SECRET` ve `EMAIL_API_KEY` değerlerini parola yöneticinizde saklayın.** `SERVER_SECRET` kaybolursa geri
  getirilemez.
- Güncelleme: otomatik değildir (bilerek). Render > **Manual Deploy > Deploy latest commit**; önce yedek, sonra bu
  listedeki prova.

## 13. Eğer bir şey ters giderse

| Belirti | Ne yapın |
|---|---|
| Site açılmıyor / "Application failed" | Render > Logs. Son satırda ayar adı yazar (örn. `PUBLIC_WEB_URL must be https`). Düzeltin, kaydedin. |
| Kod e-postası gelmiyor | Spam klasörü. Logs'ta `answered 401` (anahtar), `422` (alan adı doğrulanmamış), `429` (günlük limit), `circuit open` (sağlayıcı kesintisi; 1 dk sonra kendiliğinden döner). Sağlayıcı panelinde "Logs/Emails" sayfasına bakın. Kod 10 dakika geçerlidir, 30 sn'de bir, saatte 5 kez istenebilir. |
| Personel girişi yapamıyor | Ayarlar > Görevliler'de adres doğru mu (küçük harf)? Admin konsolunda oturum kapatıp yeniden deneyin. |
| `/staff`: "Mekan modu kapalı" | 8. adım: `venue.sessions` açık mı? |
| TV QR'ı yanlış adrese gidiyor | `PUBLIC_WEB_URL` yanlış; düzeltin, kaydedin. |
| Oyun çok yavaş / bağlantı kopuyor | Render hizmet sayfasında CPU/RAM grafiği; hizmet planı Starter'dan bir üst plana alınabilir (tek örnek kalmalı). Kafe Wi-Fi'ını kontrol edin. |
| Soru çıkmıyor / "soru bulunamadı" | Logs'ta `bank:` satırlarına bakın. `seed/gusto/` dosyaları depoda var mı? Satırlar `REVIEW`'da bekliyor olabilir (denetim PASS'i yok): yönetim konsolu > Kuyruk. |
| Yanlış soru bildirildi | Konsol > Bildirimler > soruyu kapatın (RETIRED). Oyun sürerken güvenlidir. |
| Her şey kötüye giderse | Son çare: Render > Events > önceki başarılı yayına **Rollback**; veri sorunuysa en yakın yedeği geri yükleyin. Masaları kasada elle tutmaya devam edin; uygulama para almaz, yalnızca süre tutar. |
| Şüpheli erişim / sızıntı | `docs/RUNBOOK.md` bölüm 4 ve 5: anahtarları sağlayıcıda iptal edip yenileyin; yöneticiyi kullanıcılar sayfasından çıkışa zorlayın. |

Teknik destek için kodu yazan kişiye Logs'tan ilgili satırları (e-posta adresi ve anahtar içermez) iletin.
