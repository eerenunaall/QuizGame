# Demo günü kılavuzu (dükkân demosu)

Amaç: bir bilgisayar + TV + telefonlarla QuizNight'ı baştan sona oynatmak. Ek hesap, alan adı veya ödeme gerekmez.

## Cihazlar nasıl anlaşılır
- **Bilgisayar/TV tarayıcısı** (geniş, yatay ekran, en az 1000 px): adres açılınca otomatik **oyun ekranı** gelir.
- **Telefon** (dar veya dikey ekran): aynı adres otomatik **katıl ekranı** açar. QR kodu okutmak yeterli.
- Otomatik algı yanlış çıkarsa: TV'de `/tv` adresini, telefonda `/join` adresini elle aç.

## Hazırlık (demodan önce, evde bir kez dene)
1. Bilgisayarda: `pnpm install` sonra `pnpm playtest` (soruları ve oyunu kendisi hazırlar).
2. TV tarayıcısında `http://<bilgisayarın IP'si>:8080/tv` adresini aç, tam ekran yap (F11).
3. Telefonları **aynı Wi-Fi'ye** bağla, QR kodu okut.
4. Dükkân Wi-Fi'si cihazları birbirinden ayırıyorsa (misafir ağı): bilgisayarın telefon hotspot'unu kullan.
5. Farklı ağlar gerekiyorsa tünel: `cloudflared tunnel --url http://localhost:8080`, sonra
   `PUBLIC_WEB_URL=https://… pnpm playtest`.

## Görünüm ve içerik
- Siyah-altın dükkân teması: adrese `?theme=venue-gold` ekle (örn. `/tv?theme=venue-gold`). Cihazda hatırlanır.
- Kült dizi/film kategorileri lobide "Kategoriler" ayarından seçilir.
- Gusto logosu, kesin renkler ve yazı tipi sonra eklenecek (şimdilik yer tutucu).

## Demo sırasında sık sorunlar
| Belirti | Çözüm |
| --- | --- |
| Telefon QR'a bağlanmıyor | Aynı Wi-Fi mi? Güvenlik duvarı 8080'i engelliyor olabilir. |
| TV'de ses yok | TV tarayıcısında bir tuşa/tıkla (tarayıcılar sesi ilk etkileşime kadar kapalı tutar). |
| TV yavaş | Ayarlar'dan hareketi azalt (düşük hareket modu). |
| Oyun ortasında TV yenilendi | Sayfayı yenile; oda kaldığı yerden devam eder. |

## Dürüst sınırlar
Ses ve TV görünümü gerçek cihazda sizin tarafınızdan doğrulanmalı (geliştirme ortamında ses/ekran yok). Kült sorular
elden geçirilmeli. Mobil uygulama ve gerçek ödeme demoda yok; telefonlar tarayıcıdan oynar.
