import { describe, expect, it } from 'vitest';
import { duplicateFindings } from './duplicates';
import { DEFAULT_HEURISTIC_CONFIG } from './heuristics';
import { MemorySimilarityIndex, buildEntry } from './similarity';

const entry = (id: string, stem: string, answer: string, language: 'tr' | 'en' = 'tr') =>
  buildEntry({ id, language, stem, correctAnswer: answer });

const thresholds = DEFAULT_HEURISTIC_CONFIG.duplicate;
const check = (index: MemorySimilarityIndex, candidate: ReturnType<typeof entry>) =>
  duplicateFindings(candidate, index, thresholds).map((item) => item.code);

describe('duplicate detection', () => {
  const index = new MemorySimilarityIndex();
  index.add(entry('capital', "Türkiye'nin başkenti neresidir?", 'Ankara'));
  index.add(entry('nile', 'Nil Nehri hangi kıtada yer alır?', 'Afrika'));
  index.add(entry('water', 'Suyun kimyasal formülü nedir?', 'H2O'));
  index.add(entry('rome', 'Hangi ülkenin başkenti Roma’dır?', 'İtalya'));

  it('finds the same question typed differently by its lexical fingerprint', () => {
    expect(check(index, entry('x', 'TÜRKİYE’NİN BAŞKENTİ NERESİDİR', 'Ankara'))).toEqual([
      'DUPLICATE_LEXICAL',
    ]);
    expect(check(index, entry('x', "Turkiye'nin   baskenti neresidir ?", 'Ankara'))).toEqual([
      'DUPLICATE_LEXICAL',
    ]);
  });

  it('calls the same question with another answer a conflict, not a duplicate', () => {
    expect(check(index, entry('x', "Türkiye'nin başkenti neresidir?", 'İstanbul'))).toEqual([
      'CONFLICTING_DUPLICATE',
    ]);
  });

  it('flags a lightly reworded copy for review, never rejecting it outright', () => {
    expect(check(index, entry('x', 'Nil Nehri hangi kıtada yer almaktadır?', 'Afrika'))).toEqual([
      'SIMILAR_QUESTION',
    ]);
    expect(check(index, entry('x', "Türkiye'nin başkenti hangi şehirdir?", 'Ankara'))).toEqual([
      'SIMILAR_QUESTION',
    ]);
  });

  it('rejects a copy that differs only by a typo', () => {
    expect(check(index, entry('x', 'Nil Nehri hangi kıtadaa yer alır?', 'Afrika'))).toEqual([
      'NEAR_DUPLICATE',
    ]);
  });

  it('does not accuse a different fact that shares a template', () => {
    expect(check(index, entry('x', 'Hangi ülkenin başkenti Paris’tir?', 'Fransa'))).toEqual([]);
    expect(check(index, entry('x', 'Hangi ülkenin başkenti Madrid’dir?', 'İspanya'))).toEqual([]);
    expect(
      check(index, entry('x', 'Amazon Nehri hangi kıtada yer alır?', 'Güney Amerika')),
    ).toEqual([]);
  });

  it('does not accuse unrelated questions', () => {
    expect(
      check(index, entry('x', 'Mona Lisa tablosunu hangi sanatçı yapmıştır?', 'Leonardo da Vinci')),
    ).toEqual([]);
  });

  it('keeps languages apart', () => {
    expect(check(index, entry('x', "Türkiye'nin başkenti neresidir?", 'Ankara', 'en'))).toEqual([]);
  });

  it('never reports a question as its own duplicate', () => {
    expect(
      check(
        index,
        index.findLexical('tr', entry('c', "Türkiye'nin başkenti neresidir?", 'Ankara').lexical)!,
      ),
    ).toEqual([]);
  });
});

describe('MemorySimilarityIndex at bank scale', () => {
  it('indexes and queries thousands of questions quickly and still finds the planted copy', () => {
    const index = new MemorySimilarityIndex();
    const subjects = ['nehir', 'dağ', 'göl', 'ada', 'şehir', 'ülke', 'okyanus', 'deniz'];
    const regions = ['Ege', 'Akdeniz', 'Karadeniz', 'Marmara', 'Doğu Anadolu', 'İç Anadolu'];
    let count = 0;
    const started = performance.now();
    for (let i = 0; i < 3000; i++) {
      const stem = `${i} numaralı ${subjects[i % subjects.length]} ${regions[i % regions.length]} bölgesinde hangi özelliğiyle bilinir ve ${i * 7} yılında ne olmuştur?`;
      index.add(entry(`q${i}`, stem, `Cevap ${i}`));
      count++;
    }
    expect(index.size).toBe(count);
    const planted = entry(
      'planted',
      '1500 numaralı nehir Ege bölgesinde hangi özelliğiyle bilinir ve 10500 yılında ne olmuştur?',
      'Cevap 1500',
    );
    const hits = index.nearest(planted, { minJaccard: 0.55, minCosine: 0.88 });
    expect(hits.some((hit) => hit.id === 'q1500')).toBe(true);
    expect(performance.now() - started).toBeLessThan(8_000);
  });
});
