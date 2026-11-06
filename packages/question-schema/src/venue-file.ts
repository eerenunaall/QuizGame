import { CsvError, csvToImportRows, parseCsv, type CsvRowResult } from './csv';
import { JsonlLimitError, parseJsonl } from './jsonl';
import {
  EXPLANATION_MAX,
  MAX_OPTIONS,
  MIN_OPTIONS,
  OPTION_TEXT_MAX,
  QUESTION_TEXT_MAX,
  QUESTION_TEXT_MIN,
} from './enums';
import type { ImportIssue } from './schema';
import { foldKey } from './text';

/**
 * Reading a question file a venue owner uploaded (ADR-0025): bytes -> text -> rows, with the limits and
 * the leniency a café needs (Turkish Excel, a pasted AI answer) and none of the trust a hostile file
 * would like. Pure: no database, no clock. Every problem is a machine code plus parameters; the web page
 * turns it into a sentence that says what is wrong and how to fix it (`venue.issue.*`).
 */
export const VENUE_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxRows: 2000,
  maxCellChars: 4000,
  maxQuestionsPerVenue: 5000,
  maxCategoriesPerVenue: 20,
  maxCategoryLabel: 40,
} as const;

/** One thing wrong with a file or a row, or a hint about it. `field` is '' for a whole row or file. */
export interface VenueIssue {
  field: string;
  code: string;
  params?: Record<string, string | number>;
}

export type VenueFormat = 'CSV' | 'JSONL';

export type DecodedVenueFile =
  { ok: true; text: string; warnings: VenueIssue[] } | { ok: false; issue: VenueIssue };

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((value, index) => bytes[index] === value);

/** File kinds that are certainly not text; the answer tells the owner what to do instead. */
function binaryKind(bytes: Uint8Array): 'file_excel' | 'file_binary' | null {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]))
    return 'file_excel'; // zip container: .xlsx, .ods, .docx, or a zip bomb; none of them is a question file
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return 'file_excel'; // legacy .xls/.doc
  const others: readonly (readonly number[])[] = [
    [0x25, 0x50, 0x44, 0x46], // %PDF
    [0x89, 0x50, 0x4e, 0x47], // PNG
    [0xff, 0xd8, 0xff], // JPEG
    [0x47, 0x49, 0x46, 0x38], // GIF
    [0x1f, 0x8b], // gzip
    [0x7f, 0x45, 0x4c, 0x46], // ELF
    [0x4d, 0x5a], // MZ (Windows executables)
    [0x37, 0x7a, 0xbc, 0xaf], // 7z
    [0x52, 0x61, 0x72, 0x21], // Rar!
    [0x42, 0x5a, 0x68], // bzip2
  ];
  return others.some((signature) => startsWith(bytes, signature)) ? 'file_binary' : null;
}

/** C0 controls other than tab, newline and carriage return: text files do not contain them. */
// eslint-disable-next-line no-control-regex
const CONTROL_BYTES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;

export function decodeVenueFile(bytes: Uint8Array): DecodedVenueFile {
  if (bytes.length === 0) return { ok: false, issue: { field: '', code: 'file_empty' } };
  if (bytes.length > VENUE_LIMITS.maxBytes)
    return {
      ok: false,
      issue: {
        field: '',
        code: 'file_too_large',
        params: { maxMb: VENUE_LIMITS.maxBytes / 1048576 },
      },
    };
  const kind = binaryKind(bytes);
  if (kind) return { ok: false, issue: { field: '', code: kind } };

  const warnings: VenueIssue[] = [];
  let text: string;
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : null;
  if (utf16) {
    // Excel's "Unicode Text" export: tab-separated UTF-16 with a byte order mark.
    text = new TextDecoder(utf16).decode(bytes);
  } else {
    if (bytes.includes(0)) return { ok: false, issue: { field: '', code: 'file_binary' } };
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // Not UTF-8. Turkish Excel's plain "CSV" is Windows-1254; read it as that and say so.
      try {
        text = new TextDecoder('windows-1254').decode(bytes);
        warnings.push({ field: '', code: 'file_encoding_fallback' });
      } catch {
        return { ok: false, issue: { field: '', code: 'file_not_text' } };
      }
    }
  }
  if (CONTROL_BYTES.test(text)) return { ok: false, issue: { field: '', code: 'file_binary' } };
  const replacements = [...text].filter((char) => char === '�').length;
  if (replacements > 0 && replacements / text.length > 0.01)
    return { ok: false, issue: { field: '', code: 'file_not_text' } };
  return { ok: true, text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, warnings };
}

export function detectVenueFormat(fileName: string, text: string): VenueFormat {
  const name = fileName.toLowerCase();
  if (/\.(?:jsonl|ndjson|json)$/u.test(name)) return 'JSONL';
  if (/\.(?:csv|tsv|txt)$/u.test(name)) return 'CSV';
  return /^\s*[{[]/u.test(text) ? 'JSONL' : 'CSV';
}

/** The separator of the header line: `,` (default), `;` (Turkish Excel) or a tab, whichever is most used outside quotes. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const head = text.slice(0, 4000);
  const lineEnd = head.search(/\r|\n/u);
  const first = lineEnd === -1 ? head : head.slice(0, lineEnd);
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of first) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ',' || char === ';' || char === '\t')) counts[char]++;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/** Header aliases: a Turkish spreadsheet's column names map to the canonical ones. Keys are `headerKey`s. */
const HEADER_ALIASES: Readonly<Record<string, string>> = {
  question: 'question',
  soru: 'question',
  sorumetni: 'question',
  category: 'category',
  kategori: 'category',
  difficulty: 'difficulty',
  zorluk: 'difficulty',
  zorlukduzeyi: 'difficulty',
  correct: 'correct',
  dogru: 'correct',
  dogrucevap: 'correct',
  dogrusik: 'correct',
  cevap: 'correct',
  explanation: 'explanation',
  aciklama: 'explanation',
  sourceurl: 'sourceUrl',
  kaynak: 'sourceUrl',
  kaynakurl: 'sourceUrl',
  kaynakadresi: 'sourceUrl',
  sourcetitle: 'sourceTitle',
  kaynakbasligi: 'sourceTitle',
  subcategory: 'subcategory',
  altkategori: 'subcategory',
  topic: 'topic',
  konu: 'topic',
  language: 'language',
  dil: 'language',
  optiona: 'optionA',
  optionb: 'optionB',
  optionc: 'optionC',
  optiond: 'optionD',
  optione: 'optionE',
  optionf: 'optionF',
  sika: 'optionA',
  sikb: 'optionB',
  sikc: 'optionC',
  sikd: 'optionD',
  sike: 'optionE',
  sikf: 'optionF',
  a: 'optionA',
  b: 'optionB',
  c: 'optionC',
  d: 'optionD',
  e: 'optionE',
  f: 'optionF',
  secenek1: 'optionA',
  secenek2: 'optionB',
  secenek3: 'optionC',
  secenek4: 'optionD',
  secenek5: 'optionE',
  secenek6: 'optionF',
};

function headerKey(name: string): string {
  return foldKey(name.replace(/^\uFEFF/u, ''), 'tr').replace(/[^a-z0-9]/gu, '');
}

const REQUIRED_COLUMNS = ['category', 'difficulty', 'question', 'optionA', 'optionB', 'correct'];

/** Our own CSV export writes an apostrophe before `= + - @` cells; reading the file back removes it. */
function unprotect(cell: string): string {
  return /^'[=+\-@]/u.test(cell) ? cell.slice(1) : cell;
}

/**
 * The `correct` cell as a letter: "b", "B)" and "2." are not accepted by the contract, but a person
 * writes them, and so is the answer itself ("Ankara") instead of its letter.
 */
function normalizeCorrect(
  cell: string,
  cells: readonly string[],
  optionAt: readonly number[],
): string {
  const value = cell.trim();
  const letter = /^([A-Fa-f])\s*[).:-]?$/u.exec(value);
  if (letter) return letter[1]!.toUpperCase();
  const key = foldKey(value, 'tr');
  if (key === '') return value;
  const hits = optionAt.flatMap((at, index) =>
    at >= 0 && foldKey(cells[at] ?? '', 'tr') === key ? [index] : [],
  );
  return hits.length === 1 ? String.fromCharCode(65 + hits[0]!) : value;
}

/** The fields of the import contract; anything else in a JSONL row is a typo worth telling the owner about. */
const KNOWN_FIELDS = new Set([
  'language',
  'category',
  'subcategory',
  'topic',
  'difficulty',
  'question',
  'options',
  'correctIndex',
  'explanation',
  'sources',
  'authorType',
  // accepted and ignored: a venue question is always evergreen, venue-owned and without an external id
  'externalId',
  'pool',
  'expiresAt',
  'lastVerifiedAt',
]);
const IGNORED_FIELDS = ['externalId', 'pool', 'expiresAt', 'lastVerifiedAt'];

const DIFFICULTY_WORDS: Readonly<Record<string, string>> = {
  easy: 'EASY',
  kolay: 'EASY',
  medium: 'MEDIUM',
  orta: 'MEDIUM',
  normal: 'MEDIUM',
  hard: 'HARD',
  zor: 'HARD',
  expert: 'EXPERT',
  uzman: 'EXPERT',
  cokzor: 'EXPERT',
};

export interface VenueRowInput {
  /** 1-based line (JSONL) or record number (CSV: the header is line 1). */
  line: number;
  raw?: Record<string, unknown>;
  /** The row could not be turned into an object. */
  issue?: VenueIssue;
}

export type ParsedVenueFile =
  | { ok: true; format: VenueFormat; rows: VenueRowInput[]; delimiter?: ',' | ';' | '\t' }
  | { ok: false; issue: VenueIssue };

const fileIssue = (code: string, params?: Record<string, string | number>): ParsedVenueFile => ({
  ok: false,
  issue: { field: '', code, ...(params ? { params } : {}) },
});

export function parseVenueText(text: string, format: VenueFormat): ParsedVenueFile {
  if (format === 'JSONL') return parseJsonlRows(text);
  return parseCsvRows(text);
}

function parseJsonlRows(text: string): ParsedVenueFile {
  if (/^\s*\[/u.test(text)) return fileIssue('file_json_array');
  let lines;
  try {
    lines = parseJsonl(text, {
      maxBytes: VENUE_LIMITS.maxBytes,
      maxLines: VENUE_LIMITS.maxRows,
      maxLineChars: VENUE_LIMITS.maxCellChars * 8,
    });
  } catch (error) {
    if (error instanceof JsonlLimitError)
      return error.reason === 'too_large'
        ? fileIssue('file_too_large', { maxMb: VENUE_LIMITS.maxBytes / 1048576 })
        : fileIssue('file_too_many_rows', { max: VENUE_LIMITS.maxRows });
    throw error;
  }
  const rows: VenueRowInput[] = lines.map((line) => {
    if (line.error) return { line: line.line, issue: { field: '', code: line.error } };
    if (typeof line.value !== 'object' || line.value === null || Array.isArray(line.value))
      return { line: line.line, issue: { field: '', code: 'row_not_object' } };
    return { line: line.line, raw: { ...(line.value as Record<string, unknown>) } };
  });
  return rows.length === 0 ? fileIssue('file_empty') : { ok: true, format: 'JSONL', rows };
}

function parseCsvRows(text: string): ParsedVenueFile {
  const delimiter = detectDelimiter(text);
  let records: string[][];
  try {
    records = parseCsv(
      text,
      {
        maxBytes: VENUE_LIMITS.maxBytes,
        maxRows: VENUE_LIMITS.maxRows + 1,
        maxCellChars: VENUE_LIMITS.maxCellChars,
      },
      delimiter,
    );
  } catch (error) {
    if (!(error instanceof CsvError)) throw error;
    if (/too many rows/u.test(error.message))
      return fileIssue('file_too_many_rows', { max: VENUE_LIMITS.maxRows });
    if (/cell too long/u.test(error.message))
      return fileIssue('file_cell_too_long', { line: error.line, max: VENUE_LIMITS.maxCellChars });
    if (/too large/u.test(error.message))
      return fileIssue('file_too_large', { maxMb: VENUE_LIMITS.maxBytes / 1048576 });
    return fileIssue('file_csv_syntax', { line: error.line });
  }
  const [header, ...body] = records;
  if (!header || body.length === 0) return fileIssue(header ? 'file_no_rows' : 'file_empty');
  const columns = header.map((name) => HEADER_ALIASES[headerKey(name)] ?? name.trim());
  // "Seçenekler" style files with a single options column are not supported: say which columns are missing.
  const missing = REQUIRED_COLUMNS.filter(
    (name) => !columns.some((column) => column.toLowerCase() === name.toLowerCase()),
  );
  if (missing.length > 0) return fileIssue('file_missing_columns', { columns: missing.join(', ') });
  const correctAt = columns.findIndex((column) => column.toLowerCase() === 'correct');
  const optionAt = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'].map((name) =>
    columns.findIndex((column) => column.toLowerCase() === name.toLowerCase()),
  );
  const cleaned = [
    columns,
    ...body.map((record) => {
      const cells = record.map(unprotect);
      const cell = cells[correctAt];
      if (cell !== undefined) cells[correctAt] = normalizeCorrect(cell, cells, optionAt);
      return cells;
    }),
  ];
  const mapped: CsvRowResult[] = csvToImportRows(cleaned);
  const categoryAt = columns.findIndex((column) => column.toLowerCase() === 'category');
  const rows: VenueRowInput[] = mapped.map((result) => {
    if (result.error) return { line: result.line, issue: { field: '', code: result.error } };
    const raw: Record<string, unknown> = { ...(result.row ?? {}) };
    // The shared CSV mapper lower-cases `category` (it expects an id); a venue writes a name ("İzmir").
    const name = cleaned[result.line - 1]?.[categoryAt]?.trim();
    if (name) raw.category = name;
    return { line: result.line, raw };
  });
  return { ok: true, format: 'CSV', rows, delimiter };
}

/**
 * Turns one raw row into what `QuestionImportSchema` expects: difficulty words, defaults, ignored fields
 * dropped and unknown fields reported. Returns the issues found on the way (the schema reports the rest).
 */
export function prepareVenueRow(input: Record<string, unknown>): {
  raw: Record<string, unknown>;
  issues: VenueIssue[];
} {
  const raw: Record<string, unknown> = {};
  const issues: VenueIssue[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN_FIELDS.has(key)) {
      issues.push({
        field: key.slice(0, 40),
        code: 'unknown_field',
        params: { name: key.slice(0, 40) },
      });
      continue;
    }
    if (IGNORED_FIELDS.includes(key)) continue;
    raw[key] = value;
  }
  // Optional text fields that are empty strings or null are "not given", not "too short".
  for (const key of ['explanation', 'subcategory', 'topic'] as const) {
    const value = raw[key];
    if (value === null || (typeof value === 'string' && value.trim() === '')) delete raw[key];
  }
  if (typeof raw.language === 'string') raw.language = raw.language.trim().toLowerCase();
  if (typeof raw.difficulty === 'string') {
    const word = DIFFICULTY_WORDS[foldKey(raw.difficulty, 'tr').replace(/[^a-z]/gu, '')];
    raw.difficulty = word ?? raw.difficulty.trim().toUpperCase();
  }
  // The author of a venue file is the venue, assisted or not; a file may say HUMAN, never DEV_SEED.
  if (raw.authorType === undefined) raw.authorType = 'AI_ASSISTED';
  return { raw, issues };
}

const OPTION_PATH = /^options\.(\d+)$/u;
const SOURCE_PATH = /^sources\.(\d+)\.(url|title|retrievedAt)$/u;

const lengthOf = (value: unknown): number => (typeof value === 'string' ? [...value].length : 0);

/** The schema's machine issues as the codes the page knows (what is wrong, with the limits to quote). */
export function describeImportIssues(
  issues: readonly ImportIssue[],
  raw: Record<string, unknown>,
): VenueIssue[] {
  const out: VenueIssue[] = [];
  const add = (field: string, code: string, params?: VenueIssue['params']): void => {
    if (!out.some((item) => item.field === field && item.code === code))
      out.push({ field, code, ...(params ? { params } : {}) });
  };
  const options = Array.isArray(raw.options) ? (raw.options as unknown[]) : [];
  for (const issue of issues) {
    const { path, code } = issue;
    const option = OPTION_PATH.exec(path);
    const source = SOURCE_PATH.exec(path);
    if (path === 'question') {
      if (code === 'too_short') add(path, 'question_too_short', { min: QUESTION_TEXT_MIN });
      else if (code === 'too_long')
        add(path, 'question_too_long', { max: QUESTION_TEXT_MAX, len: lengthOf(raw.question) });
      else add(path, 'question_missing');
    } else if (path === 'options') {
      if (code === 'too_big') add(path, 'options_too_many', { max: MAX_OPTIONS });
      else if (code === 'too_small')
        add(path, 'options_too_few', { min: MIN_OPTIONS, have: options.length });
      else add(path, 'options_missing');
    } else if (option) {
      const n = Number(option[1]) + 1;
      if (code === 'too_long')
        add(path, 'option_too_long', { n, max: OPTION_TEXT_MAX, len: lengthOf(options[n - 1]) });
      else add(path, 'option_empty', { n });
    } else if (path === 'correctIndex') {
      if (code === 'correct_index_out_of_range')
        add('correct', 'correct_out_of_range', { count: options.length });
      else add('correct', 'correct_missing');
    } else if (path === 'difficulty') {
      add(path, raw.difficulty === undefined ? 'difficulty_missing' : 'difficulty_invalid');
    } else if (path === 'category') {
      add(path, raw.category === undefined ? 'category_missing' : 'category_invalid');
    } else if (path === 'explanation') {
      if (code === 'too_long')
        add(path, 'explanation_too_long', { max: EXPLANATION_MAX, len: lengthOf(raw.explanation) });
      else add(path, 'row_invalid');
    } else if (source) {
      add(
        source[2] === 'url' ? 'sourceUrl' : 'sourceTitle',
        source[2] === 'url' ? 'source_invalid_url' : 'row_invalid',
      );
    } else if (path === 'language') {
      add(path, 'language_invalid');
    } else if (path === 'authorType') {
      add(path, 'author_invalid');
    } else if (path === 'subcategory' || path === 'topic') {
      add(path, 'text_too_long', { max: path === 'topic' ? 120 : 80 });
    } else {
      add(path, 'row_invalid');
    }
  }
  return out;
}

/** A category name as the id part of a venue category: Turkish letters folded, 28 characters at most. */
export function categorySlug(name: string): string {
  return foldKey(name, 'tr')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 28)
    .replace(/-+$/u, '');
}

/** Issue codes this module can emit (the web copy must cover every one: see the i18n test). */
export const VENUE_FILE_ISSUE_CODES = [
  'file_empty',
  'file_no_rows',
  'file_too_large',
  'file_binary',
  'file_excel',
  'file_not_text',
  'file_json_array',
  'file_too_many_rows',
  'file_cell_too_long',
  'file_csv_syntax',
  'file_missing_columns',
  'file_encoding_fallback',
  'invalid_json',
  'line_too_long',
  'row_not_object',
  'too_many_cells',
  'option_gap',
  'unknown_field',
  'question_missing',
  'question_too_short',
  'question_too_long',
  'options_missing',
  'options_too_few',
  'options_too_many',
  'option_empty',
  'option_too_long',
  'correct_missing',
  'correct_out_of_range',
  'difficulty_missing',
  'difficulty_invalid',
  'category_missing',
  'category_invalid',
  'category_limit',
  'explanation_too_long',
  'source_invalid_url',
  'language_invalid',
  'author_invalid',
  'text_too_long',
  'text_forbidden_characters',
  'text_profanity',
  'row_invalid',
  'venue_full',
  'duplicate',
  'duplicate_in_file',
  'conflicting_duplicate',
  'near_duplicate',
] as const;
