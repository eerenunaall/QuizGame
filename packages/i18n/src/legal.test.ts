import { describe, expect, it } from 'vitest';
import { legal, type LegalDocId } from './legal';

const DOCS: LegalDocId[] = ['privacy', 'terms', 'support'];
const markers = (text: string) => (text.match(/OWNER-TO-FILL/gu) ?? []).length;
const flat = (id: LegalDocId, locale: 'tr' | 'en') =>
  legal[locale].docs[id].sections.flatMap((s) => [
    s.heading,
    ...(s.paragraphs ?? []),
    ...(s.items ?? []),
  ]);

describe('legal pages copy', () => {
  it('Turkish and English have the same shape, section by section', () => {
    for (const id of DOCS) {
      const tr = legal.tr.docs[id].sections;
      const en = legal.en.docs[id].sections;
      expect(en.length, id).toBe(tr.length);
      tr.forEach((section, i) => {
        expect(en[i]!.items?.length ?? 0, `${id} §${i + 1} items`).toBe(section.items?.length ?? 0);
        expect(en[i]!.paragraphs?.length ?? 0, `${id} §${i + 1} paragraphs`).toBe(
          section.paragraphs?.length ?? 0,
        );
      });
      // every owner value left open in one language is open in the other
      expect(markers(flat(id, 'en').join(' ')), id).toBe(markers(flat(id, 'tr').join(' ')));
    }
  });

  it('says plainly that the texts are drafts and not legal advice', () => {
    expect(legal.tr.draftNotice).toMatch(/hukuki tavsiye değildir/u);
    expect(legal.en.draftNotice).toMatch(/not legal advice/u);
  });

  it('covers the KVKK notice headings and the retention defaults of the server', () => {
    const headings = legal.tr.docs.privacy.sections.map((s) => s.heading).join(' | ');
    for (const word of [
      'Veri sorumlusu',
      'verileri',
      'Neden',
      'saklıyoruz',
      'Hakların',
      'İletişim',
    ])
      expect(headings).toContain(word);
    const privacy = flat('privacy', 'tr').join(' ');
    // DEFAULT_RETENTION in apps/realtime/src/moderation/retention.ts
    for (const fact of ['30 gün', '24 saat', '7 gün', '180 gün']) expect(privacy).toContain(fact);
  });

  it('carries the trademark notice in both languages', () => {
    expect(flat('terms', 'en').join(' ')).toContain(
      'QuizNight is not affiliated with, endorsed or sponsored by the owners of the films, series, books or brands mentioned in its questions; names are used only to describe the topic of the questions. All trademarks belong to their respective owners.',
    );
    expect(flat('terms', 'tr').join(' ')).toMatch(/ilgili sahiplerine aittir/u);
  });
});
