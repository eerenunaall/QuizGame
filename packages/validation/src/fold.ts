/**
 * Text folding used for uniqueness and moderation keys. Deliberately aggressive: two strings that
 * a person could mistake for each other should fold to the same key (impersonation defence).
 */

/** Cyrillic/Greek look-alikes → Latin. Not exhaustive; combined with the single-script rule. */
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: 'a',
  в: 'b',
  с: 'c',
  е: 'e',
  н: 'h',
  і: 'i',
  ј: 'j',
  к: 'k',
  м: 'm',
  о: 'o',
  р: 'p',
  ѕ: 's',
  т: 't',
  у: 'y',
  х: 'x',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  ӏ: 'i',
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  γ: 'y',
  μ: 'u',
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  $: 's',
  '@': 'a',
  '|': 'i',
  '!': 'i',
  l: 'i',
  ı: 'i',
  ĸ: 'k',
  ß: 's',
  ø: 'o',
  đ: 'd',
  ł: 'i',
  œ: 'e',
  æ: 'e',
};

/**
 * Letters that are Latin by script (so the single-script rule lets them through) yet are drawn like
 * a plain ASCII letter: small capitals, the single-storey a/g, the dental click read as an l.
 * NFKC leaves them alone, so without this "ɑdmin" is neither reserved nor a twin of "admin" and
 * "ꜰᴜᴄᴋ" is not profanity (ATTACK 39).
 */
const LATIN_LOOKALIKES: Readonly<Record<string, string>> = {
  ᴀ: 'a',
  ʙ: 'b',
  ᴄ: 'c',
  ᴅ: 'd',
  ᴇ: 'e',
  ꜰ: 'f',
  ɢ: 'g',
  ʜ: 'h',
  ɪ: 'i',
  ᴊ: 'j',
  ᴋ: 'k',
  ʟ: 'l',
  ᴍ: 'm',
  ɴ: 'n',
  ᴏ: 'o',
  ᴘ: 'p',
  ʀ: 'r',
  ꜱ: 's',
  ᴛ: 't',
  ᴜ: 'u',
  ᴠ: 'v',
  ᴡ: 'w',
  ʏ: 'y',
  ᴢ: 'z',
  ɑ: 'a',
  ɡ: 'g',
  ǀ: 'l',
  ɩ: 'i',
  ɋ: 'q',
};

function foldLookalikes(input: string): string {
  let out = '';
  for (const char of input) out += LATIN_LOOKALIKES[char] ?? char;
  return out;
}

/** Lower-case that treats Turkish İ/I/ı/i as one letter (all fold to "i"). */
export function foldCase(input: string): string {
  return input.replace(/[İIı]/g, 'i').toLowerCase();
}

export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/\p{M}+/gu, '');
}

/** Folded key: case, diacritics, confusables, separators and repeated letters removed. */
export function skeleton(input: string): string {
  const base = foldLookalikes(stripDiacritics(foldCase(input.normalize('NFKC'))));
  let out = '';
  for (const char of base) {
    const mapped = CONFUSABLES[char] ?? char;
    if (/[\s_.\-·•]/u.test(mapped)) continue;
    out += mapped;
  }
  return out;
}

/** Folds Turkish letters to ASCII for the profanity matcher (ş→s, ğ→g, ç→c, ö→o, ü→u, ı/İ→i). */
export function foldForModeration(input: string): string {
  return foldLookalikes(stripDiacritics(foldCase(input.normalize('NFKC'))));
}
