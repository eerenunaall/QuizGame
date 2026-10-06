import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  pattern,
} from 'obscenity';
import { foldForModeration } from './fold';

/**
 * Profanity matcher: the English dataset from `obscenity` plus a compact set of common Turkish
 * stems. Input is folded first (ş→s, ı→i …), then matched with leet/confusable-resistant
 * transformers. Short stems use word boundaries so ordinary names ("Sıla", "Bokeh") pass.
 * Runs of spaced-out letters ("f u c k", "o.r.o.s.p.u") are re-joined before matching, and
 * `strict` mode (nicknames) additionally matches the long stems with every separator removed.
 * This is a first line of defence; reports and moderation are the rest (ADR-0018).
 */
type Entry = { word: string; patterns: ReturnType<typeof pattern>[] };

/** Long, unmistakable stems: safe to match anywhere, even inside joined text. */
const LONG_STEMS: Entry[] = [
  { word: 'orospu', patterns: [pattern`orospu`, pattern`orosp`] },
  { word: 'yarrak', patterns: [pattern`yarrak`, pattern`yarak`] },
  { word: 'amcik', patterns: [pattern`amcik`, pattern`amcuk`] },
  { word: 'pezevenk', patterns: [pattern`pezevenk`] },
  {
    word: 'siktir',
    patterns: [pattern`siktir`, pattern`|sikik|`, pattern`|sikim`, pattern`|sikeyim`],
  },
  { word: 'serefsiz', patterns: [pattern`|serefsiz`] },
  { word: 'yavsak', patterns: [pattern`|yavsak`] },
  { word: 'surtuk', patterns: [pattern`|surtuk`] },
  { word: 'kaltak', patterns: [pattern`|kaltak`] },
];

/** Short stems: only as whole words, to avoid flagging innocent names. */
const SHORT_STEMS: Entry[] = [
  { word: 'amk', patterns: [pattern`|amk|`, pattern`|amq|`, pattern`|aq|`] },
  { word: 'ibne', patterns: [pattern`|ibne|`, pattern`|ibneler`] },
  { word: 'pust', patterns: [pattern`|pust|`] },
  { word: 'gavat', patterns: [pattern`|gavat|`] },
  { word: 'kahpe', patterns: [pattern`|kahpe|`] },
  { word: 'got', patterns: [pattern`|got|`, pattern`|gotveren`, pattern`|gotunu`] },
  { word: 'oc', patterns: [pattern`|oc|`] },
  { word: 'pic', patterns: [pattern`|pic|`, pattern`|piclik`] },
];

/**
 * The English list matches word *prefixes* for "cum" and "anal" (and "kanal", "sanal", … through
 * its letter-prefixed variants), which begin ordinary Turkish words: Cuma, Cumartesi, Cumhur,
 * Cumhuriyeti, kanal, sanal, analiz. Only the whole-word forms are kept.
 */
function turkishSafeEnglish(): DataSet<{ originalWord: string }> {
  return new DataSet<{ originalWord: string }>()
    .addAll(englishDataset)
    .removePhrasesIf((phrase) => ['cum', 'anal'].includes(phrase.metadata?.originalWord ?? ''))
    .addPhrase((builder) =>
      builder
        .setMetadata({ originalWord: 'cum' })
        .addPattern(pattern`|cum|`)
        .addPattern(pattern`|cums|`)
        .addPattern(pattern`|cuming|`) // the transformers collapse doubled letters first
        .addPattern(pattern`|cumshot`),
    )
    .addPhrase((builder) =>
      builder.setMetadata({ originalWord: 'anal' }).addPattern(pattern`|anal|`),
    );
}

function buildMatcher(entries: Entry[]): RegExpMatcher {
  const dataset = turkishSafeEnglish();
  for (const entry of entries) {
    dataset.addPhrase((builder) => {
      let phrase = builder.setMetadata({ originalWord: entry.word });
      for (const p of entry.patterns) phrase = phrase.addPattern(p);
      return phrase;
    });
  }
  return new RegExpMatcher({ ...dataset.build(), ...englishRecommendedTransformers });
}

const normalMatcher = buildMatcher([...LONG_STEMS, ...SHORT_STEMS]);
const strippedMatcher = buildMatcher(LONG_STEMS);

const SPACED_LETTERS = /(?<![\p{L}\p{N}])(?:\p{L}[\s.\-_*·•]+){2,}\p{L}(?![\p{L}\p{N}])/gu;

export function containsProfanity(text: string, options: { strict?: boolean } = {}): boolean {
  const folded = foldForModeration(text);
  if (normalMatcher.hasMatch(folded)) return true;
  const joined = folded.replace(SPACED_LETTERS, (run) => run.replace(/[\s.\-_*·•]+/gu, ''));
  if (joined !== folded && normalMatcher.hasMatch(joined)) return true;
  if (options.strict) {
    const stripped = folded.replace(/[\s.\-_*·•]+/gu, '');
    if (strippedMatcher.hasMatch(stripped)) return true;
  }
  return false;
}
