/**
 * Every reason a question can be flagged for, with how serious it is and which audit dimension it
 * belongs to. Codes are stable identifiers stored in `question_audits`; the admin console and the
 * CLI translate them (`admin.reason.<CODE>` in `@quizparty/i18n`). Rubric references: §1 hard
 * reject rules, §4 style, §5 distractors, §12 maintenance (docs/QUESTION_QUALITY.md).
 */
export const DIMENSIONS = [
  'factCheck',
  'ambiguity',
  'grammar',
  'style',
  'distractorQuality',
  'difficulty',
  'duplication',
  'freshness',
  'gameplayValue',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_STATUSES = ['PASS', 'REVIEW', 'FAIL', 'NOT_RUN'] as const;
export type DimensionStatus = (typeof DIMENSION_STATUSES)[number];

export type Severity = 'REJECT' | 'REVIEW' | 'INFO';

interface ReasonInfo {
  severity: Severity;
  dimension: Dimension;
  /** Where the rule comes from, for the editor who wants to know why. */
  rubric: string;
  /**
   * A human approval may acknowledge a REVIEW finding and let the question pass (heuristics have
   * false positives). Facts that only an edit can fix, like a missing source, are never waivable.
   */
  waivable: boolean;
}

const reason = (
  severity: Severity,
  dimension: Dimension,
  rubric: string,
  waivable = severity === 'REVIEW',
): ReasonInfo => ({ severity, dimension, rubric, waivable });

export const REASONS = {
  // structure and answer integrity
  NO_CORRECT_OPTION: reason('REJECT', 'ambiguity', '§1 answer is not among options'),
  MULTIPLE_CORRECT_OPTIONS: reason('REJECT', 'ambiguity', '§1 two or more correct answers'),
  OPTION_COUNT_NONSTANDARD: reason(
    'REVIEW',
    'distractorQuality',
    '§5 four options is the standard',
  ),
  DUPLICATE_OPTIONS: reason('REJECT', 'distractorQuality', '§1 nonsensical distractors'),
  OPTIONS_NEARLY_IDENTICAL: reason(
    'REVIEW',
    'distractorQuality',
    '§5 distractors differ by a typo',
  ),
  OVERLAPPING_OPTIONS: reason('REVIEW', 'ambiguity', '§1 two defensible answers'),
  ALL_OR_NONE_OPTION: reason('REJECT', 'ambiguity', '§1 two or more correct answers'),
  NEGATIVE_STEM: reason('REVIEW', 'ambiguity', '§9.8 avoid negated stems'),
  DOUBLE_NEGATIVE: reason('REVIEW', 'ambiguity', '§9.8 avoid double negatives'),
  ABSOLUTE_CLAIM: reason('REVIEW', 'ambiguity', '§9.8 avoid fake specificity'),
  // giveaways
  ANSWER_IN_QUESTION: reason('REJECT', 'distractorQuality', '§1 wording reveals the answer'),
  ANSWER_STEM_IN_QUESTION: reason('REVIEW', 'distractorQuality', '§1 wording reveals the answer'),
  LENGTH_CLUE_STRONG: reason('REJECT', 'distractorQuality', '§1 answer length reveals the answer'),
  LENGTH_CLUE: reason('REVIEW', 'distractorQuality', '§5 correct answer is an outlier in length'),
  FORMAT_CLUE: reason('REVIEW', 'distractorQuality', '§5 only the answer has a format feature'),
  OPTION_TYPE_MISMATCH: reason('REVIEW', 'distractorQuality', '§5 distractors of another kind'),
  NUMERIC_SCALE_MISMATCH: reason('REVIEW', 'distractorQuality', '§5 distractors of another scale'),
  // language and typography
  BROKEN_ENCODING: reason('REJECT', 'grammar', '§1 broken Turkish'),
  INVALID_CHARACTERS: reason('REJECT', 'grammar', '§1 broken Turkish'),
  PLACEHOLDER_TEXT: reason('REJECT', 'grammar', '§1 nonsensical content'),
  ASCII_FOLDED_TURKISH: reason('REVIEW', 'grammar', '§1 broken Turkish (missing ç ğ ı ö ş ü)'),
  TYPOGRAPHY: reason('REVIEW', 'grammar', '§4 polished copy'),
  STEM_MISSING_QUESTION_MARK: reason('REVIEW', 'grammar', '§4 polished copy'),
  STEM_LOWERCASE_START: reason('REVIEW', 'grammar', '§4 polished copy'),
  OPTION_PUNCTUATION_INCONSISTENT: reason('REVIEW', 'grammar', '§4 polished copy'),
  // style and safety
  PROFANITY: reason('REJECT', 'style', '§1 unsafe content'),
  SENSITIVE_TOPIC: reason('REVIEW', 'style', '§1 unsafe/defamatory content needs an editor'),
  LINK_IN_TEXT: reason('REVIEW', 'style', '§1 copied or unsafe content'),
  EMOJI_IN_TEXT: reason('REVIEW', 'style', '§4 no decoration'),
  SHOUTING: reason('REVIEW', 'style', '§4 natural copy'),
  CONVERSATIONAL_FILLER: reason('REVIEW', 'style', '§4 no fake conversational filler'),
  STEM_PARENTHETICAL: reason('REVIEW', 'style', '§4 no unnecessary parentheticals'),
  STEM_TOO_SHORT: reason('REVIEW', 'style', '§4 clear question'),
  STEM_TOO_LONG: reason('REVIEW', 'style', '§4 no historical padding'),
  OPTION_TOO_LONG: reason('REVIEW', 'style', '§4 readable on a phone'),
  EXPLANATION_TOO_LONG: reason('REVIEW', 'style', '§4 no overexplaining'),
  MISSING_EXPLANATION: reason('INFO', 'style', 'recommended for hard questions'),
  LLM_STYLE_PHRASES: reason('REVIEW', 'style', '§6 does this feel like a language model?'),
  LONG_QUOTE: reason('REVIEW', 'style', '§1 copyrighted text copied from a source'),
  REPEATED_OPENER: reason('REVIEW', 'style', '§4 repeating the same opening syntax'),
  // freshness
  AMBIGUOUS_TEMPORAL: reason('REVIEW', 'freshness', '§9.8 avoid ambiguous temporal wording'),
  RECENT_EVENT_AS_EVERGREEN: reason('REVIEW', 'freshness', '§1 current fact without controls'),
  EXPIRED: reason('REVIEW', 'freshness', '§12 expired current-event question', false),
  STALE_VERIFICATION: reason('REVIEW', 'freshness', '§12 stale verification date', false),
  REVERIFY_DUE: reason(
    'REVIEW',
    'freshness',
    '§12 evergreen questions are reviewed periodically',
    false,
  ),
  EXPIRY_SOON: reason('INFO', 'freshness', '§12 expires within days'),
  NEVER_VERIFIED: reason('INFO', 'freshness', '§12 no verification date'),
  // facts and sources
  SOURCE_REQUIRED_MISSING: reason(
    'REVIEW',
    'factCheck',
    '§1 source-required category without a source',
    false,
  ),
  // gameplay
  CATEGORY_MISMATCH_SUSPECT: reason('REVIEW', 'gameplayValue', '§1 category mismatch'),
  TEMPLATE_REPEAT: reason('REVIEW', 'gameplayValue', '§1 trivial template repeated at scale'),
  // duplicates
  DUPLICATE_LEXICAL: reason('REJECT', 'duplication', '§1 duplicate of an existing question'),
  CONFLICTING_DUPLICATE: reason('REJECT', 'duplication', '§1 same question, different answer'),
  NEAR_DUPLICATE: reason('REJECT', 'duplication', '§1 near-duplicate of an existing question'),
  SIMILAR_QUESTION: reason('REVIEW', 'duplication', '§9.9 similarity above the review threshold'),
  POSSIBLE_SEMANTIC_DUPLICATE: reason('REVIEW', 'duplication', '§9.9 semantic proximity'),
  // decided by the arbiter
  FACT_CHECK_NOT_RUN: reason(
    'REVIEW',
    'factCheck',
    "ADR-0014 nothing is ACTIVE on one model's say-so",
    false,
  ),
  FACT_CHECK_REVIEW: reason('REVIEW', 'factCheck', '§3 fact accuracy needs a human', false),
  SCORES_MISSING: reason(
    'REVIEW',
    'gameplayValue',
    '§3 required minimum scores are missing',
    false,
  ),
  SCORE_BELOW_MINIMUM: reason('REVIEW', 'gameplayValue', '§3 required minimum', false),
} as const satisfies Record<string, ReasonInfo>;

export type ReasonCode = keyof typeof REASONS;

export const REASON_CODES = Object.keys(REASONS) as ReasonCode[];

export function isReasonCode(value: string): value is ReasonCode {
  return Object.prototype.hasOwnProperty.call(REASONS, value);
}

/**
 * Hard-reject reasons a human or model auditor may report (rubric §1). They are free of
 * heuristics: they need judgement or sources. Any of them makes the arbiter REJECT.
 */
export const HARD_REJECT_CODES = [
  'MULTIPLE_DEFENSIBLE_ANSWERS',
  'INCORRECT_ANSWER',
  'FABRICATED_FACT',
  'UNSUPPORTED_CLAIM',
  'ANSWER_NOT_IN_OPTIONS',
  'DUPLICATE',
  'ANSWER_REVEALED_BY_WORDING',
  'ANSWER_REVEALED_BY_FORM',
  'CATEGORY_MISMATCH',
  'BROKEN_TURKISH',
  'NONSENSICAL_DISTRACTORS',
  'SOURCE_CANNOT_SUPPORT_CLAIM',
  'STALE_FACT',
  'COPIED_TEXT',
  'UNSAFE_CONTENT',
  'POLITICAL_WITHOUT_FRESHNESS_CONTROLS',
  'TEMPLATE_SPAM',
] as const;
export type HardRejectCode = (typeof HARD_REJECT_CODES)[number];

export function severityOf(code: ReasonCode): Severity {
  return REASONS[code].severity;
}

export function dimensionOf(code: ReasonCode): Dimension {
  return REASONS[code].dimension;
}

export function isWaivable(code: ReasonCode): boolean {
  return REASONS[code].waivable;
}
