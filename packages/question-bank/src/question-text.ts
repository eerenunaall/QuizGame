/**
 * Reads questions that already exist as plain text (a Word/PDF/text document or a paste from the owner's own
 * assistant) into draft cards, with no model and no key (ADR-0028 §6, owner decision 2026-11-10).
 *
 * Shapes understood (Turkish and English labels, any mix inside one text):
 *   1. Türkiye'nin başkenti neresidir?          "1." "1)" "Soru 1:" or no number at all
 *   A) İstanbul   B) Ankara   C) ...  D) ...     one option per line, A/B/C/D in order ("A." "(A)" "a)" too)
 *   Cevap: B                                      also "Doğru cevap: B) Ankara", "Cevap: Ankara", "Yanıt:"
 *   Açıklama: ...                                 optional ("Not:", "Gerekçe:")
 * and an answer key at the end ("Cevap anahtarı: 1-B 2-C", or lines like "3. D"), or the right option marked
 * with a leading "*" or a trailing "*" / check mark / "(doğru)".
 *
 * Pure and deterministic. A block that cannot be read is returned in `skipped` with a reason code the page
 * translates; one bad block never costs the others. The drafts still go through the owner's review and the
 * venue import checks before they become questions.
 */

export const TEXT_IMPORT_LIMITS = {
  /** Same as the draft list the studio shows (ADR-0028 §6). */
  maxQuestions: 200,
  maxStem: 600,
  maxOption: 200,
  maxExplanation: 600,
  excerpt: 80,
} as const;

export type SkipReason =
  | 'options_count'
  | 'no_answer'
  | 'answer_unknown'
  | 'no_text'
  | 'too_long'
  | 'duplicate_options'
  | 'over_cap';

export interface ParsedQuestion {
  /** The number the author gave it, when there was one. */
  number: number | null;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface SkippedBlock {
  reason: SkipReason;
  number: number | null;
  /** The first words of the block, so the owner can find it in the document. */
  excerpt: string;
}

export interface TextParseResult {
  questions: ParsedQuestion[];
  skipped: SkippedBlock[];
  /** True when an answer key was found and used. */
  keyUsed: boolean;
}

const TR_LETTERS = 'A-Za-zÇĞİÖŞÜçğıöşü';
const OPTION = /^\s*([*✓✔]\s*)?[([]?\s*([A-Ea-e])\s*[)\].:\-–]\s*([*✓✔]\s*)?(\S.*)$/u;
const ANSWER =
  /^\s*(?:[dD][oO][gğGĞ][rR][uU]\s+)?(?:[cC][eE][vV][aA][pP]|[yY][aAıIiİ][nN][ıIiİ][tT]|[cC][vV][pP]|[aA][nN][sS][wW][eE][rR])\s*[:=\-–]\s*(.*)$/u;
const EXPLANATION =
  /^\s*(?:[aA][çÇcC][ıIiİ][kK][lL][aA][mM][aA]|[nN][oO][tT]|[gG][eE][rR][eE][kK][çÇcC][eE]|[eE][xX][pP][lL][aA][nN][aA][tT][iI][oO][nN])\s*[:=\-–]\s*(.*)$/u;
const KEY_HEADER =
  /^\s*(?:[cC][eE][vV][aA][pP]\s*[aA][nN][aA][hH][tT][aA][rR][ıIiİ]|[cC][eE][vV][aA][pP][lL][aA][rR]|[yY][aAıIiİ][nN][ıIiİ][tT][lL][aA][rR]|[aA][nN][sS][wW][eE][rR]\s*[kK][eE][yY])\s*[:\-–]?\s*(.*)$/u;
const PAIR = new RegExp(`(\\d{1,3})\\s*[-.):=\\u2013]\\s*([A-Da-d])(?![${TR_LETTERS}])`, 'gu');
const PAIR_LINE = new RegExp(
  `^\\s*(?:\\d{1,3}\\s*[-.):=\\u2013]\\s*[A-Da-d](?![${TR_LETTERS}])\\s*[,;]?\\s*)+$`,
  'u',
);
const NUMBERED = /^\s*(?:[sS][oO][rR][uU]\s*)?(\d{1,3})\s*[.):\-–]\s*(\S.*)$/u;
const SORU_HEAD = /^\s*[sS][oO][rR][uU]\s*(\d{1,3})\s*[.):\-–]?\s*(.*)$/u;
const TRAILING_MARK = /\s*(?:[*✓✔]|\((?:[dD][oO][gğGĞ][rR][uU]|[xX])\))\s*$/u;

const clean = (text: string): string =>
  text
    .replace(/[\u00a0\u200b-\u200d\u2060\ufeff]/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .trim();

const fold = (text: string): string =>
  text
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/gu, 'i')
    .replace(/[^\p{L}\p{N}]+/gu, '');

interface Block {
  number: number | null;
  stem: string[];
  options: string[];
  marked: number | null;
  answerRaw: string | null;
  explanation: string[] | null;
  /** Where a line that matches nothing belongs. */
  target: 'stem' | 'option' | 'explanation' | 'answer';
}

const newBlock = (number: number | null, stem: string): Block => ({
  number,
  stem: stem ? [stem] : [],
  options: [],
  marked: null,
  answerRaw: null,
  explanation: null,
  target: 'stem',
});

/** "B", "B)", "b) Ankara", "(B)" or the text of an option. */
function resolveAnswer(raw: string, options: readonly string[]): number | null {
  const text = clean(raw);
  const letter = /^[([]?([A-Da-d])(?:[)\].:\-–]\s*.*|\s*)$/u.exec(text);
  if (letter) {
    const index = letter[1]!.toUpperCase().charCodeAt(0) - 65;
    if (index < options.length) return index;
  }
  const wanted = fold(text);
  if (!wanted) return null;
  const hit = options.findIndex((option) => fold(option) === wanted);
  return hit >= 0 ? hit : null;
}

const excerptOf = (block: Block): string =>
  clean(block.stem.join(' ') || block.options[0] || '').slice(0, TEXT_IMPORT_LIMITS.excerpt);

export function parseQuestionText(input: string): TextParseResult {
  const lines = input.replace(/\r\n?/gu, '\n').split('\n');
  const skipped: SkippedBlock[] = [];
  const done: { block: Block; reason: SkipReason | null }[] = [];
  const key = new Map<number, number>();
  let keyMode = false;
  let current: Block | null = null;
  let afterBlank = false;

  const complete = (block: Block): boolean => block.answerRaw !== null || block.marked !== null;
  const flush = (): void => {
    if (!current) return;
    const block = current;
    current = null;
    if (block.stem.length === 0 && block.options.length === 0) return;
    done.push({ block, reason: null });
  };
  const readKey = (text: string): boolean => {
    let any = false;
    for (const m of text.matchAll(PAIR)) {
      key.set(Number(m[1]), m[2]!.toUpperCase().charCodeAt(0) - 65);
      any = true;
    }
    return any;
  };

  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (line === '') {
      afterBlank = true;
      continue;
    }
    const wasAfterBlank = afterBlank;
    afterBlank = false;

    const header = KEY_HEADER.exec(line);
    if (header) {
      flush();
      keyMode = true;
      readKey(header[1] ?? '');
      continue;
    }
    if (keyMode) {
      if (readKey(line)) continue;
      // Anything else after the key ends it and is read as a question again.
      keyMode = false;
    }
    if (PAIR_LINE.test(line)) {
      flush();
      readKey(line);
      continue;
    }

    const expected = current ? 65 + current.options.length : -1;
    const option = current ? OPTION.exec(line) : null;
    if (current && option && option[2]!.toUpperCase().charCodeAt(0) === expected) {
      let text = clean(option[4]!);
      let marked = Boolean(option[1] || option[3]);
      const trail = TRAILING_MARK.exec(text);
      if (trail) {
        marked = true;
        text = clean(text.slice(0, trail.index));
      }
      current.options.push(text);
      if (marked) current.marked = current.options.length - 1;
      current.target = 'option';
      continue;
    }

    const answer = ANSWER.exec(line);
    if (current && answer) {
      current.answerRaw = answer[1] ?? '';
      current.target = 'answer';
      continue;
    }
    const explanation = EXPLANATION.exec(line);
    if (current && explanation && current.options.length > 0) {
      current.explanation = [explanation[1] ?? ''];
      current.target = 'explanation';
      continue;
    }

    const head = SORU_HEAD.exec(line) ?? NUMBERED.exec(line);
    if (head && (!current || current.options.length > 0 || complete(current) || wasAfterBlank)) {
      flush();
      current = newBlock(Number(head[1]), clean(head[2] ?? ''));
      continue;
    }

    if (!current) {
      current = newBlock(null, line);
      continue;
    }
    // A new unnumbered question: the previous block is finished and a blank line came in between.
    if (wasAfterBlank && (complete(current) || current.options.length >= 4)) {
      flush();
      current = newBlock(null, line);
      continue;
    }
    // Wrapped text belongs to whatever came last.
    if (current.target === 'option') current.options[current.options.length - 1] += ` ${line}`;
    else if (current.target === 'explanation') current.explanation!.push(line);
    else if (current.target === 'answer') {
      // Answers do not wrap. What follows is the next question's stem, a heading or a page footer; a block
      // with no options and no number is dropped silently at the end.
      flush();
      current = newBlock(null, line);
    } else current.stem.push(line);
  }
  flush();

  const questions: ParsedQuestion[] = [];
  let unnumbered = 0;
  let keyUsed = false;
  for (const entry of done) {
    const { block } = entry;
    const stem = clean(block.stem.join(' '));
    const fail = (reason: SkipReason): void => {
      skipped.push({ reason, number: block.number, excerpt: excerptOf(block) });
    };
    unnumbered += block.number === null ? 1 : 0;
    // Headings and running prose are not questions: no number, no options, no answer.
    if (block.number === null && block.options.length === 0 && block.answerRaw === null) continue;
    if (!stem) {
      fail('no_text');
      continue;
    }
    if (block.options.length !== 4) {
      fail('options_count');
      continue;
    }
    if (
      stem.length > TEXT_IMPORT_LIMITS.maxStem ||
      block.options.some((option) => option.length > TEXT_IMPORT_LIMITS.maxOption)
    ) {
      fail('too_long');
      continue;
    }
    if (new Set(block.options.map(fold)).size !== 4) {
      fail('duplicate_options');
      continue;
    }
    let correct: number | null = block.marked;
    if (correct === null && block.answerRaw !== null) {
      correct = resolveAnswer(block.answerRaw, block.options);
      if (correct === null) {
        fail('answer_unknown');
        continue;
      }
    }
    if (correct === null) {
      const fromKey = key.get(block.number ?? unnumbered);
      if (fromKey !== undefined && fromKey < 4) {
        correct = fromKey;
        keyUsed = true;
      }
    }
    if (correct === null) {
      fail('no_answer');
      continue;
    }
    if (questions.length >= TEXT_IMPORT_LIMITS.maxQuestions) {
      fail('over_cap');
      continue;
    }
    questions.push({
      number: block.number,
      question: stem,
      options: block.options,
      correctIndex: correct,
      explanation: clean((block.explanation ?? []).join(' ')).slice(
        0,
        TEXT_IMPORT_LIMITS.maxExplanation,
      ),
    });
  }
  return { questions, skipped, keyUsed };
}
