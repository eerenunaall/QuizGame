# Gözden geçirme kuyruğu (REVIEW-QUEUE)

Kaynak: bağımsız inceleme turu R1 (`seed/gusto/audits.R1.jsonl`, etiket `independent-reviewer-agent`). Bu inceleme bir **yapay zekâ modeli** tarafından yapıldı; yazar modellerden ayrı bir bağlamdı ama insan onayı değildir. Aşağıdaki satırlar ya yeniden yazılmalı ya da bir insanın karar vermesi gerekiyor.

Sonuç: 445 ACTIVE, 44 REVIEW, 9 REJECTED (toplam 498).

Nasıl düzeltilir: `seed/gusto/questions.*.tr.jsonl` içinde soruyu düzenle (yeni sürüm = yeni revizyon), sonra `scripts/question/audit-batch.md` içindeki prosedürle yalnızca değişen satırları yeniden denetle.

## A. Yeniden yazılacak veya doğrulanacak (36)

| id | soru | sorun | öneri |
|---|---|---|---|
| a-geography-041 | Sahra, yüzölçümü bakımından hangi iki kutup çölünün ardından dünyanın üçüncü büyük çölü sayılır? | Soru kökü "iki kutup çölü" dediği için yalnızca ilk seçenek (Antarktika ve Arktik) uyuyor; çeldiriciler elenebilir (cevap biçimden çıkıyor) | Dünyanın en büyük sıcak çölü hangisidir? (Sahra / Arap Çölü / Kalahari / Taklamakan; doğru: Sahra) |
| a-geography-047 | Dünyanın en büyük adası Grönland hangi krallığın özerk parçasıdır? | Yalnızca "Danimarka Krallığı" ve "Norveç Krallığı" seçeneklerinde "Krallığı" var; sorudaki "krallığın" kalıbı biçimle ipucu veriyor | Grönland hangi ülkenin özerk bölgesidir? Danimarka / Norveç / Kanada / İzlanda (doğru: Danimarka) |
| a-geography-008 | Bagratlı Ermeni Krallığı'na başkentlik etmiş, 2016'da UNESCO Dünya Mirası Listesi'ne giren Ani Harabeleri hangi ildedir? | Açıklamada yazım hatası: "Armenistan" (doğrusu Ermenistan); soru ve cevap doğru | Açıklamada "Armenistan sınırını" yerine "Ermenistan sınırını" yazılsın |
| a-geography-063 | Denizaşırı toprakları sayesinde dünyada en çok saat dilimine sahip ülke hangisidir? | Cevap (Fransa) doğru ama açıklamadaki "Saint-Pierre ve Miquelon'da yaz saati uygulanırken 13" ifadesi tutarsız ve kaynaksız; saat dilimi sayısı sayım yöntemine göre 12 veya 13 | Açıklamayı sadeleştir: "Fransa, denizaşırı toprakları sayesinde 12 saat dilimiyle (Antarktika iddiası dahil 13) en çok dilime sahip ülkedir." |
| b-art-culture-035 | Eyfel Kulesi hangi büyük etkinlik için yapılmıştır? | Çeldiriciler zayıf: "1871 Paris Komünü anması" ve "1804 İmparatorluk töreni" bir kule için akla yatkın değil | Çeldiriciler: 1900 Paris Dünya Fuarı / 1878 Paris Dünya Fuarı / 1900 Paris Olimpiyatları; doğru: 1889 Paris Dünya Fuarı |
| b-art-culture-028 | Milo Venüsü, 1820'de hangi Ege adasında bulunmuştur? | Cevap soru adında geçiyor (Milo Venüsü -> Milos); oyun değeri düşük | Milo Venüsü şu an hangi müzede sergilenir? Louvre / British Museum / Uffizi / Prado (doğru: Louvre) |
| b-art-culture-085 | İstanbul Bienali'nin öncüsü olan ilk uluslararası çağdaş sanat sergileri, İKSV tarafından hangi yıl düzenlenmiştir? | Soru kökü "İstanbul Bienali'nin öncüsü olan ilk uluslararası çağdaş sanat sergileri" bulanık: 1987 sergisi bienalin kendisi sayılır | İKSV'nin düzenlediği ilk İstanbul Bienali hangi yıl yapılmıştır? (doğru: 1987) |
| b-art-culture-044 | Çaykovski'nin Kuğu Gölü balesi 1877'de ilk kez hangi şehirde sahnelenmiştir? | Cevap (Moskova) doğru ama kayıtlı kaynak Kuğu Gölü değil "The Nutcracker" sayfası: kaynak iddiayı desteklemiyor | Kuğu Gölü (1877 Bolşoy prömiyeri) için doğru kaynak ekle |
| b-art-culture-015 | Velázquez'in 1656 tarihli “Las Meninas” tablosu hangi müzededir? | Açıklama bozuk Türkçe ("tablo ... tablo", "sahnesindeki Madrid Alcázar'ının"); soru ve cevap doğru | Açıklama: "Türkçede “Nedimeler” de denir. Velázquez tabloyu Madrid Alcázar'ındaki Prens Dairesi'nde yapmıştır; bugün Prado Müzesi'ndedir." |
| b-art-culture-069 | İznik çinilerinin canlı kırmızısı, hangi demirce zengin kile dayanır? | Kökte "kil" denince çeldiricilerin üçü (kobalt oksit, bakır oksit, antimon) kil olmadığı için eleniyor; cevap biçimden çıkıyor | Kökü "İznik çinisinin canlı kırmızısını veren malzeme hangisidir?" yap; çeldiriciler: Kobalt oksit / Bakır oksit / Kurşun oksit |
| b-art-culture-027 | Rodin'in “Düşünen Adam” heykeli ilk tasarlandığında hangi adı taşıyordu? | "Dante" çeldiricisi savunulabilir: heykel Dante'yi canlandırıyordu ve kimi kaynaklar böyle anar; ilk ad "Şair" (Le Poète) | "Dante" seçeneğini "Orfeus" ile değiştir, ya da kaynakla "Şair" adını doğrula |
| c-breaking-bad-021 | Hank'in bulduğu “Leaves of Grass” nüshasını Walt'a kim hediye etmiştir? | Açıklamadaki "Sunset bölümünde verir" kaynaksız; hediye ekranda gösterilmez, yalnızca "Gliding Over All"daki ithaf görülür; cevap (Gale) doğru | Açıklama: "Gale'in el yazısıyla ithaf yazdığı nüshayı Hank 'Gliding Over All' bölümünde Walt'ın banyosunda bulur." |
| c-breaking-bad-002 | “Breaking bad” deyimi, dizinin yaratıcısına göre günlük Güney Amerikan argosunda neye karşılık gelir? | "Güney Amerikan argosu" Güney Amerika kıtası gibi okunuyor; kastedilen ABD'nin güneyi | "Dizinin yaratıcısına göre ABD'nin güneyindeki günlük konuşmada “breaking bad” neye karşılık gelir?" |
| c-breaking-bad-059 | Walt, “Felina”da kaçıncı doğum gününde makineli tüfek satın almaya gider? | Soru yanlış bölüme bağlı: makineli tüfek, "Live Free or Die"ın açılışındaki ileri sarmada, 52. doğum gününde satın alınır; "Felina"da yalnızca kullanılır | Walt, "Live Free or Die" açılışındaki ileri sarmada kaçıncı doğum gününde makineli tüfek satın alır? (doğru: 52.) |
| c-breaking-bad-037 | Walter Jr., babasının gerçeğini hangi bölümde öğrenir? | Hangi bölümde öğrendiği doğrulanamadı: özetler Ozymandias'ta bilinen bir durum olarak anlatıyor; açıklamadaki "Marie'nin baskısıyla Skyler anlatır" kaynaksız | Bölüm rehberiyle doğrula (Buried / Confessions / Rabid Dog / To'hajiilee arasında olabilir); doğrulanana dek yayında tutma |
| c-breaking-bad-032 | “Live Free or Die” bölümünde Gus'ın laptopundaki delilleri yok etmek için ne kullanılır? | Açıklamadaki "Mythbusters Jr." yanlış/belirsiz: sahneyi test eden program MythBusters'tır; cevap doğru | Açıklama: "MythBusters sahnenin gerçekte aynı etkiyi vermeyeceğini gösterdi." |
| d-canakkale-ve-yoresi-004 | Gelibolu'dan son İtilaf askerinin tahliyesi hangi yılda tamamlandı? | Cevap (1916) doğru ama açıklamadaki "20 Ocak 1916" yanlış: Anzac/Suvla 19-20 Aralık 1915'te, Seddülbahir son birlikler 9 Ocak 1916'da tahliye edildi | Açıklama: "Anzac ve Suvla 19-20 Aralık 1915'te, Seddülbahir ise 9 Ocak 1916'da boşaltıldı; tahliye 1916'da tamamlandı." |
| d-dc-002 | Superman, 1938'de hangi çizgi roman serisinin ilk sayısında ilk kez göründü? | Açıklamadaki "diğer on hikâyeyle birlikte" sayısı doğrulanamadı; soru ve cevap doğru | Açıklamadan sayıyı çıkar: "Superman, Action Comics #1'de (Haziran 1938) ilk kez göründü." |
| d-marvel-019 | Ruh Taşı adı ilk kez hangi filmde geçti? | "Adı ilk kez geçti" olumsuz-varlık iddiası ve kanıtlanamadı (Guardians/Thor'da anılmış olabilir); doğrusu "ilk göründüğü film" Infinity War | Ruh Taşı ilk kez hangi filmde görüldü? (doğru: Avengers: Infinity War) |
| d-masa-oyunlari-010 | “Şah mat”, Farsçada hangi anlama gelen bir sözden türemiştir? | "Şah mat" için Türkçe sözlükler Arapça "ölmek"ten (Şah öldü) diye açıklıyor; "Şah çaresiz/şaşkın" Fars kökeni savunması var: iki savunulabilir cevap | Soruyu "Şah mat satranç terimi nereden gelir?" yerine "Satranç Farsçadan hangi dilleri aşarak Türkçeye gelmiştir" gibi tartışmasız bir olguya çevir ya da kaynaklı bir tek anlam seç |
| d-yesilcam-turk-dizileri-003 | Yeşilçam'da “Sultan” lakabıyla anılan oyuncu kimdir? | Kayıtlı kaynaklar (Susuz Yaz, Hülya Koçyiğit, Metin Erksan sayfaları) "Sultan" lakabını desteklemiyor; olgu doğru görünüyor | Türkan Şoray sayfası ya da güvenilir bir biyografi kaynağı ekle |
| d-yesilcam-turk-dizileri-001 | Yeşilçam adı, İstanbul'un hangi ilçesindeki bir sokaktan gelir? | Kayıtlı kaynaklar Yeşilçam Sokağı'nı anlatmıyor; olgu doğru görünüyor | Yeşilçam Sokağı / Beyoğlu için kaynak ekle |
| d-yesilcam-turk-dizileri-002 | Yeşilçam'ın altın çağı hangi on yılları kapsar? | Kayıtlı kaynaklar "altın çağ" dönemini desteklemiyor; kaynaklarda genelde 1960-1975 geçer, "1950'ler ile 1970'ler" geniş | Dönemi kaynakla netleştir (ör. "1960'lar ile 1970'ler arası") ve doğru kaynak ekle |
| d-dc-004 | Batman'in yaratıcı kredisine Bill Finger'ın adı, “Bob Kane ile birlikte” şeklinde hangi yıldan itibaren eklendi? | Kayıtlı kaynaklar (DC antolojileri vb.) Ekim 2015 Bill Finger kredisi değişikliğini göstermiyor | DC açıklaması ya da haber kaynağı ekle |
| d-canakkale-ve-yoresi-002 | 18 Mart 1915'te Boğaz'a mayın döşeyen Türk mayın gemisinin adı nedir? | Soru yanlış tarihe bağlı: Nusret 7-8 Mart 1915 gecesi Erenköy Koyu'na mayın döşedi; 18 Mart'ta gemiler bu mayınlara çarptı. Cevap (Nusret) doğru | 18 Mart 1915 zaferinde İtilaf zırhlılarını batıran mayınları 8 Mart gecesi Erenköy Koyu'na döşeyen Türk mayın gemisi hangisidir? |
| d-canakkale-ve-yoresi-011 | 1915 Çanakkale Köprüsü'nün kuleleri kaç metre yüksekliğindedir? | Açıklamadaki "Seyit Onbaşı figürleriyle 334 metre" kaynaksız ve şüpheli; kule yüksekliği 318 m doğru | Açıklamadan 334 m ifadesini çıkar: "Çelik kuleler 318 metredir." |
| d-futbol-turkiye-010 | İstanbul dışından ilk şampiyon olan ve 1975-76 sezonunu kazanan takım hangisidir? | Cevap doğru ama açıklamadaki "on yılda altı şampiyonluk" sayısı doğrulanamadı (1976-1984 arasında beş şampiyonluk görünüyor) | Açıklamayı: "Trabzonspor, 1975-76'da Karadeniz'e ilk şampiyonluğu getirdi." yap |
| d-yesilcam-turk-dizileri-011 | Hababam Sınıfı 2005'te bir IMDb izleyici oylamasında dünyanın kaçıncı en iyi komedi filmi seçildi? | "2005 IMDb oylamasında dünyanın 3. en iyi komedisi" iddiası haber alıntısına dayanıyor; IMDb sıralaması doğrulanamıyor ve zamana bağlı | Birincil kaynakla doğrula; yoksa "Hababam Sınıfı hangi yılda çekildi?" (1975) gibi doğrulanabilir bir olguya çevir |
| d-masa-oyunlari-004 | Catan ilk yılında yaklaşık kaç kopya sattı? | "İlk yıl yaklaşık 400.000 kopya" yalnızca ikincil bir incelemede geçiyor; yayıncı kaynağıyla doğrulanamadı (ilk baskı için 3.000-5.000 adet gibi çelişen rakamlar var) | Kosmos veya Teuber biyografisiyle doğrula, doğrulanamazsa kaldır |
| b-sports-013 | Naismith'in ilk 13 basketbol kuralı, topla hangi hareketi yasaklıyordu? | Premis hatalı/belirsiz: ilk 13 kuralda yasak olan topla koşmaktı (Kural 3); "top sürme" kuralda yoktu, sonradan gelişti | Naismith'in ilk kuralları oyuncunun topla ne yapmasını yasaklıyordu? Topla koşmayı / Pas vermeyi / Şut atmayı / Topu iki elle tutmayı (doğru: Topla koşmayı) |
| b-literature-017 | Yusuf Has Hacib'in “Kutadgu Bilig”i, Türk edebiyatının hangi türdeki ilk eseri sayılır? | Kutadgu Bilig mesnevi nazım şekliyle yazılmıştır; "Mesnevi" seçeneği de savunulabilir (iki doğru cevap) | "Mesnevi" seçeneğini kaldır (ör. Divan / Hikâye / Destan) ya da "içerik türü olarak" diye soruyu netleştir |
| b-mythology-folklore-015 | Herakles, Hesperidlerin altın elmalarını alırken kimin yardımını görmüştür? | Prometheus de Herakles'e öğüt vererek yardım etmiştir; "kimin yardımını gördü" iki savunulabilir cevap verir | Hesperidlerin elmalarını Herakles için toplayan Titan kimdir? (doğru: Atlas) |
| b-mythology-folklore-003 | Yeraltının efendisi Hades, genellikle on iki Olimposlu listesinde sayılmaz. Neden? | Soru kökü dolambaçlı; "Halk sevmediği için", "Tahtı denizde olduğu için" çeldiricileri akla yatkın değil, cevap eleme ile bulunur | Hades neden on iki Olimposlu tanrı arasında sayılmaz? Yeraltında yaşadığı için / Zeus'un kardeşi olmadığı için / Savaşa katılmadığı için / İnsanlara karıştığı için |
| b-mythology-folklore-025 | Ergenekon'dan çıkışta Türklere yol gösteren Börteçine hangi hayvandır? | Börteçine "dişi kurt" değil: gri (boz) kurt, Moğol anlatısında erkek; dişi kurt Asena anlatısındadır. Cevap "Dişi kurt" kaynakla desteklenmiyor | Börteçine hangi hayvandır? Bozkurt / Geyik / Kartal / Beyaz at (doğru: Bozkurt) ve kaynağı ekle |
| b-literature-009 | Cervantes'in “Don Kişot” romanının ilk cildi hangi yıl yayımlanmıştır? | Çeldiriciler 1505/1705/1805 yalnızca yüzyıl kaydırması; zayıf | Seçenekler: 1605 / 1615 / 1588 / 1636 (doğru: 1605) |
| b-language-words-010 | Turkuaz taşının Batı dillerindeki adı, Eski Fransızcada hangi anlama gelen bir sözcükten türemiştir? | "Turkuaz" sözcüğü kökte "Türk"ü ele veriyor, zor değil; zorluk etiketi (HARD) uyumsuz | Turkuaz taşının Batı dillerindeki adı taşın Avrupa'ya hangi ülke üzerinden geldiğini anlatır? Hindistan / İran / Mısır / Türkiye (doğru: Türkiye), etiket MEDIUM |

## B. Reddedilen kopyalar (9), kaynak dosyadan silinmeli

| id | soru | sorun | öneri |
|---|---|---|---|
| b-art-culture-066 | Pamukkale travertenlerinin tepesine kurulmuş antik kentin adı nedir? | Aynı sorunun kopyası: a-geography-013 (Pamukkale'nin üstündeki antik kent Hierapolis) | Bu satırı kaldır, coğrafya sürümünü tut |
| b-art-culture-057 | Orta Çağ'da Bagratlı Ermeni Krallığı'na başkentlik eden ve 2016'da UNESCO Dünya Mirası Listesi'ne giren Ani Ören Yeri hangi ildedir? | Aynı sorunun kopyası: a-geography-008 (Ani Harabeleri / Kars) | Bu satırı kaldır, coğrafya sürümünü tut |
| d-canakkale-ve-yoresi-005 | Troya Antik Kenti UNESCO Dünya Mirası Listesi'ne hangi yıl girdi? | Aynı sorunun kopyası: b-art-culture-061 (Truva UNESCO yılı 1998) | Bu satırı kaldır, sanat-kültür sürümünü tut |
| d-turkiye-kulturu-011 | Doğanın yeniden uyanışını kutlayan Hıdırellez hangi tarihte kutlanır? | Aynı sorunun kopyası: b-art-culture-078 (Hıdırellez tarihi, aynı seçenekler) | Bu satırı kaldır, sanat-kültür sürümünü tut |
| b-mythology-folklore-010 | Homeros'un İlyada'sında geçen Truva hangi ilimizin sınırları içindedir? | Aynı sorunun kopyası: a-geography-010 (İlyada'daki Troya hangi ilimizde, aynı seçenek kümesi) | Bu satırı kaldır, coğrafya sürümünü tut |
| b-food-drink-001 | Türk kahvesi kültürü ve geleneği UNESCO listesine hangi yıl girmiştir? | Aynı sorunun kopyası: d-turkiye-kulturu-004 (Türk kahvesi UNESCO yılı 2013) | Bu satırı kaldır |
| b-mythology-folklore-011 | 1870'lerde Hisarlık'ta yaptığı kazılarla Truva'nın yeri konusunda en çok anılan arkeolog kimdir? | Aynı sorunun kopyası: d-canakkale-ve-yoresi-007 (Hisarlık kazıcısı Schliemann) | Bu satırı kaldır |
| b-sports-001 | Hakan Şükür'ün 2002'de Güney Kore'ye attığı gol, Dünya Kupası tarihinin neyi olarak kayıtlara geçmiştir? | Aynı olgunun kopyası: d-futbol-turkiye-003 (Hakan Şükür'ün en hızlı golü) ve kök cevabı içeriyor | Bu satırı kaldır |
| b-sports-002 | Türkiye – Güney Kore üçüncülük maçı 2002 Dünya Kupası'nda nasıl sonuçlanmıştır? | Aynı olgunun kopyası: d-futbol-turkiye-002 (Türkiye-Güney Kore 3-2) | Bu satırı kaldır |

## C. İnsan kararı gerekiyor: sezgisel denetim REVIEW verdi, inceleme PASS (8)

| id | soru | sorun | öneri |
|---|---|---|---|
| a-geography-010 | Homeros'un İlyada'sındaki Troya'nın kalıntıları hangi ilimizin sınırları içindedir? | Sezgisel denetim benzer soru buldu (kopyası B listesinde reddedildi ya da yanlış alarm); insan "uyarıyı kabul et" onayı verebilir | Yönetim konsolunda `approve` (adlandırılmış waive) ya da kategori düzelt |
| b-art-culture-045 | Londra'daki Shakespeare's Globe'un 1990'larda yeniden inşasını başlatan Amerikalı oyuncu ve yönetmen kimdir? | Sezgisel denetim kategoriyi şüpheli buluyor (soru müzik ya da sinema ağırlıklı olabilir); kategoriyi değiştir ya da onayla | Yönetim konsolunda `approve` (adlandırılmış waive) ya da kategori düzelt |
| b-art-culture-080 | Mevlevi Sema Töreni'ne eşlik eden, neyzen ile şarkıcıların da yer aldığı müzik repertuvarına ne ad verilir? | Sezgisel denetim kategoriyi şüpheli buluyor (soru müzik ya da sinema ağırlıklı olabilir); kategoriyi değiştir ya da onayla | Yönetim konsolunda `approve` (adlandırılmış waive) ya da kategori düzelt |
| b-art-culture-084 | Ankara Devlet Konservatuvarı'nın kuruluşunda Türkiye'ye danışman olarak çağrılan Alman besteci kimdir? | Sezgisel denetim kategoriyi şüpheli buluyor (soru müzik ya da sinema ağırlıklı olabilir); kategoriyi değiştir ya da onayla | Yönetim konsolunda `approve` (adlandırılmış waive) ya da kategori düzelt |
| b-music-008 | Beethoven'ın 9. Senfonisi'nin finalindeki “Neşeye Övgü”, hangi şairin şiirine dayanır? | Sezgisel denetim kategoriyi şüpheli buluyor (soru müzik ya da sinema ağırlıklı olabilir); kategoriyi değiştir ya da onayla | Yönetim konsolunda `approve` (adlandırılmış waive) ya da kategori düzelt |
| d-turkiye-kulturu-004 | Türk kahvesi kültürü ve geleneği UNESCO listesine hangi yıl girdi? | Sezgisel denetim benzer soru buldu (kopyası B listesinde reddedildi ya da yanlış alarm); insan "uyarıyı kabul et" onayı verebilir | Yönetim konsolunda `approve` (adlandırılmış waive) ya da kategori düzelt |
| d-turkiye-kulturu-006 | Ramazan Bayramı resmî olarak kaç gün sürer? | Sezgisel denetim benzer soru buldu (kopyası B listesinde reddedildi ya da yanlış alarm); insan "uyarıyı kabul et" onayı verebilir | Yönetim konsolunda `approve` (adlandırılmış waive) ya da kategori düzelt |
| d-turkiye-kulturu-007 | Kurban Bayramı resmî olarak kaç gün sürer? | Sezgisel denetim benzer soru buldu (kopyası B listesinde reddedildi ya da yanlış alarm); insan "uyarıyı kabul et" onayı verebilir | Yönetim konsolunda `approve` (adlandırılmış waive) ya da kategori düzelt |

## D. Küme notu (aynı konuda birden çok soru)

Bu sorular tek tek geçerli ama aynı turda yan yana gelirse biri diğerinin cevabını verir. Deste kurucusu bir turda kümeden en fazla bir soru seçmeli (ya da yazarlar çeşitlendirmeli):

- **Truva/Troya**: geography-010, art-culture-061, canakkale-006, canakkale-007, canakkale-008
- **Göbeklitepe, Nemrut, Safranbolu (coğrafya ile sanat-kültür çiftleri)**: geography-014 / art-culture-060; geography-011 / art-culture-058; geography-012 / art-culture-054
- **Susuz Yaz (üç soru)**: yesilcam-turk-dizileri-004, -005, -006
- **Sertab Erener / Eurovision 2003**: 90lar-nostalji-005, -006; music-012, -013, -014
- **2002 Dünya Kupası ve Hakan Şükür**: futbol-turkiye-001, -002, -003
- **"Leaves of Grass" / Gale ithafı**: breaking-bad-018, -020, -021
- **Ozymandias**: breaking-bad-012, -013, -037
- **Hıdırellez**: art-culture-078, -079
- **Hepburn Oscarları**: hollywood-003, -004
- **Hollywood tabelası (beş soru)**: hollywood-005, -006, -007, -008, -009
- **Wolverine (beş soru), Black Panther (beş soru)**: marvel-034..039; marvel-029, -030, -031, -032
- **MCU "yönetmeni kimdir" kalıbı (10 soru, kalıp tekrarı)**: marvel-002..012
- **Stan Lee cameo**: marvel-020, -021, -022
- **Hababam Sınıfı (beş soru)**: yesilcam-turk-dizileri-007..011
- **Mimar Sinan**: art-culture-046, -047, -048
- **Saygun / Türk Beşleri**: music-003, -004, -005, -006
- **Kırkpınar**: turkiye-kulturu-003; sports-007, -008, -009, -010
- **Astro Boy / Tezuka**: anime-cizgi-film-008, -010
- **Catan / Çaturanga**: masa-oyunlari-001, -002, -004; -008, -011
- **Galatasaray 2000**: futbol-turkiye-006, -007, -008
- **Çanakkale Köprüsü (üç soru)**: canakkale-ve-yoresi-009, -010, -011
- **Odin / Ragnarök**: mythology-folklore-018, -019, -020, -021, -022, -023
- **Mısır ölüm yargılaması**: mythology-folklore-027, -028, -029, -030
- **Herakles**: mythology-folklore-012..016

## E. Genel gözlemler

- Çoğu soru "makul ama sıradan" düzeyinde: puanlar asgari geçer notun (4/4/4/4/4, oyun değeri 3) çevresinde; yalnızca belirgin biçimde iyi olanlara 5 verildi.
- Pop kültür kümeleri (Breaking Bad, MCU, Hababam Sınıfı) kaynak olarak çoğunlukla Wikipedia/fan wiki kullanıyor; yayından önce insan örneklemesi özellikle bu kümelere uygulanmalı.
- Yeni satırları yazarlar eklerken bu kuyruktaki kalıpları (tek cevaplı olmayan "hangi yardım", kökteki cevap ipucu, 1505/1705/1805 gibi tembel çeldiriciler) önceden elemeli.
