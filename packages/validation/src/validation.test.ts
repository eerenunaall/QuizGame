import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  INTENT_ID_REGEX,
  containsProfanity,
  parseInboundLink,
  sanitizeUserText,
  skeleton,
  validateNickname,
} from './index';

const accepted = (raw: string) => {
  const result = validateNickname(raw);
  if (!result.ok) throw new Error(`${raw} rejected: ${result.reason}`);
  return result;
};
const reason = (raw: unknown) => {
  const result = validateNickname(raw);
  return result.ok ? 'OK' : result.reason;
};

describe('validateNickname', () => {
  it('accepts ordinary Turkish, English and emoji nicknames and trims/collapses whitespace', () => {
    expect(accepted('  Ayşe   Nur ').nickname).toBe('Ayşe Nur');
    expect(accepted('Göktuğ').nickname).toBe('Göktuğ');
    expect(accepted('İlker_42').nickname).toBe('İlker_42');
    expect(accepted('Ece 🦊').nickname).toBe('Ece 🦊');
    expect(accepted('Сергей').nickname).toBe('Сергей'); // a single non-Latin script is fine
  });

  it('enforces length in graphemes, not code units', () => {
    expect(reason('a')).toBe('TOO_SHORT');
    expect(reason('x'.repeat(17))).toBe('TOO_LONG');
    expect(reason('x'.repeat(16))).toBe('OK');
    expect(reason('🦊🦊')).toBe('OK');
    expect(reason('x'.repeat(100))).toBe('TOO_LONG');
    expect(reason('   ')).toBe('EMPTY');
    expect(reason(42)).toBe('EMPTY');
  });

  it('rejects control, zero-width and bidi-override characters', () => {
    for (const bad of ['a\u0000b', 'ab\u200Bcd', 'Ece\u202Egnp', 'ab\u2066cd', 'ab\u0007']) {
      expect(reason(bad), JSON.stringify(bad)).toBe('FORBIDDEN_CHARACTER');
    }
  });

  it('turns exotic whitespace into a single plain space instead of keeping it', () => {
    expect(accepted('a\u00A0\u2003b\u2028c').nickname).toBe('a b c');
    expect(accepted('Ece\tK').nickname).toBe('Ece K');
    expect(accepted('a\uFEFFb').nickname).toBe('a b'); // BOM is whitespace to JS; it never survives as a character
  });

  it('rejects markup-ish and symbol characters', () => {
    for (const bad of ['<b>Ece</b>', 'Ece;DROP', 'a/b', 'Ece"', 'x{y}', 'a=b', 'a&b']) {
      expect(reason(bad), bad).toBe('FORBIDDEN_CHARACTER');
    }
  });

  it('rejects mixed-script homoglyph nicknames', () => {
    expect(reason('Аdmin')).toBe('MIXED_SCRIPT'); // Cyrillic А + Latin dmin
    expect(reason('Ηello')).toBe('MIXED_SCRIPT'); // Greek capital eta + Latin
  });

  it('limits emoji and combining-mark spam', () => {
    expect(reason('🦊🦊🦊')).toBe('TOO_MANY_EMOJI');
    expect(reason('á̂̃̄b')).toBe('FORBIDDEN_CHARACTER');
  });

  it('blocks names that impersonate staff or the game, even via lookalikes and separators', () => {
    for (const bad of [
      'Admin',
      'ADMIN',
      'a d m i n',
      'Ad_min',
      '4dmin',
      'M0derator',
      'Quiz Party',
      'Sistem',
      'Yönetici',
    ]) {
      expect(reason(bad), bad).toBe('RESERVED');
    }
    expect(reason('Adminoğlu')).toBe('OK');
  });

  it('blocks profanity in English and Turkish, obfuscated or not, without flagging innocent names', () => {
    for (const bad of [
      'fuck',
      'f u c k',
      'fvck',
      'orospu',
      'OROSPU',
      'amk',
      'siktir',
      'Siktir_git',
      'o.r.o.s.p.u',
      'yarrak',
    ]) {
      expect(reason(bad), bad).toBe('PROFANITY');
    }
    for (const fine of [
      'Sıla',
      'Sıkıntı',
      'Okan',
      'Bokeh',
      'Kaan',
      'Gökçe',
      'Pınar',
      'Çiğdem',
      'Oğuz',
      'Amcıkoğlu'.slice(0, 0) + 'Aslı',
    ]) {
      expect(reason(fine), fine).toBe('OK');
    }
  });

  it('produces a case/diacritic/confusable-insensitive uniqueness key', () => {
    const key = (raw: string) => accepted(raw).key;
    expect(key('Ayşe')).toBe(key('AYSE'));
    expect(key('Ayşe')).toBe(key('ayse'));
    expect(key('ILKER')).toBe(key('İlker'));
    expect(key('ILKER')).toBe(key('ılker'));
    expect(key('Ece K')).toBe(key('Ece_K'));
    expect(key('Ece.K')).toBe(key('eceK'));
    expect(key('Sergey')).not.toBe(key('Sergei'));
    // all-Cyrillic lookalike collides with the Latin original
    expect(skeleton('сас')).toBe(skeleton('cac'));
  });

  it('is idempotent and never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (raw) => {
        const first = validateNickname(raw);
        if (first.ok) {
          const second = validateNickname(first.nickname);
          expect(second.ok).toBe(true);
          if (second.ok) {
            expect(second.nickname).toBe(first.nickname);
            expect(second.key).toBe(first.key);
          }
        }
      }),
      { numRuns: 400 },
    );
  });
});

describe('containsProfanity', () => {
  it('works on longer text and folds Turkish letters', () => {
    expect(containsProfanity('bu gerçekten güzel bir soru')).toBe(false);
    expect(containsProfanity('seni piç kurusu')).toBe(true);
    expect(containsProfanity('Şerefsiz herif')).toBe(true);
  });
});

describe('sanitizeUserText', () => {
  it('cleans whitespace and rejects links, control characters and long text', () => {
    expect(sanitizeUserText('  çocukken   pilot olmak istedim \n').valueOf()).toEqual({
      ok: true,
      text: 'çocukken pilot olmak istedim',
    });
    expect(sanitizeUserText('bak https://evil.example/x')).toEqual({ ok: false, reason: 'LINK' });
    expect(sanitizeUserText('www.kotu.com')).toEqual({ ok: false, reason: 'LINK' });
    expect(sanitizeUserText('abc‮def')).toEqual({ ok: false, reason: 'FORBIDDEN_CHARACTER' });
    expect(sanitizeUserText('x'.repeat(141))).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(sanitizeUserText('')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(sanitizeUserText('amk')).toEqual({ ok: false, reason: 'PROFANITY' });
  });
});

describe('parseInboundLink (deep-link injection)', () => {
  const hosts = ['quizparty.example'];
  it('accepts canonical join, unlock and blind links', () => {
    expect(parseInboundLink('https://quizparty.example/join/x7p4kq', hosts)).toEqual({
      kind: 'JOIN',
      roomCode: 'X7P4KQ',
    });
    const id = 'A'.repeat(22);
    expect(INTENT_ID_REGEX.test(id)).toBe(true);
    expect(parseInboundLink(`https://quizparty.example/unlock/${id}`, hosts)).toEqual({
      kind: 'UNLOCK',
      intentId: id,
    });
    const token = 'b'.repeat(43);
    expect(parseInboundLink(`https://quizparty.example/blind/${token}?utm=1#frag`, hosts)).toEqual({
      kind: 'BLIND',
      inviteToken: token,
    });
  });

  it('rejects hostile or malformed links', () => {
    for (const bad of [
      'http://quizparty.example/join/X7P4KQ',
      'https://evil.example/join/X7P4KQ',
      'https://quizparty.example.evil.com/join/X7P4KQ',
      'https://user:pw@quizparty.example/join/X7P4KQ',
      'https://quizparty.example/join/X7P4K',
      'https://quizparty.example/join/X7P4KQ/extra',
      'https://quizparty.example/join/../admin',
      'https://quizparty.example/join/%58%37P4KQ',
      'https://quizparty.example/join/X7P4KQ\\..\\x',
      'javascript:alert(1)',
      'quizparty://join/X7P4KQ',
      'https://quizparty.example/unlock/short',
      'https://quizparty.example/',
      '',
      'a'.repeat(600),
    ]) {
      expect(parseInboundLink(bad, hosts), bad).toBeNull();
    }
  });
});
