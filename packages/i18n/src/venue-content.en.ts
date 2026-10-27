// Venue question sets (ADR-0025): the owner's upload page and the per-row explanations. Generated once, edited by hand.
export const venueContentEn = {
  'venue.issue.file_empty': 'The file is empty. Choose a file with your questions.',
  'venue.issue.file_no_rows':
    'The file has a header but no questions. Add the questions under the header.',
  'venue.issue.file_too_large':
    'The file is too large (at most {maxMb} MB). Split the questions into several files.',
  'venue.issue.file_binary':
    'This is not a text file. Save the questions as CSV or JSONL (plain text).',
  'venue.issue.file_excel':
    'Excel files (.xlsx, .xls) cannot be uploaded. In Excel use Save As > "CSV UTF-8" and upload that.',
  'venue.issue.file_not_text':
    'The characters of the file could not be read. Save it as UTF-8 and try again.',
  'venue.issue.file_json_array':
    'The file is one JSON list. Put each question on its own line (JSONL) or use CSV.',
  'venue.issue.file_too_many_rows':
    'A file can hold at most {max} questions. Split it and upload the parts one by one.',
  'venue.issue.file_cell_too_long':
    'Line {line} has a cell that is too long (at most {max} characters). Shorten the text.',
  'venue.issue.file_csv_syntax':
    'The quotation marks near line {line} are wrong. Put a cell with quotes in double quotes and write each inner quote twice.',
  'venue.issue.file_missing_columns':
    'The header lacks these columns: {columns}. Use the header of the template exactly.',
  'venue.issue.file_encoding_fallback':
    'The file was not UTF-8, so it was read as Windows Turkish (1254). If letters look wrong, save it as "CSV UTF-8" in Excel.',
  'venue.issue.invalid_json': 'This line is not valid JSON. Check the quotes and commas.',
  'venue.issue.line_too_long': 'This line is too long. Shorten the question and explanation.',
  'venue.issue.row_not_object':
    'This line is not a question object. Each line must look like { ... }.',
  'venue.issue.too_many_cells':
    'This row has more cells than the header. Put text containing commas in quotes.',
  'venue.issue.option_gap':
    'Fill the options in order (A, B, C, D). A filled option cannot follow an empty one.',
  'venue.issue.unknown_field': 'Unknown field: {name}. Spell it as in the template or remove it.',
  'venue.issue.question_missing': 'The question text is missing. Fill the "question" field.',
  'venue.issue.question_too_short':
    'The question is too short (at least {min} characters). Write it clearly and in full.',
  'venue.issue.question_too_long':
    'The question is too long ({len} characters, at most {max}). Shorten it.',
  'venue.issue.options_missing': 'No options. Write at least two (usually four).',
  'venue.issue.options_too_few':
    'Too few options ({have}). At least {min} are needed, preferably four.',
  'venue.issue.options_too_many': 'Too many options. At most {max}, preferably four.',
  'venue.issue.option_empty':
    'Option {n} is empty. Fill it or remove the empty options at the end.',
  'venue.issue.option_too_long':
    'Option {n} is too long ({len} characters, at most {max}). Shorten it so it fits on a phone.',
  'venue.issue.correct_missing':
    'The correct option is not given. Write A, B, C or D in the "correct" column.',
  'venue.issue.correct_out_of_range':
    'The correct option is outside the options. This question has {count}; the answer must be one of them.',
  'venue.issue.difficulty_missing': 'Difficulty missing. Write EASY, MEDIUM, HARD or EXPERT.',
  'venue.issue.difficulty_invalid':
    'Difficulty not understood. Write EASY, MEDIUM, HARD or EXPERT.',
  'venue.issue.category_missing':
    'Category missing. Write a ready-made category or a name of your own.',
  'venue.issue.category_invalid':
    'The category name is not valid. Use a suitable name of letters and digits, at most {max} characters.',
  'venue.issue.category_limit':
    'A venue can have at most {max} categories of its own. Put this question in an existing category.',
  'venue.issue.explanation_too_long':
    'The explanation is too long ({len} characters, at most {max}). Shorten it.',
  'venue.issue.source_invalid_url':
    'The source address is not valid. Write a full http:// or https:// address, or leave it empty.',
  'venue.issue.language_invalid':
    'Language not understood. Write tr or en, or leave the column empty.',
  'venue.issue.author_invalid': 'The author type is not valid. You can remove this field.',
  'venue.issue.text_too_long': 'The subcategory or topic is too long (at most {max} characters).',
  'venue.issue.text_forbidden_characters':
    'The text contains invisible or direction-changing characters. Retype it as plain text.',
  'venue.issue.text_profanity':
    'The text contains inappropriate wording. This question is not accepted; change the wording.',
  'venue.issue.row_invalid':
    'There is a problem in this row ({field}). Fix it to match the template.',
  'venue.issue.venue_full':
    'Your venue reached the question limit (at most {max}). Remove an older upload.',
  'venue.issue.duplicate':
    'This question already exists (in your set or the shared bank). Skipped.',
  'venue.issue.duplicate_in_file':
    'This question also appears on line {line} of the file. Skipped.',
  'venue.issue.conflicting_duplicate':
    'The same question already exists with another correct answer. Keep the right one. Skipped.',
  'venue.issue.near_duplicate':
    'This question is almost identical to an existing one. Skipped; rewrite it if it is really different.',
  'venue.issue.NO_CORRECT_OPTION': 'The correct answer is not among the options. Add it.',
  'venue.issue.MULTIPLE_CORRECT_OPTIONS': 'More than one option is correct. Only one may be.',
  'venue.issue.OPTION_COUNT_NONSTANDARD': 'There are not four options. Write four.',
  'venue.issue.DUPLICATE_OPTIONS': 'Two options are the same. Write different ones.',
  'venue.issue.OPTIONS_NEARLY_IDENTICAL':
    'Two options are nearly identical. Write options that are easier to tell apart.',
  'venue.issue.OVERLAPPING_OPTIONS':
    'One option contains another, so two answers could be right. Make the options clear.',
  'venue.issue.ALL_OR_NONE_OPTION': 'There is an "all" or "none of the above" option. Remove it.',
  'venue.issue.NEGATIVE_STEM': 'The question is negative ("is not"). Ask it positively.',
  'venue.issue.DOUBLE_NEGATIVE': 'The question has a double negative. Simplify it.',
  'venue.issue.ABSOLUTE_CLAIM':
    'There are absolute words like "always" or "never". Ask about a clearer fact.',
  'venue.issue.ANSWER_IN_QUESTION':
    'The answer appears in the question. Remove it from the question.',
  'venue.issue.ANSWER_STEM_IN_QUESTION':
    'Part of the answer appears in the question. Rewrite the question.',
  'venue.issue.LENGTH_CLUE_STRONG':
    'The correct option is clearly longer or shorter than the rest, which gives it away. Make the options similar in length.',
  'venue.issue.LENGTH_CLUE':
    "The correct option's length differs from the others. Make the options similar in length.",
  'venue.issue.FORMAT_CLUE':
    'Only the correct option has a format feature (capitals, digits, quotes). Write the options in the same style.',
  'venue.issue.OPTION_TYPE_MISMATCH':
    'The options are of different kinds (a number next to a word). Write options of one kind.',
  'venue.issue.NUMERIC_SCALE_MISMATCH':
    'The numeric options differ too much in scale. Use values that are close.',
  'venue.issue.BROKEN_ENCODING': 'The text has broken characters. Save the file as UTF-8.',
  'venue.issue.INVALID_CHARACTERS': 'The text has invalid characters. Use plain text.',
  'venue.issue.PLACEHOLDER_TEXT':
    'The text has a placeholder ("lorem", "xxx", "..."). Write the real text.',
  'venue.issue.ASCII_FOLDED_TURKISH':
    'Turkish letters are missing (ç ğ ı ö ş ü). Rewrite with the proper spelling.',
  'venue.issue.TYPOGRAPHY':
    'There is a small typography problem (extra spaces, punctuation). Fix it.',
  'venue.issue.STEM_MISSING_QUESTION_MARK': 'No question mark. End the question with "?".',
  'venue.issue.STEM_LOWERCASE_START':
    'The question starts with a lowercase letter. Start with a capital.',
  'venue.issue.OPTION_PUNCTUATION_INCONSISTENT':
    'Punctuation differs between options. Write them all the same way.',
  'venue.issue.PROFANITY': 'Inappropriate wording. This question is not accepted.',
  'venue.issue.SENSITIVE_TOPIC':
    'It touches a sensitive subject (politics, religion). Write a more neutral question.',
  'venue.issue.LINK_IN_TEXT':
    'The text contains a link. Remove it; use the "sourceUrl" column for sources.',
  'venue.issue.EMOJI_IN_TEXT': 'The text contains emoji. Remove them.',
  'venue.issue.SHOUTING': 'The text is in capitals. Write it normally.',
  'venue.issue.CONVERSATIONAL_FILLER': 'There is chatty filler ("So", "Let\'s see"). Ask directly.',
  'venue.issue.STEM_PARENTHETICAL': 'The question has a parenthetical remark. Simplify it.',
  'venue.issue.STEM_TOO_SHORT': 'The question is too short. Write it more clearly.',
  'venue.issue.STEM_TOO_LONG': 'The question is too long. Shorten it.',
  'venue.issue.OPTION_TOO_LONG': 'An option is too long for a phone. Shorten it.',
  'venue.issue.EXPLANATION_TOO_LONG': 'The explanation is too long. Cut it to a sentence or two.',
  'venue.issue.MISSING_EXPLANATION': 'No explanation (optional but recommended).',
  'venue.issue.LLM_STYLE_PHRASES':
    'The text carries AI boilerplate. Rewrite it in a natural voice.',
  'venue.issue.LONG_QUOTE': 'There is a long quotation. Put it in your own words.',
  'venue.issue.PROMPT_INJECTION_SUSPECT':
    'The text reads like an instruction to an AI. This question is not accepted.',
  'venue.issue.REPEATED_OPENER': 'Many questions open with the same words. Vary them.',
  'venue.issue.AMBIGUOUS_TEMPORAL':
    'Time-dependent wording ("currently", "latest"). Ask about a fixed date or fact.',
  'venue.issue.RECENT_EVENT_AS_EVERGREEN':
    'It looks like a recent event that may become wrong. Ask about a lasting fact.',
  'venue.issue.EXPIRED': 'The question has expired.',
  'venue.issue.STALE_VERIFICATION': 'The verification date is too old.',
  'venue.issue.REVERIFY_DUE': 'It is due for re-verification.',
  'venue.issue.EXPIRY_SOON': 'The question expires soon.',
  'venue.issue.NEVER_VERIFIED': 'No verification date.',
  'venue.issue.SOURCE_REQUIRED_MISSING': 'This category needs a source.',
  'venue.issue.CATEGORY_MISMATCH_SUSPECT':
    'The question may not fit its category. Check the category.',
  'venue.issue.TEMPLATE_REPEAT': 'Many questions follow one template. Vary them.',
  'venue.issue.DUPLICATE_LEXICAL': 'This question already exists. Skipped.',
  'venue.issue.CONFLICTING_DUPLICATE': 'The same question exists with another answer. Skipped.',
  'venue.issue.NEAR_DUPLICATE': 'Almost identical to an existing question. Skipped.',
  'venue.issue.SIMILAR_QUESTION':
    'It resembles an existing question. Make sure it is really different and rewrite it.',
  'venue.issue.POSSIBLE_SEMANTIC_DUPLICATE':
    'It is close in meaning to an existing question. Ask about a different fact.',
  'venue.issue.FACT_CHECK_NOT_RUN': 'No fact check was run.',
  'venue.issue.FACT_CHECK_REVIEW': 'The fact needs checking.',
  'venue.issue.SCORES_MISSING': 'Quality scores are missing.',
  'venue.issue.SCORE_BELOW_MINIMUM': 'A quality score is too low.',
  'staff.tab.questions': 'Questions',
  'vq.title': "Your venue's questions",
  'vq.intro':
    "Questions you upload here appear only at this venue's tables, never in other venues or in public games.",
  'vq.totals': '{active} live · {review} under review · {retired} removed (limit {max})',
  'vq.empty': 'No questions uploaded yet.',
  'vq.staffOnly': 'Only the venue owner can upload questions. Here you can see the counts.',
  'vq.categories': 'By category',
  'vq.uploads': 'Uploads',
  'vq.upload.line': '{name} · {imported} questions · {when}',
  'vq.upload.active': '{count} live',
  'vq.upload.retired': 'Removed',
  'vq.upload.remove': 'Remove this upload',
  'vq.upload.removeConfirm':
    'Are you sure? The {count} questions of this upload leave play. Tap again.',
  'vq.upload.removed': 'Upload removed: {count} questions left play.',
  'vq.load.title': 'Upload questions',
  'vq.load.file': 'Choose a file (CSV or JSONL)',
  'vq.load.paste': 'or paste the questions here',
  'vq.load.pasteHint': 'CSV (with a header row) or one JSON per line.',
  'vq.load.check': 'Check',
  'vq.load.checking': 'Checking…',
  'vq.help.title': 'How do I prepare the file?',
  'vq.help.body':
    'Download the template or paste the ready prompt into an AI assistant; fill in the topic and count, then upload the CSV it returns. Every question is checked automatically first.',
  'vq.help.csv': 'Download the CSV template',
  'vq.help.jsonl': 'Download the JSONL example',
  'vq.help.prompt': 'Copy the prompt for an AI assistant',
  'vq.help.copied': 'Copied. Paste it into your AI assistant.',
  'vq.help.copyFailed': 'Could not copy; the text is below, select and copy it by hand.',
  'vq.report.title': 'Import report (nothing saved yet)',
  'vq.report.done': 'Imported',
  'vq.report.already':
    'This file was already uploaded ({when}, {count} questions). Nothing changed.',
  'vq.report.ok': '{count} questions will go live',
  'vq.report.okDone': '{count} questions went live',
  'vq.report.review': '{count} need a fix',
  'vq.report.reject': '{count} rejected',
  'vq.report.invalid': '{count} rows unreadable',
  'vq.report.duplicate': '{count} duplicates (skipped)',
  'vq.report.full': '{count} not taken because of the limit',
  'vq.report.newCategories': 'New categories: {names}',
  'vq.report.byCategory': '{label}: {count}',
  'vq.report.problems': 'Rows to fix',
  'vq.report.row': 'Line {line}',
  'vq.report.status.REVIEW': 'Fix and upload again',
  'vq.report.status.REJECT': 'Rejected',
  'vq.report.status.INVALID': 'Unreadable',
  'vq.report.status.DUPLICATE': 'Duplicate',
  'vq.report.status.FULL': 'Limit',
  'vq.report.more': '{count} more rows are not shown.',
  'vq.report.sample': 'The first questions going live',
  'vq.report.nothing': 'Nothing to publish. Fix the problems above first.',
  'vq.report.import': 'Import',
  'vq.report.importing': 'Importing…',
  'vq.report.batchSkew': 'The correct options sit in unbalanced places; consider balancing them.',
  'vq.report.batchLongest': 'The correct option is mostly the longest; balance the option lengths.',
  'vq.export': 'Download the questions as CSV',
  'vq.source.title': 'Question source',
  'vq.source.MIXED': 'Mixed (your questions + the shared bank)',
  'vq.source.VENUE_ONLY': 'Only your questions (topped up from the bank if short)',
  'vq.source.GLOBAL_ONLY': 'Only the shared bank',
  'vq.source.share': 'Your share in mixed mode (%)',
  'vq.reports.title': 'Player reports',
  'vq.reports.none': 'No open reports.',
  'vq.reports.dismiss': 'Dismiss',
  'vq.reports.retire': 'Remove question',
  'vq.reports.reason.WRONG_ANSWER': 'Wrong answer',
  'vq.reports.reason.MULTIPLE_CORRECT': 'More than one correct',
  'vq.reports.reason.OUTDATED': 'Outdated',
  'vq.reports.reason.TYPO': 'Typo',
  'vq.reports.reason.OFFENSIVE': 'Offensive',
  'vq.reports.reason.UNCLEAR': 'Unclear',
  'vq.reports.reason.DUPLICATE': 'Duplicate',
  'vq.reports.reason.OTHER': 'Other',
  'vq.error.generic': 'That did not work. Try again.',
  'vq.error.throttled': 'Too many uploads. Wait a little and try again.',
  'vq.error.forbidden': 'Only the venue owner can do this.',
  'vq.error.limit': "The venue's question limit is reached.",
  'vq.error.fileRead': 'The file could not be read.',
} as const;
