import { describe, expect, it } from 'vitest';
import { GOOD, NOW, RECENT, subject, type Draft } from './fixtures';
import { runHeuristics, parseNumeric, type AuditSubject } from './heuristics';
import type { ReasonCode } from './reasons';

const audit = (input: AuditSubject, sourceRequired = false) =>
  runHeuristics(input, { now: NOW, sourceRequired });
const codes = (input: AuditSubject, sourceRequired = false) =>
  audit(input, sourceRequired).map((item) => item.code);

const draft = (text: string, options: string[], correct = 0): Draft => ({ text, options, correct });
const ISTANBUL: Draft = draft('Aşağıdaki şehirlerden hangisi Marmara Bölgesi’ndedir?', [
  'Bursa',
  'Konya',
  'Sivas',
  'Adana',
]);

describe('good Turkish questions', () => {
  it.each(GOOD)('$name raises nothing', ({ draft: question, overrides }) => {
    const findings = audit(subject(question, overrides), true);
    expect(findings.filter((item) => item.severity !== 'INFO')).toEqual([]);
  });
});

/** The question red team (GDD §37.6) as executable cases: each defect must be noticed. */
const BAD: { name: string; input: AuditSubject; expect: ReasonCode[]; sourceRequired?: boolean }[] =
  [
    {
      name: 'duplicate options',
      input: subject(
        draft('Türkiye’nin başkenti neresidir?', ['Ankara', 'ankara', 'İstanbul', 'İzmir']),
      ),
      expect: ['DUPLICATE_OPTIONS'],
    },
    {
      name: 'two correct answers',
      input: {
        ...subject(draft('Hangi şehir Ege Bölgesi’ndedir?', ['İzmir', 'Manisa', 'Konya', 'Sivas'])),
        options: [
          { text: 'İzmir', correct: true },
          { text: 'Manisa', correct: true },
          { text: 'Konya', correct: false },
          { text: 'Sivas', correct: false },
        ],
      },
      expect: ['MULTIPLE_CORRECT_OPTIONS'],
    },
    {
      name: 'no correct answer among the options',
      input: {
        ...subject(draft('Hangi şehir Ege Bölgesi’ndedir?', ['İzmir', 'Manisa', 'Konya', 'Sivas'])),
        options: ['İzmir', 'Manisa', 'Konya', 'Sivas'].map((text) => ({ text, correct: false })),
      },
      expect: ['NO_CORRECT_OPTION'],
    },
    {
      name: 'the answer is written in the question',
      input: subject(
        draft(
          'Türkiye’nin başkenti olan Ankara hangi ülkenin başkentidir?',
          ['Fransa', 'Türkiye', 'İspanya', 'İtalya'],
          1,
        ),
      ),
      expect: ['ANSWER_IN_QUESTION'],
    },
    {
      name: 'a word of the answer echoes in the question',
      input: subject(
        draft('Osmanlı Devleti’nin kurucusu kimdir?', [
          'Osman Bey',
          'Orhan Gazi',
          'Murat Hüdavendigâr',
          'Yıldırım Bayezid',
        ]),
      ),
      expect: ['ANSWER_STEM_IN_QUESTION'],
    },
    {
      name: 'the correct answer is far longer than the rest',
      input: subject(
        draft(
          'Türkiye’nin başkenti neresidir?',
          [
            'Konya',
            'Bursa',
            'Adana',
            'Türkiye Cumhuriyeti’nin başkenti ve ikinci büyük şehri olan Ankara',
          ],
          3,
        ),
      ),
      expect: ['LENGTH_CLUE_STRONG', 'OPTION_TOO_LONG'],
    },
    {
      name: 'the correct answer is somewhat longer',
      input: subject(
        draft(
          'Türkiye’nin en uzun nehri hangisidir?',
          ['Gediz', 'Sakarya', 'Ceyhan', 'Kızılırmak Nehri'],
          3,
        ),
      ),
      expect: ['LENGTH_CLUE'],
    },
    {
      name: 'only the correct answer has parentheses',
      input: subject(
        draft('İtalya’nın başkenti neresidir?', ['Roma (İtalya)', 'Paris', 'Berlin', 'Madrid']),
      ),
      expect: ['FORMAT_CLUE'],
    },
    {
      name: 'distractors of another kind (year versus words)',
      input: subject(
        draft('Türkiye Cumhuriyeti hangi yıl kuruldu?', ['1923', 'Ankara', '1938', 'Atatürk']),
        { category: 'history' },
      ),
      expect: ['OPTION_TYPE_MISMATCH'],
    },
    {
      name: 'a distractor on another scale',
      input: subject(
        draft('Bir futbol takımı sahaya kaç oyuncuyla çıkar?', ['11', '10', '9', '11000']),
        { category: 'sports' },
      ),
      expect: ['NUMERIC_SCALE_MISMATCH'],
    },
    {
      name: 'all of the above',
      input: subject({ ...ISTANBUL, options: ['Bursa', 'Edirne', 'Tekirdağ', 'Hepsi'] }),
      expect: ['ALL_OR_NONE_OPTION'],
    },
    {
      name: 'overlapping options',
      input: subject(
        draft(
          'Hangisi Türkiye’deki bir devlet üniversitesidir?',
          ['Ankara', 'Ankara Üniversitesi', 'Paris', 'Berlin'],
          1,
        ),
      ),
      expect: ['OVERLAPPING_OPTIONS'],
    },
    {
      name: 'options one letter apart',
      input: subject(
        draft('Hangi nehir Karadeniz’e dökülür?', ['Sakarya', 'Sakaryo', 'Gediz', 'Ceyhan']),
      ),
      expect: ['OPTIONS_NEARLY_IDENTICAL'],
    },
    {
      name: 'negated stem',
      input: subject(
        draft('Aşağıdakilerden hangisi bir Türk şehri değildir?', [
          'Paris',
          'Bursa',
          'Konya',
          'Sivas',
        ]),
      ),
      expect: ['NEGATIVE_STEM'],
    },
    {
      name: 'double negative',
      input: subject(
        draft('Aşağıdakilerden hangisi bir Türk şehri olmayan değildir?', [
          'Paris',
          'Bursa',
          'Konya',
          'Sivas',
        ]),
      ),
      expect: ['DOUBLE_NEGATIVE'],
    },
    {
      name: 'ambiguous time reference',
      input: subject(
        draft('Şu anda dünyanın en kalabalık ülkesi hangisidir?', [
          'Hindistan',
          'Çin',
          'Brezilya',
          'Nijerya',
        ]),
      ),
      expect: ['AMBIGUOUS_TEMPORAL'],
    },
    {
      name: 'a recent year in an evergreen question',
      input: subject(
        draft('2025 yılında hangi ülke bu turnuvayı kazandı?', [
          'İspanya',
          'Fransa',
          'Brezilya',
          'Almanya',
        ]),
        { category: 'sports' },
      ),
      expect: ['RECENT_EVENT_AS_EVERGREEN'],
    },
    {
      name: 'broken encoding',
      input: subject(
        draft("TÃ¼rkiye'nin baÅŸkenti neresidir?", ['Ankara', 'Konya', 'Bursa', 'Adana']),
      ),
      expect: ['BROKEN_ENCODING'],
    },
    {
      name: 'control character inside the text',
      input: subject(
        draft('Türkiye’nin başkenti\u0007 neresidir?', ['Ankara', 'Konya', 'Bursa', 'Adana']),
      ),
      expect: ['INVALID_CHARACTERS'],
    },
    {
      name: 'Turkish typed without its letters',
      input: subject(
        draft('Turkiye’nin baskenti hangi sehirdir ve neresidir?', [
          'Ankara',
          'Konya',
          'Bursa',
          'Adana',
        ]),
      ),
      expect: ['ASCII_FOLDED_TURKISH'],
    },
    {
      name: 'a capital I where Turkish needs a dotted İ',
      input: subject(
        draft('Aşağıdakilerden hangisi bir kıyı şehridir?', [
          'Istanbul',
          'Konya',
          'Sivas',
          'Ankara',
        ]),
      ),
      expect: ['ASCII_FOLDED_TURKISH'],
    },
    {
      name: 'presenter filler',
      input: subject(
        draft('Biliyor muydunuz? Dünyanın en büyük okyanusu hangisidir?', [
          'Pasifik',
          'Atlas',
          'Hint',
          'Arktik',
        ]),
      ),
      expect: ['CONVERSATIONAL_FILLER'],
    },
    {
      name: 'generated-sounding phrasing',
      input: subject(
        draft('Tarihin derinliklerinde büyüleyici bir yere sahip Roma hangi ülkenin başkentidir?', [
          'İtalya',
          'Fransa',
          'İspanya',
          'Yunanistan',
        ]),
      ),
      expect: ['LLM_STYLE_PHRASES'],
    },
    {
      name: 'placeholder text',
      input: subject(
        draft('Örnek soru: aşağıdakilerden hangisi doğrudur?', [
          'Seçenek A',
          'Seçenek B',
          'Seçenek C',
          'Seçenek D',
        ]),
      ),
      expect: ['PLACEHOLDER_TEXT'],
    },
    {
      name: 'profanity',
      input: subject(draft('Bu orospu çocuğu kim?', ['Ali', 'Veli', 'Ayşe', 'Fatma'])),
      expect: ['PROFANITY'],
    },
    {
      name: 'category mismatch',
      input: subject(
        draft('Periyodik tabloda atom numarası 1 olan element hangisidir?', [
          'Hidrojen',
          'Helyum',
          'Lityum',
          'Karbon',
        ]),
        { category: 'sports' },
      ),
      expect: ['CATEGORY_MISMATCH_SUSPECT'],
    },
    {
      name: 'missing question mark',
      input: subject(
        draft('Türkiye’nin başkenti Ankara’dır.', ['Doğru', 'Yanlış', 'Belki', 'Bilmiyorum']),
      ),
      expect: ['STEM_MISSING_QUESTION_MARK'],
    },
    {
      name: 'space before the question mark',
      input: subject(
        draft('Dünyanın en büyük okyanusu hangisidir ?', ['Pasifik', 'Atlas', 'Hint', 'Arktik']),
      ),
      expect: ['TYPOGRAPHY'],
    },
    {
      name: 'unbalanced parentheses',
      input: subject(
        draft('Dünyanın en büyük okyanusu (alan olarak hangisidir?', [
          'Pasifik',
          'Atlas',
          'Hint',
          'Arktik',
        ]),
      ),
      expect: ['TYPOGRAPHY', 'STEM_PARENTHETICAL'].slice(0, 1) as ReasonCode[],
    },
    {
      name: 'shouting',
      input: subject(
        draft('DÜNYANIN EN BÜYÜK OKYANUSU HANGİSİDİR?', ['Pasifik', 'Atlas', 'Hint', 'Arktik']),
      ),
      expect: ['SHOUTING'],
    },
    {
      name: 'lower-case start',
      input: subject(
        draft('dünyanın en büyük okyanusu hangisidir?', ['Pasifik', 'Atlas', 'Hint', 'Arktik']),
      ),
      expect: ['STEM_LOWERCASE_START'],
    },
    {
      name: 'emoji',
      input: subject(
        draft('Dünyanın en büyük okyanusu hangisidir? 🌊', ['Pasifik', 'Atlas', 'Hint', 'Arktik']),
      ),
      expect: ['EMOJI_IN_TEXT'],
    },
    {
      name: 'link',
      input: subject(
        draft('Dünyanın en büyük okyanusu hangisidir? bkz. www.ornek.com', [
          'Pasifik',
          'Atlas',
          'Hint',
          'Arktik',
        ]),
      ),
      expect: ['LINK_IN_TEXT'],
    },
    {
      name: 'parenthetical in the stem',
      input: subject(
        draft('Dünyanın en büyük okyanusu (yüzölçümüne göre) hangisidir?', [
          'Pasifik',
          'Atlas',
          'Hint',
          'Arktik',
        ]),
      ),
      expect: ['STEM_PARENTHETICAL'],
    },
    {
      name: 'a stem that is too short',
      input: subject(draft('Başkent?', ['Ankara', 'Konya', 'Bursa', 'Adana'])),
      expect: ['STEM_TOO_SHORT'],
    },
    {
      name: 'a stem padded with history',
      input: subject(
        draft(
          `${'Uzun yıllar boyunca birçok medeniyetin yaşadığı ve pek çok önemli olaya sahne olan bu kadim topraklarda '.repeat(2)}hangi şehir başkenttir?`,
          ['Ankara', 'Konya', 'Bursa', 'Adana'],
        ),
      ),
      expect: ['STEM_TOO_LONG'],
    },
    {
      name: 'an unwieldy option',
      input: subject(
        draft('Hangi kavram bu durumu en iyi anlatır?', [
          'Kısa bir cevap',
          'Başka bir cevap',
          'Üçüncü cevap',
          'Bu seçenek bir telefon ekranında rahatça okunamayacak kadar uzun yazılmış bir cümledir',
        ]),
      ),
      expect: ['OPTION_TOO_LONG'],
    },
    {
      name: 'inconsistent option punctuation',
      input: subject(
        draft('Dünyanın en büyük okyanusu hangisidir?', ['Pasifik.', 'Atlas', 'Hint', 'Arktik']),
      ),
      expect: ['OPTION_PUNCTUATION_INCONSISTENT'],
    },
    {
      name: 'three options',
      input: subject(draft('Dünyanın en büyük okyanusu hangisidir?', ['Pasifik', 'Atlas', 'Hint'])),
      expect: ['OPTION_COUNT_NONSTANDARD'],
    },
    {
      name: 'a long quotation',
      input: subject(
        draft(
          '“Yurtta sulh cihanda sulh için çalışmak her vatandaşın en kutsal görevidir elbette” sözü kime aittir?',
          ['Atatürk', 'İnönü', 'Bayar', 'Menderes'],
        ),
      ),
      expect: ['LONG_QUOTE'],
    },
    {
      name: 'a sensitive topic',
      input: subject(
        draft('Hitler hangi ülkenin lideri olmuştur?', ['Almanya', 'İtalya', 'Fransa', 'İspanya']),
        { category: 'history' },
      ),
      expect: ['SENSITIVE_TOPIC'],
    },
    {
      name: 'an absolute claim',
      input: subject(draft('Hangi hayvan kesinlikle hiç uyumaz?', ['Köpek', 'Kedi', 'Ayı', 'Kuş'])),
      expect: ['ABSOLUTE_CLAIM'],
    },
    {
      name: 'a source-required category without a source',
      input: subject(
        draft('Nil Nehri hangi kıtada yer alır?', ['Afrika', 'Asya', 'Güney Amerika', 'Avrupa']),
        { sourceCount: 0 },
      ),
      sourceRequired: true,
      expect: ['SOURCE_REQUIRED_MISSING'],
    },
    {
      name: 'an expired current-event question with a stale check',
      input: subject(
        draft('Ligde şu anda lider olan takım hangisidir?', [
          'Galatasaray',
          'Fenerbahçe',
          'Beşiktaş',
          'Trabzonspor',
        ]),
        {
          category: 'sports',
          pool: 'CURRENT',
          expiresAt: new Date('2026-09-30T00:00:00Z'),
          lastVerifiedAt: new Date('2026-08-01T00:00:00Z'),
        },
      ),
      expect: ['EXPIRED', 'STALE_VERIFICATION'],
    },
    {
      name: 'an evergreen question nobody has re-checked for two years',
      input: subject(
        draft('Nil Nehri hangi kıtada yer alır?', ['Afrika', 'Asya', 'Güney Amerika', 'Avrupa']),
        { lastVerifiedAt: new Date('2024-01-01T00:00:00Z') },
      ),
      expect: ['REVERIFY_DUE'],
    },
  ];

describe('bad questions are noticed (question red team)', () => {
  it.each(BAD)('$name', ({ input, expect: wanted, sourceRequired }) => {
    const found = codes(input, sourceRequired ?? false);
    for (const code of wanted) expect(found).toContain(code);
  });

  it('marks the unambiguous defects as REJECT and the judgement calls as REVIEW', () => {
    const severity = (input: AuditSubject, code: ReasonCode) =>
      audit(input).find((item) => item.code === code)?.severity;
    const reject = [
      'duplicate options',
      'two correct answers',
      'the answer is written in the question',
      'broken encoding',
      'profanity',
      'placeholder text',
    ];
    for (const name of reject) {
      const item = BAD.find((entry) => entry.name === name)!;
      expect(severity(item.input, item.expect[0]!)).toBe('REJECT');
    }
    const review = [
      'negated stem',
      'ambiguous time reference',
      'category mismatch',
      'the correct answer is somewhat longer',
    ];
    for (const name of review) {
      const item = BAD.find((entry) => entry.name === name)!;
      expect(severity(item.input, item.expect[0]!)).toBe('REVIEW');
    }
  });

  it('does not accuse harmless questions of the same things', () => {
    // Negation words inside a longer word, a year long past, a short stem that is still a question.
    expect(
      codes(
        subject(draft('Osmanlı Devleti hangi yıl kuruldu?', ['1299', '1453', '1517', '1923']), {
          category: 'history',
        }),
      ),
    ).toEqual([]);
    expect(
      codes(
        subject(draft('Eyfel Kulesi hangi şehirdedir?', ['Paris', 'Roma', 'Londra', 'Viyana']), {
          category: 'geography',
        }),
      ),
    ).toEqual([]);
  });
});

/**
 * Regressions found by running the heuristics over real Turkish questions: each of these was a false
 * accusation (a number that looked like a year, options that are punctuation) and each is a bug
 * that must stay fixed.
 */
describe('options that only look unusual', () => {
  it('does not call a year and an ordinary number different kinds of answer', () => {
    // 1200 reads as a year and 3500 as a count, but a player sees five numbers.
    expect(
      codes(
        subject(draft('Bir ordunun mevcudu kaç askerdir?', ['900', '1200', '1750', '2400'], 1)),
      ),
    ).not.toContain('OPTION_TYPE_MISMATCH');
    expect(
      codes(
        subject(
          draft('Bu antlaşma kaç yılında imzalanmıştır?', ['1071', '1200', '1453', '1923'], 0),
          {
            category: 'history',
          },
        ),
      ),
    ).not.toContain('OPTION_TYPE_MISMATCH');
  });

  it('still notices a word among numbers', () => {
    expect(
      codes(
        subject(
          draft('Bir üçgenin açıları toplamı kaç derecedir?', ['90', '180', 'Yüz yirmi', '360'], 1),
        ),
      ),
    ).toContain('OPTION_TYPE_MISMATCH');
  });

  it('does not call punctuation-only options duplicates of each other', () => {
    // Folded for comparison, "@", "#", "&" and "%" are all empty; they are four different symbols.
    const symbols = draft(
      'Bir e-posta adresinde kullanıcı adını alan adından ayıran simge hangisidir?',
      ['@', '#', '&', '%'],
    );
    expect(codes(subject(symbols))).not.toContain('DUPLICATE_OPTIONS');
    expect(codes(subject(symbols))).not.toContain('OPTIONS_NEARLY_IDENTICAL');
  });

  it('still catches two identical symbols', () => {
    const twice = draft('Hangi simge bir e-posta adresinde kullanılır?', ['@', '@', '#', '%']);
    expect(codes(subject(twice))).toContain('DUPLICATE_OPTIONS');
  });
});

describe('English questions', () => {
  it('get the language-neutral checks without Turkish-only rules', () => {
    const english = subject(
      draft('Which planet is known as the Red Planet?', ['Mars', 'Venus', 'Jupiter', 'Saturn']),
      { language: 'en', category: 'science' },
    );
    expect(codes(english)).toEqual([]);
    const negated = subject(
      draft('Which of these is NOT a planet?', ['Mars', 'Pluto', 'Venus', 'Earth'], 1),
      { language: 'en', category: 'science' },
    );
    expect(codes(negated)).toContain('NEGATIVE_STEM');
    const temporal = subject(
      draft('Who is the current president of France?', ['Macron', 'Hollande', 'Sarkozy', 'Chirac']),
      { language: 'en', category: 'history' },
    );
    expect(codes(temporal)).toContain('AMBIGUOUS_TEMPORAL');
  });
});

describe('current-event questions', () => {
  const current = (patch: Partial<AuditSubject>) =>
    subject(
      draft('Bu sezon ligde şu anda lider olan takım hangisidir?', [
        'Galatasaray',
        'Fenerbahçe',
        'Beşiktaş',
        'Trabzonspor',
      ]),
      {
        category: 'sports',
        pool: 'CURRENT',
        ...patch,
      },
    );

  it('accept time words when the question carries an expiry and a fresh check', () => {
    const fine = codes(
      current({
        expiresAt: new Date('2026-12-01T00:00:00Z'),
        lastVerifiedAt: new Date('2026-10-05T00:00:00Z'),
      }),
    );
    expect(fine).not.toContain('AMBIGUOUS_TEMPORAL');
    expect(fine).not.toContain('EXPIRED');
    expect(fine).not.toContain('STALE_VERIFICATION');
  });

  it('warn when the expiry is days away', () => {
    const soon = audit(
      current({ expiresAt: new Date('2026-10-10T00:00:00Z'), lastVerifiedAt: RECENT }),
    );
    expect(soon.find((item) => item.code === 'EXPIRY_SOON')).toMatchObject({
      severity: 'INFO',
      detail: { days: 4 },
    });
  });

  it('require a verification date at all', () => {
    expect(
      codes(current({ expiresAt: new Date('2026-12-01T00:00:00Z'), lastVerifiedAt: null })),
    ).toContain('STALE_VERIFICATION');
  });
});

describe('parseNumeric', () => {
  it('reads Turkish and English number formats with units', () => {
    expect(parseNumeric('1.500 km')).toBe(1500);
    expect(parseNumeric('3,5')).toBe(3.5);
    expect(parseNumeric('1,234.5')).toBe(1234.5);
    expect(parseNumeric('1.234,5')).toBe(1234.5);
    expect(parseNumeric('42 %')).toBe(42);
    expect(parseNumeric('88')).toBe(88);
    expect(parseNumeric('Ankara')).toBeNull();
    expect(parseNumeric('H2O')).toBeNull();
    expect(parseNumeric('')).toBeNull();
  });
});
