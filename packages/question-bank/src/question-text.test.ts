import { describe, expect, it } from 'vitest';
import { parseQuestionText } from './question-text';

const BLOCK = `1. Türkiye'nin başkenti neresidir?
A) İstanbul
B) Ankara
C) İzmir
D) Bursa
Cevap: B
Açıklama: Başkent 1923'ten beri Ankara'dır.

2. Hangi gezegen Güneş'e en yakındır?
A. Venüs
B. Mars
C. Merkür
D. Jüpiter
Doğru cevap: C) Merkür
`;

describe('parseQuestionText', () => {
  it('reads numbered blocks with a lettered answer, an explanation and a repeated option text', () => {
    const r = parseQuestionText(BLOCK);
    expect(r.skipped).toEqual([]);
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0]).toEqual({
      number: 1,
      question: "Türkiye'nin başkenti neresidir?",
      options: ['İstanbul', 'Ankara', 'İzmir', 'Bursa'],
      correctIndex: 1,
      explanation: "Başkent 1923'ten beri Ankara'dır.",
    });
    expect(r.questions[1]).toMatchObject({ number: 2, correctIndex: 2, explanation: '' });
  });

  it('accepts the answer as the option text, "Yanıt:", lowercase letters and "(B)" options', () => {
    const r = parseQuestionText(
      `Soru 1: Kaç gün vardır?\n(a) 300\n(b) 365\n(c) 400\n(d) 500\nYanıt: 365\n\nSoru 2:\nEn büyük okyanus hangisidir?\na) Hint\nb) Pasifik\nc) Atlas\nd) Arktik\nCEVAP: b`,
    );
    expect(r.skipped).toEqual([]);
    expect(r.questions.map((q) => [q.question, q.correctIndex])).toEqual([
      ['Kaç gün vardır?', 1],
      ['En büyük okyanus hangisidir?', 1],
    ]);
  });

  it('does not mistake an answer text that starts with a letter for a letter', () => {
    const r = parseQuestionText(
      `1. Cumhuriyeti kim kurdu?\nA) Atatürk\nB) İnönü\nC) Bayar\nD) Menderes\nCevap: Atatürk`,
    );
    expect(r.questions[0]!.correctIndex).toBe(0);
    const d = parseQuestionText(
      `1. Soru metni burada?\nA) Bir\nB) İki\nC) Üç\nD) Dört\nCevap: Dört`,
    );
    expect(d.questions[0]!.correctIndex).toBe(3);
  });

  it('reads wrapped lines as part of the question, the option or the explanation', () => {
    const r = parseQuestionText(
      `1. Osmanlı Devleti hangi yılda\nkurulmuştur?\nA) 1299\nB) 1453 yılında İstanbul'un\nfethiyle\nC) 1517\nD) 1071\nCevap: A\nAçıklama: Kuruluş tarihi\ngenellikle 1299 alınır.`,
    );
    expect(r.questions[0]).toMatchObject({
      question: 'Osmanlı Devleti hangi yılda kurulmuştur?',
      options: ['1299', "1453 yılında İstanbul'un fethiyle", '1517', '1071'],
      explanation: 'Kuruluş tarihi genellikle 1299 alınır.',
    });
  });

  it('reads an answer key at the end, with or without a header', () => {
    const body = `1. Birinci soru metni?\nA) a1\nB) b1\nC) c1\nD) d1\n2. İkinci soru metni?\nA) a2\nB) b2\nC) c2\nD) d2\n`;
    for (const key of ['Cevap Anahtarı: 1-B 2-D', 'Cevaplar\n1. B\n2. D', '1-B, 2-D']) {
      const r = parseQuestionText(`${body}\n${key}\n`);
      expect(r.skipped, key).toEqual([]);
      expect(
        r.questions.map((q) => q.correctIndex),
        key,
      ).toEqual([1, 3]);
      expect(r.keyUsed).toBe(true);
    }
  });

  it('takes a marked option as the answer: leading or trailing * and a check mark', () => {
    const r = parseQuestionText(
      `1. İlk soru burada sorulur?\nA) Bir\n*B) İki\nC) Üç\nD) Dört\n\n2. İkinci soru burada?\nA) Bir\nB) İki\nC) Üç ✓\nD) Dört\n\n3. Üçüncü soru burada?\nA) Bir\nB) İki\nC) Üç\nD) Dört *`,
    );
    expect(r.questions.map((q) => q.correctIndex)).toEqual([1, 2, 3]);
    expect(r.questions[1]!.options[2]).toBe('Üç');
  });

  it('splits unnumbered blocks on a blank line', () => {
    const r = parseQuestionText(
      `Birinci soru metni?\nA) a\nB) b\nC) c\nD) d\nCevap: A\n\nİkinci soru metni?\nA) a\nB) b\nC) c\nD) d\nCevap: D\n`,
    );
    expect(r.questions.map((q) => [q.question, q.correctIndex])).toEqual([
      ['Birinci soru metni?', 0],
      ['İkinci soru metni?', 3],
    ]);
  });

  it('lists what it cannot read with a reason, and keeps the rest', () => {
    const r = parseQuestionText(
      [
        '1. Üç şıklı bir soru burada?\nA) a\nB) b\nC) c\nCevap: A',
        '2. Cevabı olmayan soru burada?\nA) a\nB) b\nC) c\nD) d',
        '3. Cevabı bilinmeyen soru burada?\nA) a\nB) b\nC) c\nD) d\nCevap: Z',
        '4. Aynı şıklı soru burada?\nA) a\nB) a\nC) c\nD) d\nCevap: A',
        '5. İyi soru burada sorulur?\nA) a\nB) b\nC) c\nD) d\nCevap: C',
      ].join('\n\n'),
    );
    expect(r.questions.map((q) => q.number)).toEqual([5]);
    expect(r.skipped.map((s) => [s.number, s.reason])).toEqual([
      [1, 'options_count'],
      [2, 'no_answer'],
      [3, 'answer_unknown'],
      [4, 'duplicate_options'],
    ]);
    expect(r.skipped[0]!.excerpt).toContain('Üç şıklı');
  });

  it('does not glue trailing prose, footers or the next stem onto the answer', () => {
    const r = parseQuestionText(
      `1. Birinci soru metni burada?\nA) a\nB) b\nC) c\nD) d\nCevap: B\nSayfa 2 / 9\nGusto Kafe quiz gecesi\n`,
    );
    expect(r.skipped).toEqual([]);
    expect(r.questions[0]!.correctIndex).toBe(1);
    const next = parseQuestionText(
      `Birinci soru metni?\nA) a\nB) b\nC) c\nD) d\nCevap: A\nİkinci soru metni?\nA) a\nB) b\nC) c\nD) d\nCevap: D`,
    );
    expect(next.questions.map((q) => q.correctIndex)).toEqual([0, 3]);
  });

  it('refuses over-long text and caps the count', () => {
    const long = `1. ${'x'.repeat(601)}\nA) a\nB) b\nC) c\nD) d\nCevap: A`;
    expect(parseQuestionText(long).skipped[0]!.reason).toBe('too_long');
    const many = Array.from(
      { length: 210 },
      (_, i) => `${i + 1}. Soru numarası ${i + 1} burada?\nA) a${i}\nB) b\nC) c\nD) d\nCevap: A`,
    ).join('\n\n');
    const r = parseQuestionText(many);
    expect(r.questions).toHaveLength(200);
    expect(r.skipped.filter((s) => s.reason === 'over_cap')).toHaveLength(10);
  });

  it('is calm about empty text, noise and invisible characters', () => {
    expect(parseQuestionText('')).toEqual({ questions: [], skipped: [], keyUsed: false });
    expect(parseQuestionText('Sayfa 1\n\n\n  \nBaşlık').questions).toEqual([]);
    const r = parseQuestionText(`1. Soru metni​ burada?\nA) Bir\nB) İki\nC) Üç\nD) Dört\nCevap: B`);
    expect(r.questions[0]).toMatchObject({ question: 'Soru metni burada?', correctIndex: 1 });
  });

  it('never throws on hostile input and finishes quickly', () => {
    const hostile = [
      'A) '.repeat(5000),
      '1. ' + '(a'.repeat(5000),
      'Cevap: '.repeat(3000),
      '\n'.repeat(100000),
      ('1-A,'.repeat(2000) + '\n').repeat(50),
    ];
    for (const text of hostile) {
      const t0 = Date.now();
      expect(() => parseQuestionText(text)).not.toThrow();
      expect(Date.now() - t0).toBeLessThan(1500);
    }
  });
});
