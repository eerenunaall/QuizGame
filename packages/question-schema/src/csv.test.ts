import { describe, expect, it } from 'vitest';
import { CsvError, csvToImportRows, parseCsv, safeCell, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, embedded newlines, CRLF and a BOM', () => {
    const rows = parseCsv('\uFEFFa,b,c\r\n1,"x, y","say ""hi""\nline2"\r\n\r\n4,5,6\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"\nline2'],
      ['4', '5', '6'],
    ]);
  });

  it('handles Turkish text and a missing final newline', () => {
    expect(parseCsv('soru,cevap\nÇalıkuşu nedir?,Roman')).toEqual([
      ['soru', 'cevap'],
      ['Çalıkuşu nedir?', 'Roman'],
    ]);
  });

  it('rejects malformed input with a line number', () => {
    expect(() => parseCsv('a,b\n"open,1')).toThrow(CsvError);
    expect(() => parseCsv('a,b\nx"y,1')).toThrow(/quote inside/u);
    try {
      parseCsv('a\nb\n"never closed');
    } catch (error) {
      expect((error as CsvError).line).toBe(3);
    }
  });

  it('enforces size limits', () => {
    expect(() => parseCsv('a,b\n1,2', { maxBytes: 3, maxRows: 10, maxCellChars: 10 })).toThrow(
      /too large/u,
    );
    expect(() => parseCsv('a\n1\n2\n3', { maxBytes: 100, maxRows: 2, maxCellChars: 10 })).toThrow(
      /too many/u,
    );
    expect(() =>
      parseCsv('a\n' + 'x'.repeat(50), { maxBytes: 100, maxRows: 10, maxCellChars: 10 }),
    ).toThrow(/too long/u);
  });
});

describe('toCsv and safeCell', () => {
  it('round-trips awkward cells', () => {
    const rows = [['a', 'b,c', 'd"e', 'line\nbreak', 'ş']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('neutralises spreadsheet formulas but leaves plain numbers alone', () => {
    expect(safeCell('=HYPERLINK("http://evil","x")')).toBe(`'=HYPERLINK("http://evil","x")`);
    expect(safeCell('+1+1')).toBe("'+1+1");
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCell('-cmd|calc')).toBe("'-cmd|calc");
    expect(safeCell('-5')).toBe('-5');
    expect(safeCell('3,14')).toBe('3,14');
    expect(safeCell('Ankara')).toBe('Ankara');
    expect(toCsv([['=1+1']])).toBe("'=1+1\r\n");
  });
});

describe('csvToImportRows', () => {
  const header = [
    'externalId',
    'category',
    'difficulty',
    'question',
    'optionA',
    'optionB',
    'optionC',
    'optionD',
    'correct',
    'authorType',
    'sourceUrl',
  ];

  it('maps a spreadsheet row to the JSONL contract', () => {
    const [result] = csvToImportRows([
      header,
      [
        'q1',
        'Geography',
        'medium',
        'Nil Nehri hangi kıtada yer alır?',
        'Afrika',
        'Asya',
        'Avrupa',
        'Amerika',
        'a',
        'human',
        'https://tr.wikipedia.org/wiki/Nil',
      ],
    ]);
    expect(result).toEqual({
      line: 2,
      row: {
        options: ['Afrika', 'Asya', 'Avrupa', 'Amerika'],
        correctIndex: 0,
        sources: [{ url: 'https://tr.wikipedia.org/wiki/Nil' }],
        externalId: 'q1',
        category: 'geography',
        difficulty: 'MEDIUM',
        authorType: 'HUMAN',
        question: 'Nil Nehri hangi kıtada yer alır?',
      },
    });
  });

  it('accepts only letters for the correct answer and flags unusable rows', () => {
    const [bad, gap, wide] = csvToImportRows([
      header,
      ['q2', 'x', 'easy', 'Soru metni yeterince uzun', 'A', 'B', '', '', '2', 'human', ''],
      ['q3', 'x', 'easy', 'Soru metni yeterince uzun', 'A', '', 'C', 'D', 'A', 'human', ''],
      [
        'q4',
        'x',
        'easy',
        'Soru metni yeterince uzun',
        'A',
        'B',
        'C',
        'D',
        'A',
        'human',
        '',
        'extra',
      ],
    ]);
    expect(bad?.row?.correctIndex).toBe(-1); // a bare number is ambiguous, so it never matches
    expect(gap?.error).toBe('option_gap');
    expect(wide?.error).toBe('too_many_cells');
  });

  it('ignores unknown columns', () => {
    const [result] = csvToImportRows([
      ['question', 'whatever'],
      ['Merhaba dünya sorusu', 'x'],
    ]);
    expect(result?.row).toMatchObject({ question: 'Merhaba dünya sorusu' });
    expect(result?.row).not.toHaveProperty('whatever');
  });
});
