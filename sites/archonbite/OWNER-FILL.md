# Salty Pirate: senden ne lazım? (kısa liste)

Salty Pirate sayfası **hazır bir şablon**. Depoda bu oyun hakkında hiçbir bilgi yok, bu yüzden ben **hikâye, özellik,
fiyat, platform, tarih ya da ekran görüntüsü uydurmadım**. Sayfadaki pirat görselleri benim çizdiğim **yer tutucu**
sahne resimleridir (sayfada "Yer tutucu görsel" etiketi var). Aşağıdakileri gönder, sayfa gerçek olsun.

Önizleme: sayfanın sonuna `?edit=1` ekle (`.../games/salty-pirate/?edit=1`): hâlâ yer tutucu olan her bölüm turuncu
çerçeveyle işaretlenir.

## Gönder / hazırla

1. **Logo**: şeffaf PNG ya da SVG, en az 800 px geniş. → `assets/salty-pirate/logo.png` (sonra `games.json` → `art` içine
   `"logo": "assets/salty-pirate/logo.png", "logo_w": 800, "logo_h": 300` ekle; yoksa sayfa yazıyla başlık gösterir)
2. **En az 5 ekran görüntüsü**: yatay, 1920×1080 (ya da 1280×720), PNG/JPG/WebP. → `assets/salty-pirate/shot-1.jpg` …
3. **Kapak görselleri**: ana görsel 1600×900 ve küçük kapak 920×430. → `key-art.jpg`, `capsule.jpg`
4. **Fragman bağlantısı**: YouTube adresi (ör. `youtube.com/watch?v=XXXXXXXXXXX`) + bir kapak resmi. İstersen yok.
5. **Kısa açıklama** (1–2 cümle) ve **uzun açıklama** (2–4 paragraf), **Türkçe ve İngilizce**.
6. **Slogan** (tek cümle), TR + EN.
7. **Özellikler**: 4–8 madde, her biri başlık + 1–2 cümle (TR + EN).
8. **Etiketler**: 5–8 kelime (ör. tür, perspektif, tema).
9. **Platformlar** (PC, mobil, web…) ve **durum** (geliştiriliyor / erken erişim / çıktı).
10. **Çıkış tarihi** (ya da "Yakında").
11. **Fiyat**: ücretsiz mi, kaç TL / $? Yoksa "açıklanacak".
12. **Mağaza bağlantısı** (Steam vb.) varsa adresi.
13. **Sistem gereksinimleri**: asgari ve önerilen (işletim sistemi, işlemci, bellek, ekran kartı, depolama).
14. **Haberler** varsa: tarih + başlık + 2 cümle.

## Nereye konur?

* Resimleri `sites/archonbite/assets/salty-pirate/` klasörüne yükle (GitHub'da **Add file → Upload files**).
  Aynı adla değiştirirsen eski görsel tarayıcıda 1 saate kadar görünebilir.
* Yazılar `sites/archonbite/data/games.json` içinde, `"id": "salty-pirate"` bölümünde. Her metin
  `{ "tr": "...", "en": "..." }` biçimindedir. Bir bölümü gerçek içerikle doldurunca o bölümün adını `"todo": [...]` listesinden
  sil; gerçek görseli koyduğun satırdan `"placeholder": true` yazısını sil.
* Çok mu zor? Maddeleri bana (ya da Claude'a) yaz/yapıştır, dosyaya ben işlerim.

## Diğer TODO-OWNER maddeleri (site genelinde)

* `assets/config.js` → **`CONTACT_EMAIL`**: şu an `hello@archonbite.com` yer tutucu; gerçek, okuduğun adres.
* `assets/config.js` → **`PLAY_LIVE`** / **`PLAY_URL`**: `quiz.archonbite.com` yayına girince doğrula.
* **Yasal sayfa** (`/legal/`): kısa bir taslak, hukuki tavsiye değil. Veri sorumlusu adı/adresi ve KVKK/GDPR haklar
  metni için avukat onayı lazım.
* **Gusto Board Game Cafe**: TV mekan teması ekran görüntüsünde ve haberlerde Gusto adı/logosu geçiyor. Kullanmak için
  Gusto'dan izin al ya da `tv-gusto.webp` görselini ve haber satırını kaldır.
* **Stüdyo hakkında**: istersen kuruluş yılı, şehir, kurucu adı/fotoğrafı ve sosyal medya bağlantıları (şimdilik yok).
* **Fiyat**: QuizNight için henüz karar yok; karar verince `data/games.json` → `quiznight` → `meta.price` ve kılavuzdaki SSS.
* **İngilizce metinler**: çevirileri bir kez okuyup onayla (`assets/i18n/en.json`).
