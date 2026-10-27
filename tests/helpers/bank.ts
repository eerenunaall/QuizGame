import { createHash } from 'node:crypto';
import type { Database } from '@quizparty/db';

const CATEGORIES = [
  ['history', 'Tarih', 'History'],
  ['geography', 'Coğrafya', 'Geography'],
  ['science', 'Bilim', 'Science'],
  ['sports', 'Spor', 'Sports'],
  ['music', 'Müzik', 'Music'],
  ['cinema', 'Sinema', 'Cinema'],
] as const;

const DIFFICULTIES = ['EASY', 'EASY', 'MEDIUM', 'MEDIUM', 'HARD', 'EXPERT'] as const;

/** Seeds a small, valid, ACTIVE question bank (dev-seed flagged) into a test database. */
export async function seedTestBank(db: Database, perCategory = 12): Promise<number> {
  await db
    .insertInto('categories')
    .values(
      CATEGORIES.map(([id, tr, en], index) => ({
        id,
        label_tr: tr,
        label_en: en,
        sort_order: index,
      })),
    )
    .onConflict((oc) => oc.doNothing())
    .execute();
  let total = 0;
  for (const [id, label] of CATEGORIES.map(([cid, tr]) => [cid, tr] as const)) {
    const questions = Array.from({ length: perCategory }, (_, i) => {
      const text = `${label} sorusu numara ${i + 1}: aşağıdaki seçeneklerden doğru olan hangisidir?`;
      return {
        id: crypto.randomUUID(),
        language: 'tr' as const,
        category_id: id,
        difficulty: DIFFICULTIES[i % DIFFICULTIES.length]!,
        text,
        explanation: `${label} ${i + 1} açıklaması.`,
        status: 'ACTIVE' as const,
        author_type: 'DEV_SEED' as const,
        is_dev_seed: true,
        lexical_fingerprint: createHash('sha256').update(text).digest('hex'),
      };
    });
    await db.insertInto('questions').values(questions).execute();
    await db
      .insertInto('question_options')
      .values(
        questions.flatMap((question, i) =>
          Array.from({ length: 4 }, (_, position) => ({
            question_id: question.id,
            position,
            text: `${label} ${i + 1} seçenek ${position + 1}`,
            is_correct: position === i % 4,
          })),
        ),
      )
      .execute();
    total += questions.length;
  }
  return total;
}
