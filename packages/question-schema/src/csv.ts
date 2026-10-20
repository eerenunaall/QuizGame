/**
 * Small RFC 4180 reader/writer for question batches (GDD §28: editors work in spreadsheets).
 * No dependency: the grammar is tiny and the failure modes (unterminated quote, formula injection
 * on export) are the part that needs tests.
 */
export class CsvError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.name = 'CsvError';
    this.line = line;
  }
}

export interface CsvLimits {
  maxBytes: number;
  maxRows: number;
  maxCellChars: number;
}
export const DEFAULT_CSV_LIMITS: CsvLimits = {
  maxBytes: 8 * 1024 * 1024,
  maxRows: 100_000,
  maxCellChars: 4_000,
};

export function parseCsv(input: string, limits: CsvLimits = DEFAULT_CSV_LIMITS): string[][] {
  if (input.length > limits.maxBytes) throw new CsvError('input too large', 1);
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let cellStartLine = 1;
  const endCell = () => {
    if (cell.length > limits.maxCellChars) throw new CsvError('cell too long', cellStartLine);
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.length > 1 || row[0] !== '') rows.push(row); // blank lines are skipped
    if (rows.length > limits.maxRows) throw new CsvError('too many rows', line);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (char === '\n') line++;
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      if (cell.length > 0) throw new CsvError('quote inside an unquoted cell', line);
      quoted = true;
      cellStartLine = line;
    } else if (char === ',') {
      endCell();
      cellStartLine = line;
    } else if (char === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
      line++;
      cellStartLine = line;
    } else if (char === '\n') {
      endRow();
      line++;
      cellStartLine = line;
    } else cell += char;
  }
  if (quoted) throw new CsvError('unterminated quoted cell', cellStartLine);
  if (cell.length > 0 || row.length > 0) endRow();
  return rows;
}

const DANGEROUS_START = /^[=+\-@\t\r]/u;
const PLAIN_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/u;

/**
 * Spreadsheet applications evaluate cells that start with `= + - @` as formulas. Question text is
 * attacker-influenced (imports, player reports), so exports prefix such cells with an apostrophe.
 */
export function safeCell(value: string): string {
  return DANGEROUS_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  const encode = (cell: string): string => {
    const safe = safeCell(cell);
    return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
  };
  return rows.map((row) => row.map(encode).join(',')).join('\r\n') + '\r\n';
}

/** Column names accepted in a CSV import (header row, case-insensitive). */
export const CSV_COLUMNS = [
  'externalId',
  'language',
  'category',
  'subcategory',
  'topic',
  'difficulty',
  'question',
  'optionA',
  'optionB',
  'optionC',
  'optionD',
  'optionE',
  'optionF',
  'correct',
  'explanation',
  'sourceUrl',
  'sourceTitle',
  'pool',
  'expiresAt',
  'lastVerifiedAt',
  'authorType',
] as const;

const OPTION_COLUMNS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'] as const;

export interface CsvRowResult {
  line: number;
  /** The object to validate with `parseImportRow`, or the reason the row could not be mapped. */
  row?: Record<string, unknown>;
  error?: string;
}

/** Maps CSV records to the JSONL import shape. `correct` is a letter A–F (never a bare number). */
export function csvToImportRows(records: readonly (readonly string[])[]): CsvRowResult[] {
  const [header, ...body] = records;
  if (!header) return [];
  const known = new Map(CSV_COLUMNS.map((name) => [name.toLowerCase(), name]));
  const columns = header.map((name) => known.get(name.trim().toLowerCase()) ?? null);
  const results: CsvRowResult[] = [];
  for (const [offset, record] of body.entries()) {
    const line = offset + 2;
    const cells = new Map<string, string>();
    for (const [index, value] of record.entries()) {
      const column = columns[index];
      const trimmed = value.trim();
      if (column && trimmed !== '') cells.set(column, trimmed);
    }
    if (record.length > header.length) {
      results.push({ line, error: 'too_many_cells' });
      continue;
    }
    const options: string[] = [];
    let gap = false;
    let gapError = false;
    for (const column of OPTION_COLUMNS) {
      const value = cells.get(column);
      if (value === undefined) gap = true;
      else if (gap) gapError = true;
      else options.push(value);
    }
    if (gapError) {
      results.push({ line, error: 'option_gap' });
      continue;
    }
    const letter = cells.get('correct')?.toUpperCase();
    const correctIndex = letter && /^[A-F]$/u.test(letter) ? letter.charCodeAt(0) - 65 : -1;
    const source = cells.get('sourceUrl')
      ? [
          {
            url: cells.get('sourceUrl')!,
            ...(cells.get('sourceTitle') ? { title: cells.get('sourceTitle')! } : {}),
          },
        ]
      : [];
    const row: Record<string, unknown> = {
      options,
      correctIndex,
      sources: source,
    };
    for (const key of [
      'externalId',
      'language',
      'category',
      'subcategory',
      'topic',
      'difficulty',
      'explanation',
      'pool',
      'expiresAt',
      'lastVerifiedAt',
      'authorType',
    ] as const) {
      const value = cells.get(key);
      if (value === undefined) continue;
      // Spreadsheet users type "hard" and "TR"; the contract is upper-case enums and lower-case ids.
      if (key === 'difficulty' || key === 'pool' || key === 'authorType')
        row[key] = value.toUpperCase();
      else if (key === 'language' || key === 'category') row[key] = value.toLowerCase();
      else row[key] = value;
    }
    const question = cells.get('question');
    if (question !== undefined) row.question = question;
    results.push({ line, row });
  }
  return results;
}
