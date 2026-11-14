# Kafe soru dosyası: şablon ve yapay zekâ yazısı

Bu sayfa, kafe sahibinin **Mekan paneli → Sorular → Soru yükle** ile yükleyeceği dosyanın biçimini ve bir
yapay zekâ asistanına yapıştırılacak hazır yazıyı içerir. Aynı metinler panelden de indirilir/kopyalanır
(`GET /v1/venues/:venueId/questions/template` ve `.../prompt`). Karar kaydı: `docs/ADR/0025-venue-question-sets.md`.
Adım adım kılavuz: `docs/VENUE.md`.

## Kurallar özeti

- Dosya UTF-8 **CSV** (virgül ya da noktalı virgül, başlık satırı şart) veya **JSONL** (satır başına bir JSON).
  Türkçe Excel'in "CSV UTF-8" çıktısı ve BOM kabul edilir; eski Windows-1254 "CSV" okunur ve uyarılır.
- En fazla **2000 soru** ve **2 MB** bir dosyada; kafe başına en fazla **5000 soru**, **20 özel kategori**.
- Her soru: kategori, zorluk (EASY/MEDIUM/HARD/EXPERT; kolay/orta/zor/uzman da olur), soru, en az 2 (tercihen 4) şık,
  doğru şık harfi (CSV: A-F) ya da sırası (JSONL: correctIndex, 0'dan başlar), isteğe bağlı açıklama ve kaynak adresi.
- Kategori: hazır kategori adı (ör. Tarih) ya da kafeye özel yeni ad (ör. Kutu Oyunları).
- Her soru yüklemeden önce otomatik denetlenir. Sorunsuz olanlar yayına girer; düzeltme isteyenler listelenir
  (düzeltip dosyayı yeniden yükleyin; yayına girmiş sorular tekrar sayılıp atlanır); reddedilenler hiç alınmaz.

## CSV şablonu

```csv
category,difficulty,question,optionA,optionB,optionC,optionD,correct,explanation,sourceUrl
Genel Kültür,EASY,Türkiye'nin başkenti neresidir?,İstanbul,Ankara,İzmir,Bursa,B,Başkent 1923'ten beri Ankara'dır.,
Tarih,MEDIUM,Malazgirt Savaşı hangi yılda yapılmıştır?,1071,1176,1243,1453,A,Savaş 1071 yılında Alp Arslan komutasındaki Selçuklular ile Bizans arasında yapıldı.,
Bilim,HARD,Periyodik tabloda atom numarası 79 olan element hangisidir?,Gümüş,Platin,Altın,Bakır,C,Altının simgesi Au harfleridir.,
Kutu Oyunları,EASY,Satranç tahtasında toplam kaç kare bulunur?,32,48,64,81,C,Tahta 8 sıra ve 8 sütundan oluşur.,
Kutu Oyunları,MEDIUM,Hangi oyunda şah mat denilince oyun biter?,Dama,Satranç,Tombala,Okey,B,Şah mat satrançta şahın kurtulamayacağı durumdur.,
Tarih,EXPERT,Osman Bey'in babası kabul edilen Kayı lideri kimdir?,Süleyman Şah,Dündar Bey,Ertuğrul Gazi,Gündüz Alp,C,"Osmanlı hanedanının kurucusu Osman Bey, Ertuğrul Gazi'nin oğludur.",
```

## JSONL örneği

```jsonl
{"category":"Genel Kültür","difficulty":"EASY","question":"Türkiye'nin başkenti neresidir?","options":["İstanbul","Ankara","İzmir","Bursa"],"correctIndex":1,"explanation":"Başkent 1923'ten beri Ankara'dır."}
{"category":"Kutu Oyunları","difficulty":"MEDIUM","question":"Hangi oyunda şah mat denilince oyun biter?","options":["Dama","Satranç","Tombala","Okey"],"correctIndex":1,"explanation":"Şah mat satrançta şahın kurtulamayacağı durumdur.","sources":[{"url":"https://tr.wikipedia.org/wiki/Satran%C3%A7","title":"Satranç"}]}
```

## Yapay zekâya yapıştırılacak yazı (CSV)

```text
Bir kafe için çoktan seçmeli bilgi yarışması soruları hazırlayacaksın. Sorular TV'de ve telefonlarda oynanacak.

KONU: [BURAYA KONUYU YAZ, örneğin: kutu oyunları, İzmir, 90'lar müziği]
SORU SAYISI: [BURAYA SAYIYI YAZ, örneğin: 60]

KURALLAR
1. Sorular Türkçe, doğal ve net olsun. Türkçe karakterleri (ç ğ ı ö ş ü İ) doğru kullan, ASCII'ye çevirme.
2. Her sorunun tam 4 şıkkı olsun, yalnızca biri doğru olsun. İki şık da doğru sayılabiliyorsa soruyu yazma.
3. Doğru şıkkın yeri A, B, C ve D arasında dengeli dağılsın (hep aynı harf olmasın). Doğru şık diğerlerinden belirgin biçimde uzun ya da kısa olmasın.
4. Cevabı soru metninde verme; "hepsi", "hiçbiri", "yukarıdakilerin hepsi" gibi şıklar kullanma; olumsuz ("hangisi değildir") soru yazma.
5. ZORLUK DAĞILIMI (toplam sayıya göre): yaklaşık %40 EASY, %35 MEDIUM, %20 HARD, %5 EXPERT.
6. Her soruya kısa bir açıklama yaz (en fazla 200 karakter): cevap neden doğru?
7. Emin olmadığın bilgiyi YAZMA. Zamana göre değişen bilgiler (güncel liderler, fiyatlar, "en son", "şu anki"), yaşayan kişilerle ilgili iddialar, siyaset, din, cinsellik ve küfür içeren sorular olmasın.
8. Her soru farklı olsun; aynı soruyu kelimelerini değiştirerek tekrar etme.
9. Kaynak adresi (sourceUrl) isteğe bağlıdır. Yalnızca gerçekten var olduğundan emin olduğun güvenilir bir sayfa adresini yaz; emin değilsen boş bırak. Adres uydurma.
10. KATEGORİ: şu hazır kategorilerden birini aynen yaz: Genel Kültür, Tarih, Coğrafya, Bilim, Doğa, Teknoloji, Sanat ve Kültür, Edebiyat, Sinema ve Dizi, Müzik, Oyun, Spor, Yeme İçme, Mitoloji ve Folklor, Dil ve Kelimeler, İş ve Ekonomi, Matematik ve Mantık. Kafeye özel bir kategori istiyorsan kendi adını yaz (örneğin "Kutu Oyunları"); en fazla 20 özel kategori kullanılabilir, ad en çok 40 karakter olsun.
11. Dosyada en fazla 2000 soru olsun.

ÇIKTI BİÇİMİ
Yalnızca tek bir kod bloğu içinde CSV ver (başka açıklama yazma). İlk satır tam olarak şu başlık olsun:
category,difficulty,question,optionA,optionB,optionC,optionD,correct,explanation,sourceUrl
- Alanlar virgülle ayrılır. Bir alanın içinde virgül ya da tırnak varsa alanı çift tırnak içine al, içerideki tırnağı iki kez yaz.
- difficulty: EASY, MEDIUM, HARD veya EXPERT.
- correct: doğru şıkkın harfi (A, B, C veya D).
- Her soru tek satırda olsun; satır içinde alt satıra geçme.
Örnek satırlar:
Genel Kültür,EASY,Türkiye'nin başkenti neresidir?,İstanbul,Ankara,İzmir,Bursa,B,Başkent 1923'ten beri Ankara'dır.,
Tarih,MEDIUM,Malazgirt Savaşı hangi yılda yapılmıştır?,1071,1176,1243,1453,A,Savaş 1071 yılında Alp Arslan komutasındaki Selçuklular ile Bizans arasında yapıldı.,
Bilim,HARD,Periyodik tabloda atom numarası 79 olan element hangisidir?,Gümüş,Platin,Altın,Bakır,C,Altının simgesi Au harfleridir.,

Bitirince her sorunun doğruluğunu bir kez daha kontrol et; emin olmadığın soruları listeden çıkar.
```

## Yapay zekâya yapıştırılacak yazı (JSONL)

```text
Bir kafe için çoktan seçmeli bilgi yarışması soruları hazırlayacaksın. Sorular TV'de ve telefonlarda oynanacak.

KONU: [BURAYA KONUYU YAZ, örneğin: kutu oyunları, İzmir, 90'lar müziği]
SORU SAYISI: [BURAYA SAYIYI YAZ, örneğin: 60]

KURALLAR
1. Sorular Türkçe, doğal ve net olsun. Türkçe karakterleri (ç ğ ı ö ş ü İ) doğru kullan, ASCII'ye çevirme.
2. Her sorunun tam 4 şıkkı olsun, yalnızca biri doğru olsun. İki şık da doğru sayılabiliyorsa soruyu yazma.
3. Doğru şıkkın yeri A, B, C ve D arasında dengeli dağılsın (hep aynı harf olmasın). Doğru şık diğerlerinden belirgin biçimde uzun ya da kısa olmasın.
4. Cevabı soru metninde verme; "hepsi", "hiçbiri", "yukarıdakilerin hepsi" gibi şıklar kullanma; olumsuz ("hangisi değildir") soru yazma.
5. ZORLUK DAĞILIMI (toplam sayıya göre): yaklaşık %40 EASY, %35 MEDIUM, %20 HARD, %5 EXPERT.
6. Her soruya kısa bir açıklama yaz (en fazla 200 karakter): cevap neden doğru?
7. Emin olmadığın bilgiyi YAZMA. Zamana göre değişen bilgiler (güncel liderler, fiyatlar, "en son", "şu anki"), yaşayan kişilerle ilgili iddialar, siyaset, din, cinsellik ve küfür içeren sorular olmasın.
8. Her soru farklı olsun; aynı soruyu kelimelerini değiştirerek tekrar etme.
9. Kaynak adresi (sourceUrl) isteğe bağlıdır. Yalnızca gerçekten var olduğundan emin olduğun güvenilir bir sayfa adresini yaz; emin değilsen boş bırak. Adres uydurma.
10. KATEGORİ: şu hazır kategorilerden birini aynen yaz: Genel Kültür, Tarih, Coğrafya, Bilim, Doğa, Teknoloji, Sanat ve Kültür, Edebiyat, Sinema ve Dizi, Müzik, Oyun, Spor, Yeme İçme, Mitoloji ve Folklor, Dil ve Kelimeler, İş ve Ekonomi, Matematik ve Mantık. Kafeye özel bir kategori istiyorsan kendi adını yaz (örneğin "Kutu Oyunları"); en fazla 20 özel kategori kullanılabilir, ad en çok 40 karakter olsun.
11. Dosyada en fazla 2000 soru olsun.

ÇIKTI BİÇİMİ
Yalnızca tek bir kod bloğu içinde JSONL ver (satır başına bir JSON nesnesi, başka açıklama yazma). Alanlar:
category, difficulty (EASY, MEDIUM, HARD veya EXPERT), question, options (4 metinlik liste), correctIndex (doğru şıkkın sırası: 0, 1, 2 veya 3), explanation, isteğe bağlı sources ([{"url": "...", "title": "..."}]).
Başka alan ekleme.
Örnek satırlar:
{"category":"Genel Kültür","difficulty":"EASY","question":"Türkiye'nin başkenti neresidir?","options":["İstanbul","Ankara","İzmir","Bursa"],"correctIndex":1,"explanation":"Başkent 1923'ten beri Ankara'dır."}
{"category":"Kutu Oyunları","difficulty":"MEDIUM","question":"Hangi oyunda şah mat denilince oyun biter?","options":["Dama","Satranç","Tombala","Okey"],"correctIndex":1,"explanation":"Şah mat satrançta şahın kurtulamayacağı durumdur.","sources":[{"url":"https://tr.wikipedia.org/wiki/Satran%C3%A7","title":"Satranç"}]}

Bitirince her sorunun doğruluğunu bir kez daha kontrol et; emin olmadığın soruları listeden çıkar.
```
