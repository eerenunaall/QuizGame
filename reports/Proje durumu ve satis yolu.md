# QuizNight: Proje durumu ve satış yolu

Tarih: 15 Kasım 2026 · Hazırlayan: kod ve belgelerin okunması + internet taraması.
**Bu bir hukuki veya vergi tavsiyesi değildir.** Vergi, fatura ve sözleşme konularında mali müşavirle (SMMM) ve avukatla teyit edin.

---

## 1. Kısa cevap

- **Gusto pilotu için kod büyük ölçüde hazır; eksik olan canlıya alma ve gerçek cihazda deneme.** Sistem bugün hiçbir gerçek sunucuda, gerçek TV'de, gerçek tabletle ve gerçek bir kafe akşamında denenmedi. Her şey testlerle kanıtlı (binlerce otomatik test), ama "testte çalışıyor" ile "Cumartesi akşamı 20 kişiyle çalışıyor" aynı şey değil.
- **Pilot için mühendislik: yaklaşık 4-6 iş günü** (tarayıcı testlerini yeşile döndürmek, güvenlik okumasını bitirmek, prova sonrası düzeltmeler). **Sizin işiniz: yaklaşık 1-1,5 gün dağılmış** (hesaplar, alan adı, e-posta, prova) ve 1-2 gün bekleme (DNS, e-posta doğrulama).
- **Listenin tamamı (pilot sonrası "olması iyi olur" dahil): yaklaşık 23-27 iş günü** mühendislik.
- **Satış kısmı yazılım olarak neredeyse başlamadı.** Kodda sadece "kaç TV bağlanabilir" sayısı var (elle ayarlanan lisans hakkı). Süre, fatura, ödeme, lisans bitişi yok. Ödeme kodu yalnızca Apple/Google mağaza satın alımı içindir ve kapalıdır; tarayıcı için hiçbir ödeme kodu yok.
- **Önerim:** Gusto'da ödeme entegrasyonu yok: imzalı fiyat anlaşması + banka havalesi + e-arşiv fatura. İlk Türk mekanlarda aynı yöntem. Yurt dışı satış sonraya: Paddle (aracı satıcı). Stripe Türkiye'den doğrudan açılamıyor.
- **En büyük risk kod değil:** canlı sunucu kurulumu, yasal sayfalar (46 boşluk) ve Gusto'nun ad/logo izni sizde bekliyor.

---

## 2. Versiyon durumu tablosu

| # | İstediğiniz | Durum | Ne eksik |
|---|---|---|---|
| a | Mekan modu (QR, telefonda quiz, TV sahne), Gusto | **Büyük ölçüde bitti** (kodda), gerçek cihazda **denenmedi** | Canlı sunucu kurulumu, TV'lerde ve Wi-Fi'da prova, TV hoparlöründe ses dinlemesi, tarayıcı testlerinin GitHub'da yeşil çıkması |
| b | Quiz Gecesi (kağıt-kalem, tablet, TV slaytları, joker, final bahsi, takım rekabeti) | **Büyük ölçüde bitti** (ADR-0031, 14 Kasım) | Resimli sorular TV'de görünmüyor (güvenlik kuralı yüzünden), TV'ye panelden gönderme, sunucu yeniden başlarsa gece devam testi, tablet yalnızca 1024 px'te denendi, takım logoları gece ekranlarında yok |
| c | Yönetim/mekan paneli (sorular, cevap görünümü, ödül, giriş ücreti, logo, tema) | **Bitti** (kodda ve testte) | Yüklenen logoyu yeniden kodlama (küçük güvenlik iyileştirmesi), panelin gerçek telefonlarda sahada denenmesi |
| d | Belgeden soru hazırlama | **Kısmen** | Elle form çalışıyor. PDF/Word okuma ve yapay zekâ taslakları yazıldı ama **kapalı** ve gerçek anahtarla denenmedi (karar: kapalı kalacak). **Anahtarsız yollar (düzgün biçimli metni okuma, yapıştırma kutusu) yapılmadı.** Kılavuz (VENUE.md) bu bölümde eski |
| e | archonbite.com'a entegre tarayıcı sürümü | **Kısmen** | Site hazır ama **yayında değil**; `quiz.archonbite.com` yok, sitede "oyun yayında" anahtarı kapalı, iletişim adresi sahte. **Siteye gömme (iframe) bilerek desteklenmiyor**: oyun bağlantı/düğme ile açılır |
| f | Başka mekanlara satış (lisans, white-label) | **Başlanmadı** (white-label altyapısı var) | Lisans süresi/faturası, ödeme, sözleşme, kendi kendine kayıt, yasal sayfalar |

White-label (mekan adı, renk, logo, ayrı sorular, ayrı veri) hazır: ikinci kafe yalnızca ayarlarıyla farklıdır. Ama bunu **elle** kurarsınız (yönetim konsolundan mekan açıp TV hakkı sayısını girersiniz).

**Dürüstlük notu:** Son kayıtlara göre GitHub'da tarayıcı testi adımı kurulum hatasından çalışmadı; bugün bunu düzeltecek bir değişiklik gönderildi ama sonucu henüz yeşil görülmedi. Ses paleti ölçüldü, kulakla bir TV'de dinlenmedi. Quiz Gecesi tabletle ve TV ile hiç sahada sınanmadı. Mobil uygulama (mağaza) kapsam dışı bırakıldı.

---

## 3. Kalan iş tahmini (iş günü)

"Mühendislik" = bizim yapacağımız. "Siz/bekleme" = sizin işiniz veya dışarıdan gelen bekleme. Rakamlar tahmindir, prova sonrası çıkan sürprizler için pay bırakıldı.

| Konu | Mühendislik | Siz / bekleme | Not |
|---|---|---|---|
| a. Mekan modu (Gusto) | 2-3 | 0,5 gün + 1-2 gün DNS/e-posta bekleme | Tarayıcı testi düzeltmesi (1), güvenlik okumasını bitirme (2-3, ortak iş b ile) |
| b. Quiz Gecesi, pilot için asgari | 1-2 | prova yarım gün | Yalnızca yazılı sorularla pilot yapılabilir; TV'yi bağlantı linkiyle açarsınız |
| b. Quiz Gecesi, tam liste | 8-10 | - | Resimli soru (2-3), panelden TV'ye gönder (2-3), yeniden başlama testi (1), tablet ölçüleri (1), takım logoları (1,5), TV'de "nasıl oynanır" slaydı (0,5), personelin gece yönetmesi (0,5) |
| c. Panel | 1,5 | - | Logo yeniden kodlama (1), TV kaldırılırsa süreli masa kalması (0,5) |
| d. Belgeden soru | 4-5 | 1 saat kendi sorularınızı hazırlamak | Anahtarsız okuma (2,5), yapıştırma kutusu (1), tarayıcı testi (1), kılavuz (0,5) |
| e. archonbite.com | 1 | 2 saat + DNS bekleme | Netlify yayını, alan adı taşıma, oyun adresi, gerçek e-posta; teslim notu (1) |
| f. Satış altyapısı (Türkiye, elle) | 2-3 | sözleşme/avukat 1-3 hafta bekleme | Lisansa bitiş tarihi ve durum alanı, süresi dolunca TV/masa davranışı, yönetici raporu |
| f. Satış altyapısı (Paddle, global) | 8-12 | başvuru incelemesi 1-3 hafta (tahmin) | Ödeme sayfası, webhook, iade, test ortamı, kayıt ekranı |
| **Toplam** | **~23-27 gün (a-e)** | | **+10-15 gün satış (f)** |

Takvim süresi bundan uzundur: tek kişi/oturum çalışmasıyla "iş günü" ≠ takvim günü.

---

## 4. Satış ve ödeme seçenekleri

### 4.1 Kodda bugün ne var (kısa)

- `VENUE_LOCK=1`: halka açık sayfadan TV oyunu açılamaz; TV'ler mekan panelinden eşleştirilir.
- Her eşleşmiş TV bir **lisans hakkı**; varsayılan 3, yönetici konsolundan değişir (`display_seats`).
- Para: mekan modunda **uygulama hiç para almaz**, yalnız süre tutar. Kasada siz/personel tahsil eder.
- `PAYMENTS_ENABLED`: yalnızca Apple/Google mağaza satın alımını doğrular (kapalı, tarayıcı için işe yaramaz). Tarayıcı ödeme (`webPurchase`) için **kod yolu yok**.
- Araştırma belgesi (MONETIZATION_RESEARCH) tek oyunculu "ev sahibi bir kez öder" modelini anlatır. Kafe lisansı farklıdır: aylık, mekan başına. O yüzden o tasarımın bir kısmı yeniden yazılır.
- Fiyat fikri belgelerde yalnızca varsayım: ₺1.500-2.500/ay/mekan. Karar sizin.

### 4.2 Karşılaştırma

Bilgi kaynağı: internet taraması. **Stripe, Paddle ve Lemon Squeezy'nin kendi sayfalarına bu ortamdan bağlanamadım;** o yüzden bazı satırlar ikincil kaynaklara (bloglar) dayanır ve işaretlidir. Başvurmadan önce resmi sayfalardan teyit edin.

| Seçenek | Kurulum zahmeti | Ücret | KDV/fatura kimde | Türkiye'den çalışır mı | QuizNight'a uyumu |
|---|---|---|---|---|---|
| **Banka havalesi + e-arşiv fatura** (kendiniz) | Düşük: işletme (vergi levhası) + GİB portalı | Yalnız banka masrafı | Siz: %20 KDV, her ay e-arşiv fatura | Evet | **Gusto ve ilk Türk mekanlar için en iyi** |
| **iyzico** | Orta: vergi levhası, kimlik, IBAN; onay günler-haftalar | Yaklaşık %2,5-4 + küçük sabit ücret (kaynaklar tutarsız, teklif alın) | Siz satıcısınız: KDV + her satışa e-arşiv | Evet (TL, taksit) | Kafe karttan kendisi ödesin isterseniz; erken değil |
| **PayTR / Param** | iyzico gibi; aynı gün aktivasyon iddiası var (ikincil) | Hacme göre pazarlık, ~%1-4 (tutarsız) | Siz | Evet | Aynı; yinelenen (abonelik) ödeme için ayrıca sorulmalı. Şahıs şirketi başvurusunun reddedildiğini yazan bir forum notu var (tek kişi, genel kural değil) |
| **Paddle** (aracı satıcı) | Orta: yayında site, şartlar, iade ve gizlilik sayfası, kimlik; inceleme | Yaklaşık %5 + 0,50 $ (ikincil, 10 $ altı ürünlerde özel fiyat) | **Paddle** alıcıya satar, KDV/VAT'ı toplar ve öder; siz Paddle'a fatura edersiniz | Türkiye desteklenmeyen ülke listesinde yok (resmi sayfa özeti); bireysel/şahıs kabulü önceki araştırmada doğrulanmıştı, bu turda yeniden doğrulayamadım. Ödeme USD/EUR | **Yurt dışı bireyler ve küçük mekanlar için en uygun**; Türk mekan faturaları için gereksiz pahalı |
| **Lemon Squeezy** | Belirsiz | Yaklaşık %5 + 0,50 $ (ikincil) | Aracı satıcı | **Belirsiz**: Stripe'ın "Managed Payments" yapısına geçiyor; Türkiye desteği kanıtlanamadı (bir rakip sayfa desteklenmediğini iddia ediyor) | Plan yapmayın |
| **Stripe, doğrudan** | Türkiye'de işletme olarak hesap **açılamıyor** (çoğu kaynak aynı; bir düşük güvenilirlikli kaynak 2024'te açıldığını yazıyor, çelişki) | - | - | Hayır (yurt dışı şirketle evet) | Pilot/ilk satış için uygun değil |
| **Stripe Atlas** (ABD şirketi) | Yüksek: Delaware şirketi, yaklaşık 500 $ tek seferlik + yıllık yaklaşık 100 $ temsilci + eyalet vergisi/yıllık rapor; ayrıca ABD muhasebesi ve Türkiye'de kendi vergi durumunuz | Kart ücretleri + yıllık maliyetler | Siz (ABD şirketi olarak) | Yalnız yurt dışı şirketle; Türkiye vergi sonuçları için SMMM şart | Gelir büyüyene kadar gereksiz karmaşa |

### 4.3 Türkiye vergi/fatura, yüksek seviye (SMMM ile teyit edin)

- **Şahıs şirketi:** hızlı ve ucuz kurulur (kaynaklar kuruluş maliyeti için 1.500 ile 15.000 TL arası, çok tutarsız rakamlar veriyor). Gelir vergisi dilimli (%15-%40). Borçlardan kişisel malınızla sorumlusunuz.
- **Limited şirket:** daha pahalı ve hantal, sorumluluk sermaye ile sınırlı, kurumlar vergisi %25 (2026, kaynağa göre). Yüksek kazanç veya ortaklık düşünürseniz.
- **Fatura:** e-Fatura/e-Arşiv'e dahil olmayan mükellefler için 1 Ocak 2026'dan beri faturalar e-arşiv düzenlenmeli (kaynaklara göre). GİB e-Arşiv Portalı ücretsiz; küçük hacimde yeter. Havale ile satışta da fatura gerekir; ödeme yöntemi bunu değiştirmez.
- **KDV:** Türkiye'deki mekana verilen hizmette genelde %20 KDV (SMMM'ye sorun). Yurt dışı bir şirkete (Paddle) verilen hizmet için "hizmet ihracatı" KDV istisnası söz konusu olabilir; geçerlilik koşullarını SMMM'ye sorun.
- Sorun (tek tek): şahıs mı limited mi, "yazılım/hizmet ihracatı" indirimi veya genç girişimci (29 yaş altı) istisnası size uyar mı, abonelik ve hizmet sözleşmesinin KDV'si, mesafeli satış kuralları (mekana değil bireye satarsanız), ETBİS ve KVKK/VERBİS yükümlülüğü.

### 4.4 Öneri

- **(a) Gusto pilotu: ödeme yazılımı yok.** Tek sayfa **fiyat ve hizmet anlaşması** (süre, aylık ücret veya ücretsiz pilot, ad/logo izni, veri sorumlulukları) imzalayın; ücreti **havale** ile alın. Şirketiniz henüz yoksa SMMM'ye "pilot ücretsiz mi başlasın, yoksa önce şahıs şirketi mi açılsın" diye sorun: fatura kesmek için kayıt gerekir. Mühendislik: 0 gün.
- **(b) İlk Türk mekanlar:** aynı yöntem + sözleşme şablonu + aylık e-arşiv fatura. TV hakkı yönetici konsolundan elle girilir. Küçük yazılım iyileştirmesi: lisansa "bitiş tarihi/durum" (2-3 gün). 5+ mekan olunca iyzico veya PayTR düşünün.
- **(c) Küresel, sonra:** Paddle. Önce şirket kaydı + hukuk onaylı sayfalar (Paddle bunları ister). Mühendislik yaklaşık 8-12 gün. Başvuruyu kodlamadan önce yapın: Paddle sizi reddederse veya ücretler küçük biletleri öldürürse (10 $ altı), iyzico yedek yoldur (yalnız Türkiye).

---

## 5. Eren'in yapacakları listesi

Sıra: önce Gusto pilotunu engelleyenler. Süreler tahmindir.

**A. Pilotu engelleyenler**

1. **Gusto ile konuşun ve yazıya dökün:** fiyat veya ücretsiz pilot süresi, mekan adı/logosunun oyunda ve sitede kullanılması için **yazılı izin**, kim hangi gün prova yapar. *Pilotu engeller.* 1-2 saat + görüşme.
2. **Render hesabı** açın, ücretli plan seçin (ücretsiz plan kullanmayın). *Pilotu engeller.* 30 dk.
3. **Alan adını hazırlayın:** `quiz.archonbite.com` için CNAME kaydı (Netlify/Squarespace DNS'inde). *Pilotu engeller.* 30 dk + 1-24 saat bekleme.
4. **E-posta sağlayıcısı (Resend):** hesap, alan adı doğrulama, anahtar. Giriş kodları bununla gider. *Pilotu engeller.* 1 saat + doğrulama beklemesi.
5. **Gizli değerleri girin** (Render): yönetici e-postası, adresler, e-posta anahtarı. Parola yöneticisine kaydedin. *Pilotu engeller.* 1 saat. Adımlar: `docs/GUSTO_GO_LIVE.md`.
6. **Yönetici girişi, mekanı oluşturma, `venue.sessions` anahtarı, personel e-postaları.** *Pilotu engeller.* 30 dk.
7. **TV'yi bağlayın** (eşleştirme kodu) ve 15 dakikalık deneme masası açın. *Pilotu engeller.* 20 dk.
8. **Soru bankası:** 73 soru incelemede bekliyor; on dakikalık örnek kontrolü yapın (`docs/question-slices/OWNER-SAMPLE-CHECK.md`). Gusto'ya özel soruları kendi asistanınızla hazırlayıp yükleyin. *Pilotu etkiler* (soru yoksa oyun başlamaz). 1-2 saat.
9. **Yasal sayfaların asgarisi:** oyundaki gizlilik/şartlar sayfalarında sizin kimliğiniz ve iletişim adresiniz yazmalı. Taslakta **46 "doldurulacak" işareti** var (oyunda 39, sitede ~7). Hepsini doldurmak ve avukata okutmak satış için şart; pilotta en azından veri sorumlusu adı ve iletişim e-postası dolu olsun. *Pilot için kısmen, satış için tamamı.* 3-5 saat doldurma.
10. **Site için:** gerçek iletişim e-postası (`CONTACT_EMAIL`), oyun yayında anahtarı, Netlify yayını (`sites/archonbite/DEPLOY.md`). İngilizce metinleri okuyun. *Pilotu engellemez, ama "oyun yayında" görünsün diye gerekli.* 1-2 saat.
11. **Cihazlar:** Quiz Gecesi için bir **tablet** (10 inç, önerilir; yalnız 1024 px denendi) ve kafenin TV'sinin tarayıcısı. Satın almadan önce Gusto'daki mevcut cihazlarla deneyin. *Quiz Gecesi için engelleyebilir.* Süre: araştırma 1 saat. Fiyat için pazar araştırması yapın; ben rakam uydurmadım.
12. **Prova (Gusto'da, yarım gün):** `GUSTO_GO_LIVE.md` 11. adım listesi; bir telefon masası ve bir Quiz Gecesi; TV hoparlöründe sesleri dinleyin; Wi-Fi'ı izleyin. Sorunları bana yazın. *Pilotu engeller.* 4 saat.
13. **Yedek yönetici** ekleyin; her ay Render yedeğinin tarihine bakın. *İsteğe bağlı ama önerilir.* 15 dk/ay.

**B. Satışı engelleyenler**

14. **Mali müşavir görüşmesi:** şahıs mı limited mi, KDV, e-arşiv, hizmet sözleşmesi, ihracat istisnası, genç girişimci istisnası. *Satışı engeller.* 2 saat + şirket açılışı (günler).
15. **Şahıs şirketi kurun** (veya SMMM'nin önerdiği yapı), vergi levhası, e-arşiv için GİB kaydı. *Satışı engeller.* 2-4 saat + bekleme.
16. **Avukat görüşmesi:** 46 işaretli yasal metinler (KVKK aydınlatma, gizlilik, şartlar), kafe hizmet sözleşmesi şablonu. *Satışı engeller.* 3-5 saat + 1-3 hafta bekleme (tahmin).
17. **Fiyat kararı:** aylık kafe lisansı, TV sayısı, ek TV, Quiz Gecesi dahil mi. Siteye fiyat yazılacaksa bilgisini verin. *Satışı engeller.* 1-2 saat.
18. **Marka/ad kontrolü:** "QuizNight" ve "Archonbite" adı için tescil/benzer ad araştırması. *Satış öncesi önerilir.* 1-2 saat + avukat.
19. **Paddle başvurusu** (yurt dışı satış için): şirket ve hukuk sayfaları hazır olunca. Ücretleri ve 10 $ altı ürünler için özel fiyat sorun. *Küresel satışı engeller.* 1-2 saat + 1-3 hafta inceleme (tahmin).
20. **iyzico veya PayTR başvurusu:** yalnız Türkiye'de kartla ödeme isterseniz. *İsteğe bağlı.* 1-2 saat + günler-haftalar.

**C. İsteğe bağlı**

21. Salty Pirates sayfasının içeriği (`OWNER-FILL.md`). 2-4 saat.
22. Basın kiti, Gusto vaka sayfası. 2 saat.
23. İnternetsiz geceler için kafede mini bilgisayar (ileride).

---

## 6. Kaynaklar

Proje içi: `docs/TODO.md`, `docs/STATUS.md`, `docs/PLAN.md`, `docs/ACCEPTANCE.md`, `docs/GUSTO_GO_LIVE.md`, `docs/VENUE.md`, `docs/MONETIZATION_RESEARCH.md`, `docs/BUSINESS_MODELS_RESEARCH.md`, `docs/EXTERNAL_CHECKLIST.md`, ADR-0012, 0013, 0015, 0018, 0024-0031, `sites/archonbite/DEPLOY.md`, `OWNER-FILL.md`.

Web (veri olarak okundu; çoğu ikincil kaynak, resmi sayfalara ulaşılamayanlar belirtildi). Bağlantılar arama sonuçlarından alındı, tek tek açılıp doğrulanmadı:

- Paddle desteklenmeyen ülkeler (yardım merkezi): https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle
- Paddle geliştirici belgeleri, desteklenen ülkeler: https://developer.paddle.com/concepts/sell/supported-countries-locales
- Paddle Türkiye sayfası: https://www.paddle.com/billing/turkey
- Stripe hesap açma şartları (resmi): https://support.stripe.com/questions/requirements-to-open-a-stripe-account-in-another-country
- Türkiye'de Stripe yorumları (ikincil): https://www.manaycpa.com/tr/?p=69408 , https://mukellef.co/blog/?p=8544 , https://dodopayments.com/blogs/merchant-of-record-turkey
- Lemon Squeezy 2026 duyurusu ve ülkeler: https://www.lemonsqueezy.com/blog/2026-update , https://docs.lemonsqueezy.com/help/getting-started/supported-countries
- Stripe Managed Payments (Paddle'ın karşılaştırma sayfası, rakip kaynak): https://www.paddle.com/resources/stripe-managed-payments
- Stripe Atlas maliyeti (ikincil): https://www.rho.co/blog/stripe-atlas-review
- iyzico komisyon/başvuru (ikincil): https://www.ticimax.com/blog/iyzico-komisyon-oranlari , https://www.ideasoft.com.tr/yardim/iyzico-sanal-pos-kurulumu/
- PayTR (ikincil): https://www.ideasoft.com.tr/paytr-nedir-nasil-basvuru-yapilir/ , https://www.ideasoft.com.tr/paytr-komisyon-oranlari/
- Şahıs şirketi / limited, maliyet ve vergi (ikincil): https://www.parasut.com/blog/sahis-sirketi-ile-limited-sirket-arasindaki-farklar , https://www.faturaport.com/blog/crm/2026-sirket-kurma-maliyetleri-nelerdir-sahis-limited-anonim-karsilastirmasi , https://mukellef.co/blog/sahis-sirketi-kurma-maliyeti/
- e-arşiv ve GİB portalı (ikincil): https://www.parasut.com/blog/gib-portaldan-e-arsiv-fatura-kesmek , https://birfatura.com/gib-fatura-portali-rehberi/ , https://vergimerkezi.com.tr/?p=3446
- Resmi teyit için: https://ebelge.gib.gov.tr (e-arşiv), https://www.paddle.com/help , https://stripe.com/global
