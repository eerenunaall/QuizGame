# Gözden geçirme kuyruğu (REVIEW-QUEUE)

Kaynak: bağımsız inceleme turları R1 ve R2 (`seed/gusto/audits.R1.jsonl`, `audits.R2.jsonl`, etiket `independent-reviewer-agent`). Bu inceleme bir **yapay zekâ modeli** tarafından yapıldı; yazar modellerden ayrı bir bağlamdı ama insan onayı değildir. Aşağıdaki satırlar ya yeniden yazılmalı ya da bir insanın karar vermesi gerekiyor.

Sonuç: 848 ACTIVE, 73 REVIEW, 18 REJECTED (toplam 939).

Nasıl düzeltilir: `seed/gusto/questions.*.tr.jsonl` içinde soruyu düzenle (yeni sürüm = yeni revizyon), sonra `scripts/question/audit-batch.md` içindeki prosedürle yalnızca değişen satırları yeniden denetle.

## A. Yeniden yazılacak veya doğrulanacak (40)

| id | soru | sorun | öneri |
|---|---|---|---|
| b-art-culture-035 | Eyfel Kulesi hangi büyük etkinlik için yapılmıştır? | Çeldiriciler zayıf: "1871 Paris Komünü anması" ve "1804 İmparatorluk töreni" bir kule için akla yatkın değil | Çeldiriciler: 1900 Paris Dünya Fuarı / 1878 Paris Dünya Fuarı / 1900 Paris Olimpiyatları; doğru: 1889 Paris Dünya Fuarı |
| b-art-culture-028 | Milo Venüsü, 1820'de hangi Ege adasında bulunmuştur? | Cevap soru adında geçiyor (Milo Venüsü -> Milos); oyun değeri düşük | Milo Venüsü şu an hangi müzede sergilenir? Louvre / British Museum / Uffizi / Prado (doğru: Louvre) |
| b-art-culture-085 | İstanbul Bienali'nin öncüsü olan ilk uluslararası çağdaş sanat sergileri, İKSV tarafından hangi yıl düzenlenmiştir? | Soru kökü "İstanbul Bienali'nin öncüsü olan ilk uluslararası çağdaş sanat sergileri" bulanık: 1987 sergisi bienalin kendisi sayılır | İKSV'nin düzenlediği ilk İstanbul Bienali hangi yıl yapılmıştır? (doğru: 1987) |
| b-art-culture-044 | Çaykovski'nin Kuğu Gölü balesi 1877'de ilk kez hangi şehirde sahnelenmiştir? | Cevap (Moskova) doğru ama kayıtlı kaynak Kuğu Gölü değil "The Nutcracker" sayfası: kaynak iddiayı desteklemiyor | Kuğu Gölü (1877 Bolşoy prömiyeri) için doğru kaynak ekle |
| b-art-culture-015 | Velázquez'in 1656 tarihli “Las Meninas” tablosu hangi müzededir? | Açıklama bozuk Türkçe ("tablo ... tablo", "sahnesindeki Madrid Alcázar'ının"); soru ve cevap doğru | Açıklama: "Türkçede “Nedimeler” de denir. Velázquez tabloyu Madrid Alcázar'ındaki Prens Dairesi'nde yapmıştır; bugün Prado Müzesi'ndedir." |
| b-art-culture-069 | İznik çinilerinin canlı kırmızısı, hangi demirce zengin kile dayanır? | Kökte "kil" denince çeldiricilerin üçü (kobalt oksit, bakır oksit, antimon) kil olmadığı için eleniyor; cevap biçimden çıkıyor | Kökü "İznik çinisinin canlı kırmızısını veren malzeme hangisidir?" yap; çeldiriciler: Kobalt oksit / Bakır oksit / Kurşun oksit |
| b-art-culture-027 | Rodin'in “Düşünen Adam” heykeli ilk tasarlandığında hangi adı taşıyordu? | "Dante" çeldiricisi savunulabilir: heykel Dante'yi canlandırıyordu ve kimi kaynaklar böyle anar; ilk ad "Şair" (Le Poète) | "Dante" seçeneğini "Orfeus" ile değiştir, ya da kaynakla "Şair" adını doğrula |
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
| a-nature-031 | Gök gürültüsü neyin sonucunda duyulur? | Doğru seçenek çeldiricilerin yaklaşık iki katı uzunlukta ve ayrıntılı (uzunluk ipucu); çeldiriciler kısa ve genel | Çeldiricileri benzer uzunlukta ve ayrıntıda yaz (ör. "Bulutların kendi içinde sürtünmesi") |
| a-nature-017 | Örümcekler hangi hayvan sınıfında yer alır? | Doğru seçenek parantezli ve çeldiricilerin iki katı uzunlukta (uzunluk ipucu) | Doğru seçeneği "Araknidler", çeldiricileri "Böcekler / Kabuklular / Çokbacaklılar" yap |
| a-nature-032 | Türkiye'de 2019'da kamera tuzaklarıyla yeniden fotoğraflanan ve sayısı on bireyden az sayılan büyük kedi alt türü hangisidir? | 2019 kamera tuzağı kaydı doğru; ancak "on bireyden az" kaynaksız (kaynaklar iki birey fotoğrafladığını söylüyor) | Sayı ifadesini çıkar: "Türkiye'de 2019'da kamera tuzağıyla yeniden fotoğraflanan, uzun süre soyu tükenmiş sanılan büyük kedi alt türü hangisidir?" |
| c-better-call-saul-014 | Üçüncü sezon finali “Winner”da Jimmy ne kazanır? | "Winner" üçüncü değil dördüncü sezonun finalidir (S4E10); ruhsatın geri verilmesi de o bölümdedir | Dördüncü sezon finali “Winner”da Jimmy ne kazanır? (doğru: Avukatlık ruhsatının geri verilmesini) |
| c-how-i-met-your-mother-014 | Finali eleştirilince DVD'de yayınlanan alternatif sonda ne değişir? | "Tracy'nin ölümü anlatılmaz" seçeneği de alternatif sonla uyuşuyor (alternatif son Tracy ile tanışmada biter); iki savunulabilir cevap | Soruyu "DVD'deki alternatif son hangi sahnede biter?" yap (doğru: Ted'in Tracy ile ilk tanıştığı sahnede) ve çeldiricileri tek cevaplı kur |
| c-how-i-met-your-mother-018 | Robin'in sunuculuğunu yaptığı haber programı günün hangi vaktinde yayınlanır? | Robin'in programı sezonlara göre değişiyor (akşam haberi, sabah programı); soru tek doğru yanıt vermiyor ve kaynak (bölüm listesi) desteklemiyor | Belirli bir bölüm/sezon ve program adı ver ("Come On, Get Up, Get Up" gibi) ya da soruyu çıkar |
| c-how-i-met-your-mother-020 | “Sandcastles in the Sand”de Robin Sparkles'ın ikinci şarkısı hangi ilişkiyi tetikler? | Bölümün kaynağı "Slap Bet" sayfası; "Sandcastles in the Sand"ın Barney-Robin ilişkisini tetiklediği doğrulanamadı | Bölüm özetiyle doğrula; doğrulanmazsa kaldır |
| c-better-call-saul-024 | Gus Fring'in Better Call Saul'daki son görüldüğü bölüm hangisidir? | Gus'ın BCS'teki son görünüşü tek wiki kaynağıyla destekli, bölüm doğrulanamadı (Fun and Games mi, sonraki bölüm mü) | Bölüm rehberiyle doğrula |
| c-cinema-tv-005 | 2020 töreninde En İyi Film Oscar'ı kazanan ilk yabancı dilde çekilmiş film hangisidir? | "Tren Yolu" gerçek bir film değil, çeldirici uydurma; diğer seçenekler gerçek filmler | "Tren Yolu" yerine gerçek bir Kore ya da yabancı dilli film koy (ör. Roma ya da Cennetin Çocukları) |
| c-warhammer-013 | Horus Heresy'de İmparator'un favori oğullarının baştan çıkışı hangi esere dayandırılmıştır? | "Horus Heresy Kayıp Cennet'e dayandırılmıştır" hayran yorumu, yalnız wiki kaynaklarıyla destekli; Priestley'e atfı doğrulanamadı | Yazarın/Games Workshop'un doğrudan alıntısıyla doğrula ya da soruyu kaldır |
| c-gaming-024 | Türkiye'nin en eski espor kuruluşu Dark Passage, 2003'te hangi oyunun takımı olarak kuruldu? | "Türkiye'nin en eski espor kuruluşu" üstünlük iddiası tek wiki sayfasına dayanıyor | İddiayı kaynaklandır veya "Dark Passage hangi yıl kuruldu?" gibi doğrulanabilir hale getir |
| c-warhammer-007 | Warhammer Fantasy Battle'ı 1983'te kim geliştirmiştir? | Bryan Ansell de ilk Warhammer Fantasy Battle'ın (1983) tasarımcıları arasındadır; iki savunulabilir cevap | Soruyu "Warhammer 40,000'in ilk kural kitabı Rogue Trader'ı hangi tasarımcı yazdı?" yap ya da Ansell'i çeldiriciden çıkar |
| c-gaming-025 | Türk milli CS:GO takımı 2016 Dünya Şampiyonası finalinde hangi ülkeyi yenerek şampiyon oldu? | "2016 Dünya Şampiyonası finalinde Arjantin'i yendi" iddiası yalnızca zayıf yan kaynaklara (Dark Passage, Sports in Turkey) dayanıyor; turnuva adı/rakip doğrulanamadı | Turnuva adını (ör. IeSF 2016) ve rakibi resmî kaynakla doğrula |

## B. Reddedilen kopyalar (18), kaynak dosyadan silinmeli

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
| a-general-012 | Olimpiyat bayrağındaki iç içe geçmiş beş halka neyi simgeler? | Aynı olgunun kopyası: b-sports-015 (Olimpiyat halkaları beş kıtayı simgeler) | Bu satırı kaldır |
| a-history-006 | Arap harflerinin yerine Latin esaslı yeni Türk alfabesi hangi yıl kabul edilmiştir? | Aynı olgunun kopyası: b-language-words-004 (Latin harfli alfabenin kabulü 1928); açıklamadaki "3 Kasım" kabul değil yürürlük tarihi (kabul: 1 Kasım 1928) | Bu satırı kaldır |
| a-general-021 | Satranç oyununun atası sayılan çaturanga hangi ülkede ortaya çıkmıştır? | Aynı olgunun kopyası: d-masa-oyunlari-009 (satrancın doğduğu ülke Hindistan) | Bu satırı kaldır |
| c-better-call-saul-004 | Better Call Saul'a adını veren Saul Goodman, Breaking Bad'de ilk kez hangi sezonda görülür? | Aynı olgunun kopyası: c-breaking-bad-055 (Saul Goodman Breaking Bad'de ilk 2. sezonda görülür) | Bu satırı kaldır |
| c-cinema-tv-010 | “Pulp Fiction” 1994'te hangi festivalde en büyük ödülü kazandı? | Aynı sorunun kopyası: d-cult-films-002 (Pulp Fiction Cannes Altın Palmiye) | Bu satırı kaldır |
| c-business-economy-001 | Apple'ı 1976'da Steve Jobs ve Steve Wozniak ile birlikte kuran üçüncü ortak kimdir? | Aynı sorunun kopyası: a-technology-006 (Apple'ın üçüncü kurucusu Ronald Wayne) | Bu satırı kaldır |
| c-cinema-tv-003 | Tamamen bilgisayarla üretilen ilk uzun metrajlı film hangisidir? | Aynı olgunun kopyası: d-hollywood-012 (ilk tam bilgisayar animasyonlu film Toy Story) | Bu satırı kaldır |
| c-business-economy-002 | Microsoft'u 1975'te Bill Gates ile birlikte kuran isim kimdir? | Aynı sorunun kopyası: a-technology-005 (Microsoft'un ortak kurucusu Paul Allen) | Bu satırı kaldır |
| c-cinema-tv-002 | Genellikle ilk uzun metrajlı çizgi film olarak anılan Disney yapımı hangisidir? | Aynı olgunun kopyası: d-hollywood-010 (ilk uzun metrajlı selüloit animasyon Pamuk Prenses) | Bu satırı kaldır |

## C. İnsan kararı gerekiyor: sezgisel denetim REVIEW verdi, inceleme PASS (33)

| id | soru | sorun | öneri |
|---|---|---|---|
| a-general-003 | Gregoryen takvime geçildiğinde 4 Ekim 1582 Perşembe gününü hangi tarih izlemiştir? | Şıklar birbirine çok benziyor (sayı/tarih şıkları; genelde yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-general-018 | Dünyada dörtgen biçiminde olmayan tek ulusal bayrak hangi ülkeye aittir? | Olumsuz soru kökü ("hangisi değildir/yer almaz") | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-general-020 | Euro banknot ve madeni paraları hangi tarihte tedavüle girdi? | Şıklar birbirine çok benziyor (sayı/tarih şıkları; genelde yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-geography-008 | Bagratlı Ermeni Krallığı'na başkentlik etmiş, 2016'da UNESCO Dünya Mirası Listesi'ne giren Ani Harabeleri hangi ildedir? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-geography-010 | Homeros'un İlyada'sındaki Troya'nın kalıntıları hangi ilimizin sınırları içindedir? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-005 | 2, 4, 8, 16 dizisinde sıradaki sayı kaçtır? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-006 | 1, 4, 9, 16, 25 dizisinde sıradaki sayı kaçtır? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-008 | Ali, Veli'den uzundur. Veli de Can'dan uzundur. Aşağıdakilerden hangisi kesinlikle doğrudur? | Mutlak ifade ("kesinlikle"); mantık sorusunda amaçlı | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-017 | Bir otobüs sabit 60 km/sa hızla 150 km'lik yolu kaç saatte alır? | Şıklar örtüşüyor gibi algılandı (birimli sayılar; genelde yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-034 | 3, 5, 8, 13, 21 dizisinde sıradaki sayı kaçtır? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-041 | 1 kilometrekare kaç metrekaredir? | Şıklar örtüşüyor gibi algılandı (birimli sayılar; genelde yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-042 | 1 metreküp kaç litredir? | Şıklar örtüşüyor gibi algılandı (birimli sayılar; genelde yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-045 | Tüm kediler hayvandır. Pamuk bir kedidir. Bu bilgilere göre kesin olarak doğru olan hangisidir? | Cevap sözcüğü kökte geçiyor gibi algılandı (mantık/sayı sorusunda amaçlı) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-046 | Kenarı 5 cm olan karenin köşegeni kaç cm'dir? | Şıklar birbirine çok benziyor (sayı/tarih şıkları; genelde yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-053 | Bir ürüne önce %20 zam, ardından yeni fiyat üzerinden %20 indirim yapılıyor. Son fiyat ilk fiyata göre nasıldır? | Şıklar birbirine çok benziyor (sayı/tarih şıkları; genelde yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-math-logic-054 | Anne 36, çocuğu 9 yaşındadır. Kaç yıl sonra annenin yaşı çocuğunun yaşının iki katı olur? | Şıklar birbirine çok benziyor (sayı/tarih şıkları; genelde yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-nature-026 | Yaprağı, gövdesi ve kökü olmayan, dünyanın en büyük tek çiçeğini açan parazit bitki hangisidir? | Olumsuz soru kökü ("hangisi değildir/yer almaz") | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-science-002 | Mutlak sıfır, yani 0 kelvin, kaç santigrat derecedir? | Şıklar birbirine çok benziyor (sayı/tarih şıkları; genelde yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-science-009 | Dünya'nın yaşı yaklaşık kaç milyar yıl olarak tahmin edilir? | Şıklar birbirine çok benziyor (sayı/tarih şıkları; genelde yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-technology-005 | Microsoft'u 1975'te Bill Gates ile birlikte kuran kişi kimdir? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-technology-006 | Apple'ı 1976'da Steve Jobs ve Steve Wozniak ile birlikte kuran, ama yaklaşık iki hafta sonra payını 800 dolara satan üçüncü ortak kimdir? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| a-technology-030 | Türkiye'nin ilk haberleşme uydusu Türksat 1A, 24 Ocak 1994'teki fırlatmada ne olmuştur? | Cevap sözcüğü kökte geçiyor gibi algılandı (mantık/sayı sorusunda amaçlı) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| b-art-culture-045 | Londra'daki Shakespeare's Globe'un 1990'larda yeniden inşasını başlatan Amerikalı oyuncu ve yönetmen kimdir? | Kategori şüphesi (soru müzik/sinema ağırlıklı olabilir) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| b-art-culture-080 | Mevlevi Sema Töreni'ne eşlik eden, neyzen ile şarkıcıların da yer aldığı müzik repertuvarına ne ad verilir? | Kategori şüphesi (soru müzik/sinema ağırlıklı olabilir) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| b-art-culture-084 | Ankara Devlet Konservatuvarı'nın kuruluşunda Türkiye'ye danışman olarak çağrılan Alman besteci kimdir? | Kategori şüphesi (soru müzik/sinema ağırlıklı olabilir) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| b-language-words-004 | Latin esaslı yeni Türk alfabesi hangi tarihte kabul edilmiştir? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| b-music-008 | Beethoven'ın 9. Senfonisi'nin finalindeki “Neşeye Övgü”, hangi şairin şiirine dayanır? | Kategori şüphesi (soru müzik/sinema ağırlıklı olabilir) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| c-gaming-006 | Nintendo'nun Famicom konsolu Japonya'da hangi yıl satışa çıktı? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| c-gaming-009 | Nintendo 64 Japonya'da hangi yıl satışa çıktı? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| d-hollywood-012 | Tamamen bilgisayarla animasyonla yapılan ilk uzun metrajlı film hangisidir? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| d-turkiye-kulturu-004 | Türk kahvesi kültürü ve geleneği UNESCO listesine hangi yıl girdi? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| d-turkiye-kulturu-006 | Ramazan Bayramı resmî olarak kaç gün sürer? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |
| d-turkiye-kulturu-007 | Kurban Bayramı resmî olarak kaç gün sürer? | Benzer soru uyarısı (kopyası reddedildi ya da aynı kalıp, farklı sayılar/şıklar: büyük olasılıkla yanlış alarm) | Yönetim konsolunda adlandırılmış waive ile `approve` (inceleme PASS verdi) ya da kategori/söz düzeltmesi |

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
- **Oyuncu-sorusu kalıbı (Harry Potter 6, Game of Thrones 6, HIMYM 5, Office 4, BCS 3 "hangi oyuncu canlandırır")**: harry-potter-006..010, -016; game-of-thrones-007..011, -026, -035; how-i-met-your-mother-003..007, -021, -022
- **Matematik dizi soruları (aynı "dizide sıradaki sayı" kalıbı, 6 soru)**: math-logic-005, -006, -034, -035, -036
- **Doğa rekorları (en büyük/en ağır/en uzun)**: nature-001, -002, -003, -004, -020
- **Bayrak, Olimpiyat, Nobel (aynı konuda iki üç soru)**: general-012..015, -019, -023..025
- **Galatasaray 2000**: futbol-turkiye-006, -007, -008
- **Çanakkale Köprüsü (üç soru)**: canakkale-ve-yoresi-009, -010, -011
- **Odin / Ragnarök**: mythology-folklore-018, -019, -020, -021, -022, -023
- **Mısır ölüm yargılaması**: mythology-folklore-027, -028, -029, -030
- **Herakles**: mythology-folklore-012..016

## E. Genel gözlemler

- Çoğu soru "makul ama sıradan" düzeyinde: puanlar asgari geçer notun (4/4/4/4/4, oyun değeri 3) çevresinde; yalnızca belirgin biçimde iyi olanlara 5 verildi.
- Pop kültür kümeleri (Breaking Bad, MCU, Hababam Sınıfı) kaynak olarak çoğunlukla Wikipedia/fan wiki kullanıyor; yayından önce insan örneklemesi özellikle bu kümelere uygulanmalı.
- Yeni satırları yazarlar eklerken bu kuyruktaki kalıpları (tek cevaplı olmayan "hangi yardım", kökteki cevap ipucu, 1505/1705/1805 gibi tembel çeldiriciler) önceden elemeli.
