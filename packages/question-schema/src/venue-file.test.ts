import { describe, expect, it } from 'vitest';
import { parseImportRow } from './schema';
import {
  VENUE_FILE_ISSUE_CODES,
  VENUE_LIMITS,
  decodeVenueFile,
  describeImportIssues,
  detectDelimiter,
  detectVenueFormat,
  categorySlug,
  parseVenueText,
  prepareVenueRow,
} from './venue-file';
import {
  VENUE_CSV_HEADER,
  VENUE_CSV_TEMPLATE,
  VENUE_JSONL_TEMPLATE,
  venuePrompt,
} from './venue-template';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('decodeVenueFile', () => {
  it('reads UTF-8, with or without a byte order mark', () => {
    const plain = decodeVenueFile(bytes('Şişli ğüzel'));
    expect(plain).toEqual({ ok: true, text: 'Şişli ğüzel', warnings: [] });
    const bom = decodeVenueFile(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('merhaba')]));
    expect(bom).toEqual({ ok: true, text: 'merhaba', warnings: [] });
  });

  it('reads the Windows-1254 file Turkish Excel calls "CSV" and says so', () => {
    // "Şişli" in Windows-1254: Ş=0xDE, i, ş=0xFE, l, i
    const result = decodeVenueFile(new Uint8Array([0xde, 0x69, 0xfe, 0x6c, 0x69]));
    expect(result).toMatchObject({ ok: true, text: 'Şişli' });
    expect(result.ok && result.warnings).toEqual([{ field: '', code: 'file_encoding_fallback' }]);
  });

  it('reads the UTF-16 file Excel calls "Unicode Text"', () => {
    const units = [...'a;b\n'].flatMap((char) => [char.charCodeAt(0), 0]);
    const result = decodeVenueFile(new Uint8Array([0xff, 0xfe, ...units]));
    expect(result).toMatchObject({ ok: true, text: 'a;b\n' });
  });

  it.each([
    ['empty', new Uint8Array(0), 'file_empty'],
    [
      'a zip (xlsx, docx, zip bomb)',
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
      'file_excel',
    ],
    ['an old .xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'file_excel'],
    ['a PDF', bytes('%PDF-1.7 hello'), 'file_binary'],
    ['a PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10]), 'file_binary'],
    ['a gzip', new Uint8Array([0x1f, 0x8b, 8, 0]), 'file_binary'],
    ['an executable', bytes('MZ\u0090 program'), 'file_binary'],
    ['NUL bytes inside text', bytes('a,b\u0000c'), 'file_binary'],
    ['control characters', bytes('a,b\u0007c'), 'file_binary'],
  ])('refuses %s', (_label, data, code) => {
    const result = decodeVenueFile(data);
    expect(result).toEqual({ ok: false, issue: expect.objectContaining({ code }) });
  });

  it('refuses a file over the size limit before decoding it', () => {
    const result = decodeVenueFile(new Uint8Array(VENUE_LIMITS.maxBytes + 1).fill(97));
    expect(result).toEqual({
      ok: false,
      issue: expect.objectContaining({ code: 'file_too_large' }),
    });
  });
});

describe('format and delimiter', () => {
  it('chooses the format from the name, then from the content', () => {
    expect(detectVenueFormat('sorular.jsonl', '')).toBe('JSONL');
    expect(detectVenueFormat('sorular.CSV', '{')).toBe('CSV');
    expect(detectVenueFormat('yapistirilan', '{"a":1}')).toBe('JSONL');
    expect(detectVenueFormat('yapistirilan', 'category,difficulty')).toBe('CSV');
  });

  it('detects the semicolon of Turkish Excel, a tab, and ignores separators inside quotes', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n')).toBe('\t');
    expect(detectDelimiter('a,b,c\n')).toBe(',');
    expect(detectDelimiter('"a;b;c;d",e,f\n')).toBe(',');
    expect(detectDelimiter('')).toBe(',');
  });
});

describe('parseVenueText', () => {
  const rowsOf = (result: ReturnType<typeof parseVenueText>) => {
    if (!result.ok) throw new Error(result.issue.code);
    return result.rows;
  };

  it('parses the template, and every template row passes the import contract', () => {
    const rows = rowsOf(parseVenueText(VENUE_CSV_TEMPLATE, 'CSV'));
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      const { raw, issues } = prepareVenueRow(row.raw!);
      expect(issues).toEqual([]);
      const parsed = parseImportRow({ ...raw, category: 'general' });
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    }
  });

  it('parses the JSONL example', () => {
    const rows = rowsOf(parseVenueText(VENUE_JSONL_TEMPLATE, 'JSONL'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const { raw } = prepareVenueRow(row.raw!);
      expect(parseImportRow({ ...raw, category: 'general' }).ok).toBe(true);
    }
  });

  it('accepts a Turkish Excel file: BOM, semicolons, Turkish headers, answer as text or "B)"', () => {
    const csv =
      '\uFEFFKategori;Zorluk;Soru;Şık A;Şık B;Şık C;Şık D;Doğru;Açıklama\r\n' +
      "Genel Kültür;kolay;Türkiye'nin başkenti neresidir?;İstanbul;Ankara;İzmir;Bursa;Ankara;Çünkü\r\n" +
      'Genel Kültür;orta;Dünyanın en büyük okyanusu hangisidir?;Atlas;Hint;Pasifik;Arktik;C);Sığ değil\r\n';
    const rows = rowsOf(parseVenueText(csv.slice(1), 'CSV'));
    expect(rows).toHaveLength(2);
    const first = prepareVenueRow(rows[0]!.raw!).raw;
    expect(first).toMatchObject({
      difficulty: 'EASY',
      correctIndex: 1,
      question: expect.any(String),
    });
    expect(prepareVenueRow(rows[1]!.raw!).raw.correctIndex).toBe(2);
    expect(rows[0]!.line).toBe(2);
  });

  it('removes the apostrophe our own export puts before = + - @', () => {
    const csv = `${VENUE_CSV_HEADER}\r\nX,EASY,"'=Bu bir formül gibi görünen soru mu?",a,b,c,d,A,\r\n`;
    const row = rowsOf(parseVenueText(csv, 'CSV'))[0]!;
    expect(row.raw!.question).toBe('=Bu bir formül gibi görünen soru mu?');
  });

  it('names the missing columns', () => {
    const result = parseVenueText('soru,şık\n1,2\n', 'CSV');
    expect(result).toEqual({
      ok: false,
      issue: {
        field: '',
        code: 'file_missing_columns',
        params: { columns: 'category, difficulty, optionA, optionB, correct' },
      },
    });
  });

  it('refuses a header-only file, a JSON array, too many rows and a huge cell', () => {
    expect(parseVenueText(VENUE_CSV_HEADER + '\n', 'CSV')).toMatchObject({
      ok: false,
      issue: { code: 'file_no_rows' },
    });
    expect(parseVenueText('[{"a":1}]', 'JSONL')).toMatchObject({
      ok: false,
      issue: { code: 'file_json_array' },
    });
    const many = VENUE_CSV_HEADER + '\n' + 'a,EASY,q,1,2,3,4,A,\n'.repeat(VENUE_LIMITS.maxRows + 1);
    expect(parseVenueText(many, 'CSV')).toMatchObject({
      ok: false,
      issue: { code: 'file_too_many_rows' },
    });
    const huge = `${VENUE_CSV_HEADER}\nx,EASY,${'a'.repeat(5000)},1,2,3,4,A,\n`;
    expect(parseVenueText(huge, 'CSV')).toMatchObject({
      ok: false,
      issue: { code: 'file_cell_too_long' },
    });
    expect(parseVenueText(`${VENUE_CSV_HEADER}\nx,EASY,"unterminated\n`, 'CSV')).toMatchObject({
      ok: false,
      issue: { code: 'file_csv_syntax' },
    });
  });

  it('keeps going past a bad JSONL line and reports which line it was', () => {
    const result = parseVenueText('{"question":"x"}\nnot json\n[1,2]\n', 'JSONL');
    expect(result.ok && result.rows.map((row) => [row.line, row.issue?.code ?? 'row'])).toEqual([
      [1, 'row'],
      [2, 'invalid_json'],
      [3, 'row_not_object'],
    ]);
  });
});

describe('prepareVenueRow', () => {
  it('maps difficulty words, drops ignored fields, reports unknown ones', () => {
    const { raw, issues } = prepareVenueRow({
      question: 'q',
      difficulty: 'Çok Zor',
      externalId: 'abc',
      pool: 'CURRENT',
      explanation: '',
      correctindex: 1,
    });
    expect(raw).toEqual({ question: 'q', difficulty: 'EXPERT', authorType: 'AI_ASSISTED' });
    expect(issues).toEqual([
      { field: 'correctindex', code: 'unknown_field', params: { name: 'correctindex' } },
    ]);
  });

  it('keeps an explicit author type so DEV_SEED can be refused later', () => {
    expect(prepareVenueRow({ authorType: 'DEV_SEED' }).raw.authorType).toBe('DEV_SEED');
  });
});

describe('describeImportIssues (what is wrong, in codes the page can phrase)', () => {
  const describe_ = (raw: Record<string, unknown>) => {
    const prepared = prepareVenueRow(raw).raw;
    const parsed = parseImportRow({ category: 'general', ...prepared });
    if (parsed.ok) return [];
    return describeImportIssues(parsed.issues, prepared).map(
      (item) => `${item.field}:${item.code}`,
    );
  };
  const good = {
    difficulty: 'EASY',
    question: 'Türkiye nin başkenti neresidir?',
    options: ['A1', 'B1', 'C1', 'D1'],
    correctIndex: 1,
  };

  it('is empty for a good row', () => expect(describe_(good)).toEqual([]));
  it('question too short, too long, missing', () => {
    expect(describe_({ ...good, question: 'kısa' })).toEqual(['question:question_too_short']);
    expect(describe_({ ...good, question: 'x'.repeat(401) })).toEqual([
      'question:question_too_long',
    ]);
    const { question: _omit, ...without } = good;
    expect(describe_(without)).toEqual(['question:question_missing']);
  });
  it('options too few, too many, empty, too long', () => {
    expect(describe_({ ...good, options: ['tek'], correctIndex: 0 })).toEqual([
      'options:options_too_few',
    ]);
    expect(describe_({ ...good, options: Array.from({ length: 7 }, (_, i) => `s${i}`) })).toEqual([
      'options:options_too_many',
    ]);
    expect(describe_({ ...good, options: ['a', '', 'c', 'd'] })).toContain(
      'options.1:option_empty',
    );
    expect(describe_({ ...good, options: ['a', 'x'.repeat(161), 'c', 'd'] })).toContain(
      'options.1:option_too_long',
    );
  });
  it('correct answer missing or outside the options', () => {
    expect(describe_({ ...good, correctIndex: -1 })).toEqual(['correct:correct_missing']);
    expect(describe_({ ...good, correctIndex: 9 })).toEqual(['correct:correct_out_of_range']);
  });
  it('difficulty, category, explanation, source, language, author', () => {
    expect(describe_({ ...good, difficulty: 'süper' })).toEqual(['difficulty:difficulty_invalid']);
    expect(describe_({ ...good, difficulty: undefined })).toContain(
      'difficulty:difficulty_missing',
    );
    expect(describe_({ ...good, explanation: 'x'.repeat(601) })).toEqual([
      'explanation:explanation_too_long',
    ]);
    expect(describe_({ ...good, sources: [{ url: 'ftp://x' }] })).toEqual([
      'sourceUrl:source_invalid_url',
    ]);
    expect(describe_({ ...good, language: 'fr' })).toEqual(['language:language_invalid']);
    expect(describe_({ ...good, authorType: 'ROBOT' })).toEqual(['authorType:author_invalid']);
  });
});

describe('categorySlug', () => {
  it('folds Turkish letters and punctuation into an id part', () => {
    expect(categorySlug('Kutu Oyunları')).toBe('kutu-oyunlari');
    expect(categorySlug('  İzmir & Çeşme!! ')).toBe('izmir-cesme');
    expect(categorySlug('!!!')).toBe('');
    expect(categorySlug('a'.repeat(60))).toHaveLength(28);
  });
});

describe('the template and the prompt', () => {
  it('the prompt carries the rules the audit enforces', () => {
    const prompt = venuePrompt('CSV');
    for (const needle of [
      'tam 4 şıkkı',
      'EASY',
      'EXPERT',
      VENUE_CSV_HEADER,
      'sourceUrl',
      'Adres uydurma',
      String(VENUE_LIMITS.maxCategoriesPerVenue),
    ])
      expect(prompt).toContain(needle);
    expect(venuePrompt('JSONL')).toContain('correctIndex');
  });

  it('lists every issue code once', () => {
    expect(new Set(VENUE_FILE_ISSUE_CODES).size).toBe(VENUE_FILE_ISSUE_CODES.length);
  });
});
