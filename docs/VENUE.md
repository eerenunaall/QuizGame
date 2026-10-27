# Mekan modu: kafe sahipleri ve görevliler için kılavuz

Bu sayfa, QuizNight'ı bir kutu oyunu kafesinde (ilk müşterimiz Gusto Board Game Cafe) **süreli masa**
olarak çalıştıranlar içindir. Teknik karar kaydı: `docs/ADR/0024-venue-mode.md`.

## Kısaca

- Müşteri giriş ücretini **kasada size öder** ve hangi oyunu istediğini söyler. Uygulama hiçbir zaman
  para almaz, kart bilgisi istemez, fiyat göstermez. Sistem yalnızca **süreyi tutar**.
- Quiz isteyen masa için görevli, telefonundaki **Mekan paneli** (`/staff`) sayfasından TV'de bir masa açar
  (ör. 60 dakika). Süre bitene kadar oyun tam sürüm açıktır ve kendi kendine akar.
- Süre bitince o anki soru **asla yarıda kesilmez**: soru biter, sonuçlar gösterilir, yeni oyun başlatılamaz.
  TV'de "Süre doldu - uzatmak için görevliye söyleyin" yazar.
- Görevli **+15 / +30 / +60 dk** ile uzatır; TV yeniden yüklemeden açılır, masa kaldığı yerden devam eder.
- İsterseniz kazanana küçük bir ödül verebilirsiniz (ör. "Bir içecek bizden"). Kazananın telefonunda
  8 haneli bir kod çıkar; kasada bu kodu panelden doğrularsınız. Her kod **bir kez** kullanılır.

## Başlamadan önce (bir kez)

1. Yönetici, yönetim konsolunda (`/admin` → **Mekanlar**) mekanınızı oluşturur ve sahibin e-posta adresini girer.
2. Yönetici **Özellik anahtarları** sayfasında `venue.sessions` anahtarını açar. Kapalıyken mekan paneli
   "Mekan modu bu sunucuda kapalı" der ve oyun eskisi gibi çalışır. Anahtar kapatıldığında açık masalar da bırakılır (en geç 20 saniyede TV
   normal oyuna döner, süre ve ödül işlemez); anahtarı yeniden açıp masayı uzattığınızda masa kaldığı yerden devam eder.
3. Sahip, telefonundan `https://<sunucu>/staff` adresini açar, e-postasına gelen 6 haneli kodla giriş yapar.
4. Sahip **Ayarlar** sekmesinden görevlileri e-posta adresiyle ekler. Eklenen kişi aynı adresle giriş
   yaptığında panele girer (davet e-postası gönderilmez; adresi siz söylersiniz).

## Masa açmak

1. TV'de QuizNight'ı açın ve **"TV'de oyunu başlat"** deyin. Ekranda 6 harfli **oda kodu** görünür.
2. Telefonunuzda **Mekan paneli → Yeni masa**.
3. Süreyi seçin (30 / 60 / 90 / 120 dk ya da elle yazın).
4. TV'deki oda kodunu yazın ve **Masayı aç**'a basın.
   - Alternatif: TV'de "Tam oyunu aç" düğmesine basınca çıkan **QR kodunu** telefonunuzun kamerasıyla okutun.
     Açılan sayfada giriş yaptıktan sonra **"Mekan görevlisi misin? Bu TV'yi masa olarak aç"** bağlantısına
     dokunun; kod yazmadan aynı TV'de masa açılır.
5. TV'nin sağ üst köşesinde, oda kodunun yanında **Kalan süre** görünür. Son 5 dakikada sarı, son 1 dakikada
   kırmızı olur. Soruların üstünü asla kapatmaz.
6. Müşteriler kendi telefonlarıyla TV'deki QR kodu okutup katılır ve oyunu başlatır.

Bir TV'de aynı anda tek masa açık olabilir. Oyun sürerken o TV'de yeni masa açılamaz.

## Masalar sekmesi

Her açık masa için:

| Düğme | Ne yapar |
| --- | --- |
| **+15 dk / +30 dk / +60 dk** | Süreyi uzatır. Süre bitmişse, bittiği andan uzatma anına kadar geçen zaman **sayılmaz**: +15 dk her zaman "şu andan itibaren 15 dakika"dır. |
| **Duraklat** | Saati durdurur (ör. masa mola verdi). Duraklatılmış masada yeni oyun başlamaz; oynanan oyun, o soru bitince sonuçlara geçer. |
| **Devam** | Saati kaldığı yerden yeniden başlatır. |
| **Bitir** | Masayı kapatır (iki kez dokunarak onaylanır). Kalan süre geri gelmez. TV "Süre doldu" ekranına geçer. |

"TV bağlı değil" yazıyorsa o TV'deki oda kapanmıştır (ör. TV uzun süre kapalı kaldı). Masayı **Bitir** ile
kapatıp kalan dakikayla yeni bir masa açın. Süre doldu ekranındaki masa bekleyen bir TV kendiliğinden kapanmaz;
masa bitirilince normal bekleme süreleri yeniden geçerli olur.

## Ödüller

**Ayarlar** (yalnızca sahip):

- **Kazanana ödül ver**: açık/kapalı. Açıksa **ödül metnini** yazın (ör. "Bir türk kahvesi bizden").
- **Ödül için en az oyuncu** (varsayılan 3): oyun bittiğinde bağlı ve sıralamada olan oyuncu sayısı.
- **Günde en fazla ödül** (varsayılan 10): mekanın yerel gününe göre (gece yarısında sıfırlanır). Kazanılan ödül kodu gece yarısına kadar, ama en az 4 saat geçerlidir.
- **Aynı masada iki ödül arası en az (dk)** (varsayılan 5): bir ödülden hemen sonra başlatılan rövanş ödül kazanmaz.

Bir oyunun sonunda ödül **yalnızca şu durumda** verilir: ödül açık, yeterli oyuncu bağlı, masa süresi içinde
oynanmış ve süre dolduğu için **erken bitmemiş** bir oyun, günlük sınır dolmamış, birinci **tek** kişi.
**Beraberlikte ödül yok** (puan, doğru sayısı ve kalan süre de eşitse).

- Kazananın telefonunda büyük harflerle kod çıkar (ör. `36VK-6MAR`), altında ödül metni ve
  "Bu akşam kullanın: en az 4 saat geçerli". TV'de "Ahmet ödül kazandı! Kodu telefonunda." yazar. Kod başka hiçbir
  ekranda görünmez.
- Kasada: **Mekan paneli → Ödül doğrula**, kodu yazın (büyük/küçük harf ya da tire fark etmez), **Doğrula ve
  kullan**. "Geçerli! Ahmet: Bir türk kahvesi bizden" görürseniz ödülü verin. Aynı kod ikinci kez
  "Bu kod zaten kullanıldı" der; dünkü kod "Bu kodun süresi geçti" der.
- Çok sayıda yanlış deneme kısa süre engellenir ("Çok fazla deneme"). Kodlar sistemde açık hâliyle saklanmaz.

## Takım modu ve Basit mod

Teknik karar kaydı: `docs/ADR/0026-teams-and-simple-ruleset.md`. Varsayılan hâlinde hiçbir şey değişmez: oyun
bireysel ve tam kurallarla oynanır.

### Takım modu

- Masayı **Bireysel** ya da **Takım** olarak başlatabilirsiniz. Varsayılanı **Ayarlar → Oyun şekli ve kurallar**
  bölümünden seçersiniz; oyunun lideri de TV'deki ya da kendi telefonundaki ayarlardan değiştirebilir.
- Takım adlarını, simgelerini ve renklerini **biz** belirleriz; oyuncular yazmaz, yalnızca telefonda bir takım
  düğmesine dokunur. Hazır takımlar: Kaplanlar, Baykuşlar, Tilkiler, Aslanlar, Ayılar, Ejderhalar, Balinalar,
  Penguenler. İsterseniz sahip olarak **Takım adları** kutularına kendi adlarınızı yazabilirsiniz (en çok 20
  karakter, boş bırakılan varsayılan adı kullanır).
- Oyuncu önce takma adını seçer, sonra kendi takımına dokunur. Katılan ilk önce en küçük takıma düşer; arkadaşları
  aynı takıma dokunarak geçer. Lider (ya da TV) bir oyuncuyu başka takıma **taşıyabilir** (oyuncuya dokun, takımı seç).
- Takım sayısı 2, 3 ya da 4'tür (varsayılan 2). Bir takım en çok `ceil(8 / takım sayısı)` kişi alır; dolu takım
  "Dolu" yazar. Oyun başlamadan en az iki takımda oyuncu olmalı ve takımlar arasında en çok 1 kişi fark olmalıdır
  (TV ve lider telefonu nedenini yazar; "Takımlar dengesiz").
- **Puan**: herkes tek başına cevaplar ve puan toplar. Takımlar **oyuncu başına ortalama puanla** sıralanır
  (toplam yanında yazar), böylece 3 kişilik takım 2 kişiliğe karşı haksız avantaj ya da dezavantaj yaşamaz.
  Oyundan çıkan oyuncu takımın hem toplamından hem ortalamasından düşer.
- **Sabotaj** bir **rakip takıma** yapılır; takımın o sorudaki bütün oyuncularını etkiler. Kalkan takımındır (oyun
  başına 1) ve sabotajı bütün takım için engeller.
- **Ödül** takım oyununda da **tek koddur**: kazanan takımın en yüksek puanlı, bağlı oyuncusunun telefonuna gelir.
  Beraberlikte, ya da bir takımın hiç telefonu bağlı değilse ödül verilmez. Kasada kod yine bir kez geçerlidir;
  takıma ne vereceğinize siz karar verirsiniz.

### Basit mod

Kafe kalabalığının 5 saniyede anlayacağı kurallar: **50/50**, **Çifte Hak** (doğruysa 2 kat puan, yanlışsa ceza) ve
üç sabotaj: **Süre kes** (rakibin cevap süresi 6 sn kısalır), **Karıştır** (seçenekler yer değiştirir), **Kör saat**
(telefonda geri sayım görünmez). Bahis, Örtü, Düello, Havuz, Kesme yoktur. Soru başına tek, kısa bir **HAZIRLAN**
ekranı vardır (en çok 10 sn); kimsenin kullanacak gücü yoksa hiç gösterilmez.

- **Cevap süresi 30 sn** (Hız turu 12 sn, Final 20 sn). Sorunun okunması için ayrı bir bekleme vardır; seçenekler
  ondan sonra açılır. Süreyi **Ayarlar → Basit kurallarda cevap süresi** kutusundan 10-60 sn arasında değiştirebilirsiniz.
- **Soru yalnızca TV'de görünür.** Basit modda telefonlara soru metni gönderilmez; telefon yalnızca şıkları
  (harf + metin) gösterir ve "Soruyu göster" düğmesi de çıkmaz. Cevaplar açıklanınca her şey görünür.
  Not: yanındaki arkadaşın sesli okuması ya da ikinci bir telefon bu önlemi aşar; bu bir engel değil, kolay yolun
  kapatılmasıdır. Sekmeden çıkmayı algılayan bir uyarı yapılmadı: istemcinin bildirdiği bir şey olduğu için
  kolayca yanıltılır, gelen aramayı ya da bildirimi de cezalandırır.

## Raporlar

Yönetim konsolunda **Mekanlar → Mekan oturumları**: her gün için açılan masa sayısı, satılan dakika
(açılış + uzatmalar), uzatma sayısı, verilen ve kullanılan ödül. **CSV indir** ile tabloya aktarılabilir.
Raporda oyuncu bilgisi yoktur, yalnızca sayılar. Ücretlendirme ve kasa kaydı sizin sisteminizde kalır.

## Kafenizin kendi soruları (yalnızca sahip)

Kafenize özel sorular (kutu oyunlarınız, semtiniz, mekân şakalarınız) yükleyebilirsiniz. Yüklediğiniz sorular
**yalnızca sizin masalarınızda** çıkar; herkese açık oyunda ve başka kafelerde asla görünmez. Kod değişikliği ya da
yeniden kurulum gerekmez: içe aktarılan sorular hemen sonraki oyunda kullanılır. Teknik karar kaydı:
`docs/ADR/0025-venue-question-sets.md`. Şablon ve yapay zekâ yazısı: `docs/venue-question-template.md`.

**Kim yükler?** Yalnızca **sahip** yükler, kaldırır, dışa aktarır ve soru kaynağını seçer. Görevli **Sorular**
sekmesinde yüklemelerin listesini ve soru sayılarını görür, başka bir şey yapamaz.

### Adım adım

1. Telefonunuzda `https://<sunucu>/staff` adresini açın, e-postanıza gelen kodla giriş yapın, **Sorular** sekmesine girin.
2. **Dosyayı nasıl hazırlarım?** bölümünü açın:
   - **CSV şablonunu indir** ile örnek dosyayı alıp Excel / Google E-Tablolar'da kendiniz doldurabilirsiniz, ya da
   - **Yapay zekâya yapıştırılacak yazıyı kopyala** düğmesine basın, yazıyı ChatGPT, Claude, Gemini gibi bir yapay zekâ
     asistanına yapıştırın. Yazının başındaki `[KONU]` ve `[SORU SAYISI]` yerlerini doldurun (ör. "kutu oyunları, 60").
     Asistan size bir CSV kod bloğu verir; bunu kopyalayın.
3. **Soru yükle** altında dosyayı seçin **ya da** yapay zekânın verdiği metni "buraya yapıştır" kutusuna yapıştırın.
   Excel kullanıyorsanız **Dosya → Farklı Kaydet → CSV UTF-8** seçin (Türkçe Excel'in noktalı virgüllü CSV'si de okunur;
   `.xlsx` dosyası yüklenemez).
4. **Kontrol et**'e basın. Henüz hiçbir şey kaydedilmez; bir **rapor** görürsünüz:
   - kaç soru yayına girecek, kaç soru düzeltme bekliyor / reddedildi / okunamadı / tekrar, kategori başına sayılar,
     oluşacak yeni kategoriler;
   - her sorunlu satır için **ne yanlış ve nasıl düzelir** (Türkçe): ör. "Doğru şık belirtilmemiş. correct sütununa A, B, C
     veya D yaz."
5. Sorunlu satırları dosyada düzeltin ya da yapay zekâdan düzeltmesini isteyin (raporu yapıştırabilirsiniz). Hazır olunca
   **İçe aktar**'a basın. Sorunsuz satırlar **otomatik yayına girer**; düzeltme isteyenler yayına girmez ve listelenir.
   Düzelttiğiniz dosyayı yeniden yüklediğinizde zaten yayında olan sorular "tekrar" sayılıp atlanır, yalnızca yeni
   düzeltilenler eklenir. Aynı dosyayı iki kez yüklemek hiçbir şeyi değiştirmez.
6. Masayı her zamanki gibi açın (**Yeni masa**). Oyun, **Soru kaynağı** ayarınıza göre sorularınızı kullanır.

### Soru kaynağı (Sorular sekmesi, sahip)

| Seçenek | Ne olur |
| --- | --- |
| **Karışık** (varsayılan) | Her oyunda soruların yaklaşık %30'u sizin setinizden, kalanı ortak havuzdan gelir (oranı %5-95 arası değiştirebilirsiniz). |
| **Yalnızca kafenin soruları** | Sizin sorularınız öncelikli; yetmezse oyun durmasın diye eksik kısım ortak havuzdan tamamlanır. |
| **Yalnızca ortak havuz** | Sorularınız kullanılmaz (silinmez). |

Kafeye özel kategoriler (en çok 20) "tüm kategoriler" ile oynanan oyunlarda çıkar; herkese açık kategori seçim
ekranında görünmezler.

### Tekrar eden soru olmasın

Sistem masanızda oynanan soruları hatırlar ve yeni oyunları **kafenizde yakın zamanda çıkmamış** sorulardan kurar
(her kategoride son 300 soru "yakın" sayılır). Havuz küçükse en uzun zamandır çıkmayan sorular önce gelir; oyun hiçbir
zaman beklemez. Bu, ortak havuz sorularında da geçerlidir.

### Yüklemeyi kaldırmak, dışa aktarmak, bildirimler

- **Bu yüklemeyi kaldır** o dosyadaki tüm soruları oyundan çıkarır (silinmez; iki dokunuşla onaylanır). Aynı dosyayı
  sonradan yeniden yükleyebilirsiniz.
- **Soruları CSV olarak indir** yayındaki sorularınızı aynı biçimde verir; düzenleyip yeniden yükleyebilirsiniz.
- Oyuncular bir soruyu "bildir" ile işaretleyebilir. Sizin sorularınıza gelen bildirimleri **Oyuncu bildirimleri**
  bölümünde görürsünüz (kimin bildirdiği görünmez): **Yoksay** ya da **Soruyu kaldır**. Birkaç ciddi bildirim soruyu
  kendiliğinden oyundan çıkarır. Yönetici de aynı bildirimleri görür ve bir yüklemeyi ya da soruyu oyundan çıkarabilir.

### Sınırlar

Dosya başına en fazla **2000 soru** ve **2 MB**; kafe başına en fazla **5000 soru** ve **20 özel kategori**; kısa sürede
çok sayıda yükleme denemesi geçici olarak engellenir. Metinlerde görünmeyen karakterler, bağlantılar ve uygunsuz
ifadeler sistem tarafından temizlenir ya da soru reddedilir. Sorular ekranlarda her zaman düz yazı olarak gösterilir.

### Dikkat: doğruluk sizin sorumluluğunuzdadır

Merkezi soru havuzundaki sorular kaynaklarla denetlenir; **sizin yüklediğiniz sorular denetlenmez**: sistem yalnızca
biçimi, yazımı, tekrarı ve uygunsuz içeriği kontrol eder, bilginin doğruluğunu kontrol edemez. Yapay zekânın verdiği
bilgileri yayına almadan önce gözden geçirin; yanlış çıkan soruyu kaldırın.

## Sık sorulanlar

- **Süre oyunun ortasında biterse?** O soru cevaplanır, gösterilir, puanlar yazılır; sonra sonuçlar gelir.
  Uzatırsanız masa "Revanş" ile devam eder.
- **Müşteri kendi tam sürümünü bağlarsa?** Sorun değil; masa süresi yine geçerlidir, yeni oyun için süre gerekir.
- **İnternet kesilirse?** Sunucu yeniden başlarsa açık masalar ve kalan süreleri geri yüklenir.
- **Görevli işten ayrıldı.** Sahip, **Ayarlar → Görevliler** listesinden **Çıkar**'a basar.
