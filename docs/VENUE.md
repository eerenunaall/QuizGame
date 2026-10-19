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
   "Mekan modu bu sunucuda kapalı" der ve oyun eskisi gibi çalışır.
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
- **Günde en fazla ödül** (varsayılan 10): mekanın yerel gününe göre (gece yarısında sıfırlanır).
- **Aynı masada iki ödül arası en az (dk)** (varsayılan 5): bir ödülden hemen sonra başlatılan rövanş ödül kazanmaz.

Bir oyunun sonunda ödül **yalnızca şu durumda** verilir: ödül açık, yeterli oyuncu bağlı, masa süresi içinde
oynanmış ve süre dolduğu için **erken bitmemiş** bir oyun, günlük sınır dolmamış, birinci **tek** kişi.
**Beraberlikte ödül yok** (puan, doğru sayısı ve kalan süre de eşitse).

- Kazananın telefonunda büyük harflerle kod çıkar (ör. `36VK-6MAR`), altında ödül metni ve
  "Bu gece yarısına kadar geçerli". TV'de "Ahmet ödül kazandı! Kodu telefonunda." yazar. Kod başka hiçbir
  ekranda görünmez.
- Kasada: **Mekan paneli → Ödül doğrula**, kodu yazın (büyük/küçük harf ya da tire fark etmez), **Doğrula ve
  kullan**. "Geçerli! Ahmet: Bir türk kahvesi bizden" görürseniz ödülü verin. Aynı kod ikinci kez
  "Bu kod zaten kullanıldı" der; dünkü kod "Bu kodun süresi geçti" der.
- Çok sayıda yanlış deneme kısa süre engellenir ("Çok fazla deneme"). Kodlar sistemde açık hâliyle saklanmaz.

## Raporlar

Yönetim konsolunda **Mekanlar → Mekan oturumları**: her gün için açılan masa sayısı, satılan dakika
(açılış + uzatmalar), uzatma sayısı, verilen ve kullanılan ödül. **CSV indir** ile tabloya aktarılabilir.
Raporda oyuncu bilgisi yoktur, yalnızca sayılar. Ücretlendirme ve kasa kaydı sizin sisteminizde kalır.

## Sık sorulanlar

- **Süre oyunun ortasında biterse?** O soru cevaplanır, gösterilir, puanlar yazılır; sonra sonuçlar gelir.
  Uzatırsanız masa "Revanş" ile devam eder.
- **Müşteri kendi tam sürümünü bağlarsa?** Sorun değil; masa süresi yine geçerlidir, yeni oyun için süre gerekir.
- **İnternet kesilirse?** Sunucu yeniden başlarsa açık masalar ve kalan süreleri geri yüklenir.
- **Görevli işten ayrıldı.** Sahip, **Ayarlar → Görevliler** listesinden **Çıkar**'a basar.
