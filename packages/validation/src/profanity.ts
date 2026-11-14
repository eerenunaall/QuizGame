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
  // "yarak" only at the start of a word: "-yarak" ends common verb forms (başlayarak, toplayarak)
  { word: 'yarrak', patterns: [pattern`yarrak`, pattern`|yarak`] },
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
 * The English list matches inside words that begin or contain ordinary Turkish ones: the prefixes
 * "cum" and "anal" (Cuma, Cumartesi, Cumhuriyeti, kanal, sanal, analiz), and "anus", "penis", "turd"
 * and "arse" anywhere (okyanus, Justinianus, penisilin, tür-de, arşe), "fag" (fagot). Those words
 * are replaced by whole-word forms; the rest of the list is untouched. Found by running the filter
 * over real Turkish text (the question bank audit), so extend this list the same way.
 */
const WHOLE_WORD_ONLY = ['cum', 'anal', 'anus', 'penis', 'turd', 'arse', 'fag'];

function turkishSafeEnglish(): DataSet<{ originalWord: string }> {
  return (
    new DataSet<{ originalWord: string }>()
      .addAll(englishDataset)
      .removePhrasesIf((phrase) => WHOLE_WORD_ONLY.includes(phrase.metadata?.originalWord ?? ''))
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
      )
      .addPhrase((builder) =>
        builder
          .setMetadata({ originalWord: 'anus' })
          .addPattern(pattern`|anus|`)
          .addPattern(pattern`|anuses|`),
      )
      .addPhrase((builder) =>
        builder
          .setMetadata({ originalWord: 'penis' })
          .addPattern(pattern`|penis|`)
          .addPattern(pattern`|penises|`)
          .addPattern(pattern`|pnis|`),
      )
      .addPhrase((builder) =>
        builder
          .setMetadata({ originalWord: 'turd' })
          .addPattern(pattern`|turd|`)
          .addPattern(pattern`|turds|`),
      )
      // "arse" folds to the same letters as the Turkish "arşe" (a violin bow): only the compound stays.
      .addPhrase((builder) =>
        builder.setMetadata({ originalWord: 'arse' }).addPattern(pattern`|arsehole`),
      )
      .addPhrase((builder) =>
        builder
          .setMetadata({ originalWord: 'fag' })
          .addPattern(pattern`|fag|`)
          .addPattern(pattern`|fags|`)
          .addPattern(pattern`|faggot`)
          .addPattern(pattern`|fggot`),
      )
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
