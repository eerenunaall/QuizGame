# Quiz Gecesi araştırma notları

Yöntem: WebSearch özetleri (bu sandbox'ta birçok siteye WebFetch kapalı; sayfaların tamamı okunmadı,
yalnızca arama özetleri kullanıldı). Kaynak kalitesi karışık; çelişen yerde daha ayrıntılı rehberler esas alındı.

## Format ve tempo
- Küçük mekânda 6 tur / ~1 saat, büyükte 8 tur / ~90 dk; tur başına tipik 10 soru.
- Turlar karışık olmalı: genel kültür ısınması, resim turu, tema turu, müzik, hızlı final. Her tur
  farklı hissettirince enerji düşmez.
- Yarı zaman (3. veya 4. turdan sonra): içecek siparişi ve puan kontrolü; mekân için gelir anı.
- Sunucu: sıcak, hızlı, akışı tutan; sorular sesli okunur, tur başına net bir tempo.
- Lig (sezon boyu birikimli puan) düzenli müşteriyi geri getirir. (Bu sürümde kapsam dışı.)

## Tur türleri
- Resim turu: "Bu nedir?" biçimi, 10-15 görsel. Müzik turu: 15-20 sn klip, 10-15 sn yazma süresi;
  telif/lisans nedeniyle bazı mekânlar yapamaz. Bu yüzden müzik önce yalnızca metin olarak gelir.
- Doğru/Yanlış ve "bağlantı" turları ara çeşitlilik için; Tahmin (sayı) soruları eşitlik bozmak için.
- Bonus sorular: yüksek puanlı, yarı zamanı veya finali heyecanlandırır.

## Joker / çift puan
- Klasik joker: her takım gece boyunca bir turu seçer, o turun puanı ikiye katlanır; çoğu quizde
  gece başına tek joker. Risk (zor tur) ilgi çeker. Biz soru bazlı, takım başına 2 hak (ayarlanabilir)
  ve sunucuya soru okunmadan söylenen 2x kartı kullanıyoruz (ADR-0029 §4).
- Joker kuralı sunucu tarafından herkes için aynı ve gözle görülür olmalı.

## Eşitlik bozma
- "En yakın sayı kazanır" tahmin sorusu (örn. piyanoda kaç tuş var). Tie-break sorusunu önceden
  hazırla; gece sonunda unutulur. Alternatif: tek temsilci düellosu (bu sürümde yok).

## Kâğıt ve puanlama
- Cevaplar kâğıda; takımlar komşu masayla kâğıt değiştirip sunucu doğru cevapları okurken
  işaretler (hile azalır, eğlence artar); itirazlarda sunucu son sözü söyler. Arama özetlerinde
  kâğıt değişimi ayrıntısı bulunamadı; bu adım bilinen mekân pratiğine dayanır ve "sunucu
  değiştirebilir" kuralıyla desteklenir.
- Kalem/kâğıt hazırlığı, mikrofon denemesi: gece öncesi kontrol listesi.

## ADR-0029'a çıkan kararlar
1. Tur türleri: NORMAL, RESİM, MÜZİK (metin), DOĞRU/YANLIŞ, TAHMİN, BONUS.
2. Tahmin sorusu en-yakın-kazanır; 2x joker tahmin sorusunda kapalı. Tie-break sorusu ayrı bir tahmin sorusu.
3. Kâğıt değişimi sırası (Masa 1 → Masa 2 …) sunucuda hesaplanır, sunucu geçersiz kılabilir.
4. Yarı zaman slaytı ve puan tablosunda sıra değişimi ok'ları; eşit puanda yarışma sıralaması (1,1,3).
5. Joker yalnızca soru TV'ye çıkmadan önce söylenir ve kilitlenir; takım başına hak sınırı sunucuda.

## Kaynaklar
- https://quizado.com/how-to-run-pub-quiz
- https://pubquiz-ccj.pages.dev/blog/how-to-run-a-pub-quiz/
- https://pubquiz-ccj.pages.dev/blog/how-many-rounds-pub-quiz/
- https://www.power-pubquiz.com/blogs/news/how-to-set-up-and-run-a-pub-quiz
- https://www.paulsquiz.com/quiz-advice-and-tips-mainmenu-199/203-trivia-quiz-resources/41-quiz-advice/2276-running-a-pub-quiz
- https://en.wikipedia.org/wiki/Pub_quiz
- https://wiki.warwick.film/wiki/Pub_Quiz_for_Quizmasters
- https://quizado.com/pub-quiz-picture-round
