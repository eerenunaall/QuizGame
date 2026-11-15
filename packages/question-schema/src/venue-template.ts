import { LAUNCH_CATEGORIES } from './enums';
import { VENUE_LIMITS, type VenueFormat } from './venue-file';

/**
 * What the café owner downloads or pastes into an AI assistant (ADR-0025). The same texts are in
 * `docs/venue-question-template.md`; a unit test keeps the two in step. Turkish only: the owner's tool
 * and the questions' language are Turkish, and the page around it is translated (`packages/i18n`).
 */
export const VENUE_CSV_HEADER =
  'category,difficulty,question,optionA,optionB,optionC,optionD,correct,explanation,sourceUrl';

/** Rows that pass the audit as they are: the template doubles as a test fixture. */
export const VENUE_CSV_EXAMPLE_ROWS = [
  "Genel Kültür,EASY,Türkiye'nin başkenti neresidir?,İstanbul,Ankara,İzmir,Bursa,B,Başkent 1923'ten beri Ankara'dır.,",
  'Tarih,MEDIUM,Malazgirt Savaşı hangi yılda yapılmıştır?,1071,1176,1243,1453,A,Savaş 1071 yılında Alp Arslan komutasındaki Selçuklular ile Bizans arasında yapıldı.,',
  'Bilim,HARD,Periyodik tabloda atom numarası 79 olan element hangisidir?,Gümüş,Platin,Altın,Bakır,C,Altının simgesi Au harfleridir.,',
  'Kutu Oyunları,EASY,Satranç tahtasında toplam kaç kare bulunur?,32,48,64,81,C,Tahta 8 sıra ve 8 sütundan oluşur.,',
  'Kutu Oyunları,MEDIUM,Hangi oyunda şah mat denilince oyun biter?,Dama,Satranç,Tombala,Okey,B,Şah mat satrançta şahın kurtulamayacağı durumdur.,',
  'Tarih,EXPERT,Osman Bey\'in babası kabul edilen Kayı lideri kimdir?,Süleyman Şah,Dündar Bey,Ertuğrul Gazi,Gündüz Alp,C,"Osmanlı hanedanının kurucusu Osman Bey, Ertuğrul Gazi\'nin oğludur.",',
] as const;

export const VENUE_CSV_TEMPLATE =
  [VENUE_CSV_HEADER, ...VENUE_CSV_EXAMPLE_ROWS].join('\r\n') + '\r\n';

const JSONL_EXAMPLES = [
  {
    category: 'Genel Kültür',
    difficulty: 'EASY',
    question: "Türkiye'nin başkenti neresidir?",
    options: ['İstanbul', 'Ankara', 'İzmir', 'Bursa'],
    correctIndex: 1,
    explanation: "Başkent 1923'ten beri Ankara'dır.",
  },
  {
    category: 'Kutu Oyunları',
    difficulty: 'MEDIUM',
    question: 'Hangi oyunda şah mat denilince oyun biter?',
    options: ['Dama', 'Satranç', 'Tombala', 'Okey'],
    correctIndex: 1,
    explanation: 'Şah mat satrançta şahın kurtulamayacağı durumdur.',
    sources: [{ url: 'https://tr.wikipedia.org/wiki/Satran%C3%A7', title: 'Satranç' }],
  },
] as const;

export const VENUE_JSONL_TEMPLATE =
  JSONL_EXAMPLES.map((row) => JSON.stringify(row)).join('\n') + '\n';

export const VENUE_TEMPLATE_FILE_NAMES = {
  CSV: 'soru-sablonu.csv',
  JSONL: 'soru-sablonu.jsonl',
} as const;

const categoryList = LAUNCH_CATEGORIES.map((category) => `${category.tr}`).join(', ');

const COMMON_RULES = `KURALLAR
1. Sorular Türkçe, doğal ve net olsun. Türkçe karakterleri (ç ğ ı ö ş ü İ) doğru kullan, ASCII'ye çevirme.
2. Her sorunun tam 4 şıkkı olsun, yalnızca biri doğru olsun. İki şık da doğru sayılabiliyorsa soruyu yazma.
3. Doğru şıkkın yeri A, B, C ve D arasında dengeli dağılsın (hep aynı harf olmasın). Doğru şık diğerlerinden belirgin biçimde uzun ya da kısa olmasın.
4. Cevabı soru metninde verme; "hepsi", "hiçbiri", "yukarıdakilerin hepsi" gibi şıklar kullanma; olumsuz ("hangisi değildir") soru yazma.
5. ZORLUK DAĞILIMI (toplam sayıya göre): yaklaşık %40 EASY, %35 MEDIUM, %20 HARD, %5 EXPERT.
6. Her soruya kısa bir açıklama yaz (en fazla 200 karakter): cevap neden doğru?
7. Emin olmadığın bilgiyi YAZMA. Zamana göre değişen bilgiler (güncel liderler, fiyatlar, "en son", "şu anki"), yaşayan kişilerle ilgili iddialar, siyaset, din, cinsellik ve küfür içeren sorular olmasın.
8. Her soru farklı olsun; aynı soruyu kelimelerini değiştirerek tekrar etme.
9. Kaynak adresi (sourceUrl) isteğe bağlıdır. Yalnızca gerçekten var olduğundan emin olduğun güvenilir bir sayfa adresini yaz; emin değilsen boş bırak. Adres uydurma.
10. KATEGORİ: şu hazır kategorilerden birini aynen yaz: ${categoryList}. Kafeye özel bir kategori istiyorsan kendi adını yaz (örneğin "Kutu Oyunları"); en fazla ${VENUE_LIMITS.maxCategoriesPerVenue} özel kategori kullanılabilir, ad en çok ${VENUE_LIMITS.maxCategoryLabel} karakter olsun.
11. Dosyada en fazla ${VENUE_LIMITS.maxRows} soru olsun.`;

const CSV_FORMAT = `ÇIKTI BİÇİMİ
Yalnızca tek bir kod bloğu içinde CSV ver (başka açıklama yazma). İlk satır tam olarak şu başlık olsun:
${VENUE_CSV_HEADER}
- Alanlar virgülle ayrılır. Bir alanın içinde virgül ya da tırnak varsa alanı çift tırnak içine al, içerideki tırnağı iki kez yaz.
- difficulty: EASY, MEDIUM, HARD veya EXPERT.
- correct: doğru şıkkın harfi (A, B, C veya D).
- Her soru tek satırda olsun; satır içinde alt satıra geçme.
Örnek satırlar:
${VENUE_CSV_EXAMPLE_ROWS.slice(0, 3).join('\n')}`;

const JSONL_FORMAT = `ÇIKTI BİÇİMİ
Yalnızca tek bir kod bloğu içinde JSONL ver (satır başına bir JSON nesnesi, başka açıklama yazma). Alanlar:
category, difficulty (EASY, MEDIUM, HARD veya EXPERT), question, options (4 metinlik liste), correctIndex (doğru şıkkın sırası: 0, 1, 2 veya 3), explanation, isteğe bağlı sources ([{"url": "...", "title": "..."}]).
Başka alan ekleme.
Örnek satırlar:
${VENUE_JSONL_TEMPLATE.trim()}`;

/** The message an owner pastes into any AI assistant; they fill in the topic and the count. */
export function venuePrompt(format: VenueFormat): string {
  return `Bir kafe için çoktan seçmeli bilgi yarışması soruları hazırlayacaksın. Sorular TV'de ve telefonlarda oynanacak.

KONU: [BURAYA KONUYU YAZ, örneğin: kutu oyunları, İzmir, 90'lar müziği]
SORU SAYISI: [BURAYA SAYIYI YAZ, örneğin: 60]

${COMMON_RULES}

${format === 'CSV' ? CSV_FORMAT : JSONL_FORMAT}

Bitirince her sorunun doğruluğunu bir kez daha kontrol et; emin olmadığın soruları listeden çıkar.`;
}
