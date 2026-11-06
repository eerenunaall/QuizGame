import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';

/**
 * Migration 0004 (ADR-0014, ADR-0012, ADR-0018): the lifecycle guards of the question bank and the
 * tables behind moderation. The database refuses what the application must never do, so a bug or
 * a hand-written SQL statement cannot publish an unaudited question.
 */
let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
  await t.db
    .insertInto('categories')
    .values({ id: 'general', label_tr: 'Genel Kültür', label_en: 'General Knowledge' })
    .execute();
});
afterAll(async () => {
  await t.drop();
});

interface Made {
  id: string;
  optionIds: string[];
}

/** A question with four options, exactly one correct, in one transaction (so revision stays 1). */
async function question(
  overrides: { status?: string; dev?: boolean; correctOptions?: number } = {},
): Promise<Made> {
  const id = randomUUID();
  const dev = overrides.dev ?? false;
  const optionIds: string[] = [];
  await t.db.transaction().execute(async (trx) => {
    await trx
      .insertInto('questions')
      .values({
        id,
        language: 'tr',
        category_id: 'general',
        difficulty: 'MEDIUM',
        text: `Bu bir deneme sorusudur ${id}?`,
        status: (overrides.status ?? 'DRAFT') as 'DRAFT',
        author_type: dev ? 'DEV_SEED' : 'HUMAN',
        is_dev_seed: dev,
        lexical_fingerprint: id,
      })
      .execute();
    for (let position = 0; position < 4; position++) {
      const optionId = randomUUID();
      optionIds.push(optionId);
      await trx
        .insertInto('question_options')
        .values({
          id: optionId,
          question_id: id,
          position,
          text: `Seçenek ${position}`,
          is_correct: position < (overrides.correctOptions ?? 1) && position === 0,
        })
        .execute();
    }
  });
  return { id, optionIds };
}

async function audit(
  id: string,
  patch: {
    revision?: number;
    pass?: string;
    status?: string;
    factCheck?: string;
  } = {},
): Promise<void> {
  const revision =
    patch.revision ??
    (
      await t.db
        .selectFrom('questions')
        .select('revision')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).revision;
  await t.pool.query(
    `INSERT INTO question_audits (question_id, question_revision, pass, provider, status, dimensions)
     VALUES ($1, $2, $3, 'test', $4, $5::jsonb)`,
    [
      id,
      revision,
      patch.pass ?? 'ARBITER',
      patch.status ?? 'PASS',
      JSON.stringify({ factCheck: patch.factCheck ?? 'PASS' }),
    ],
  );
}

const status = async (id: string) =>
  (
    await t.db
      .selectFrom('questions')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  ).status;
const revision = async (id: string) =>
  (
    await t.db
      .selectFrom('questions')
      .select('revision')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  ).revision;
const setStatus = (id: string, to: string) =>
  t.pool.query('UPDATE questions SET status = $2 WHERE id = $1', [id, to]);

describe('questions never become ACTIVE without a passing audit', () => {
  it('refuses to insert a non-seed question as ACTIVE or APPROVED', async () => {
    for (const forbidden of ['ACTIVE', 'APPROVED']) {
      await expect(question({ status: forbidden }), forbidden).rejects.toThrow(
        /without a passing audit/u,
      );
    }
  });

  it('lets dev-seed questions be ACTIVE: they are never served in production', async () => {
    const seed = await question({ status: 'ACTIVE', dev: true });
    expect(await status(seed.id)).toBe('ACTIVE');
  });

  it('refuses ACTIVE with no audit, a non-PASS verdict, a failing fact check or another revision', async () => {
    const q = await question();
    await expect(setStatus(q.id, 'ACTIVE')).rejects.toThrow(/without a passing audit/u);

    await audit(q.id, { status: 'REVIEW' });
    await expect(setStatus(q.id, 'ACTIVE')).rejects.toThrow(/without a passing audit/u);

    await audit(q.id, { factCheck: 'NOT_RUN' });
    await expect(setStatus(q.id, 'ACTIVE')).rejects.toThrow(/without a passing audit/u);

    await audit(q.id, { revision: 99 });
    await expect(setStatus(q.id, 'ACTIVE')).rejects.toThrow(/without a passing audit/u);

    await audit(q.id, { pass: 'FACT_CHECK' }); // a model's PASS is not the arbiter's
    await expect(setStatus(q.id, 'ACTIVE')).rejects.toThrow(/without a passing audit/u);
    expect(await status(q.id)).toBe('DRAFT');
  });

  it('allows ACTIVE once the latest arbiter audit for this revision passed with a passing fact check', async () => {
    const q = await question();
    await audit(q.id);
    await setStatus(q.id, 'ACTIVE');
    expect(await status(q.id)).toBe('ACTIVE');
  });

  it('uses the latest arbiter verdict: a later REVIEW withdraws an earlier PASS', async () => {
    const q = await question();
    await audit(q.id);
    await audit(q.id, { status: 'REVIEW' });
    await expect(setStatus(q.id, 'APPROVED')).rejects.toThrow(/without a passing audit/u);
  });

  it('needs two to six options with exactly one correct', async () => {
    const none = await question();
    await t.pool.query('UPDATE question_options SET is_correct = false WHERE question_id = $1', [
      none.id,
    ]);
    await audit(none.id);
    await expect(setStatus(none.id, 'ACTIVE')).rejects.toThrow(/exactly one correct/u);

    const two = await question();
    await expect(
      t.pool.query('UPDATE question_options SET is_correct = true WHERE question_id = $1', [
        two.id,
      ]),
    ).rejects.toThrow(); // the partial unique index: at most one correct

    const single = await question();
    await t.pool.query('DELETE FROM question_options WHERE question_id = $1 AND position > 0', [
      single.id,
    ]);
    await audit(single.id);
    await expect(setStatus(single.id, 'ACTIVE')).rejects.toThrow(/2-6 options/u);
  });

  it('gates a dev-seed question that is converted into a real one', async () => {
    const seed = await question({ status: 'ACTIVE', dev: true });
    await expect(
      t.pool.query(
        `UPDATE questions SET is_dev_seed = false, author_type = 'HUMAN' WHERE id = $1`,
        [seed.id],
      ),
    ).rejects.toThrow(/without a passing audit/u);
  });
});

describe('the content of an APPROVED or ACTIVE question is frozen', () => {
  async function active(): Promise<Made> {
    const q = await question();
    await audit(q.id);
    await setStatus(q.id, 'ACTIVE');
    return q;
  }

  it('refuses edits of the text, explanation, difficulty, category, language and pool', async () => {
    const q = await active();
    for (const change of [
      `text = 'Başka bir soru metni yazıyoruz?'`,
      `explanation = 'yeni açıklama'`,
      `difficulty = 'HARD'`,
      `language = 'en'`,
      `pool = 'CURRENT', expires_at = now() + interval '1 day'`,
    ]) {
      await expect(
        t.pool.query(`UPDATE questions SET ${change} WHERE id = $1`, [q.id]),
        change,
      ).rejects.toThrow(/frozen/u);
    }
  });

  it('refuses to add, change or remove options', async () => {
    const q = await active();
    await expect(
      t.pool.query(
        `INSERT INTO question_options (question_id, position, text) VALUES ($1, 4, 'Beşinci')`,
        [q.id],
      ),
    ).rejects.toThrow(/frozen/u);
    await expect(
      t.pool.query(`UPDATE question_options SET text = 'Değişti' WHERE id = $1`, [q.optionIds[1]]),
    ).rejects.toThrow(/frozen/u);
    await expect(
      t.pool.query(`UPDATE question_options SET is_correct = true WHERE id = $1`, [q.optionIds[1]]),
    ).rejects.toThrow();
    await expect(
      t.pool.query('DELETE FROM question_options WHERE id = $1', [q.optionIds[1]]),
    ).rejects.toThrow(/frozen/u);
  });

  it('still lets telemetry and freshness fields change', async () => {
    const q = await active();
    await t.pool.query(
      `UPDATE questions SET usage_count = usage_count + 1, answer_count = answer_count + 5, last_used_at = now(),
         last_verified_at = now(), expires_at = now() + interval '30 days' WHERE id = $1`,
      [q.id],
    );
    await t.pool.query('UPDATE question_options SET pick_count = pick_count + 3 WHERE id = $1', [
      q.optionIds[2],
    ]);
    expect(await revision(q.id)).toBe(1);
  });

  it('allows editing after the question is moved to REVIEW, bumping the revision and voiding the old audit', async () => {
    const q = await active();
    await t.pool.query(
      `UPDATE questions SET status = 'REVIEW', text = 'Düzeltilmiş soru metni burada?' WHERE id = $1`,
      [q.id],
    );
    expect(await revision(q.id)).toBe(2);
    await expect(setStatus(q.id, 'ACTIVE')).rejects.toThrow(/revision 2/u); // the audit is for revision 1
    await audit(q.id);
    await setStatus(q.id, 'ACTIVE');
    expect(await status(q.id)).toBe('ACTIVE');
  });

  it('applies the freeze to dev-seed rows only as far as production never serves them', async () => {
    const seed = await question({ status: 'ACTIVE', dev: true });
    await t.pool.query(
      `UPDATE questions SET text = 'Tohum sorusu düzenlendi, hâlâ geçerli?' WHERE id = $1`,
      [seed.id],
    );
    expect(await status(seed.id)).toBe('ACTIVE');
  });
});

describe('revisions', () => {
  it('start at 1 for an import, and count one per editing transaction', async () => {
    const q = await question();
    expect(await revision(q.id)).toBe(1);
    await t.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('questions')
        .set({ text: 'İlk düzenleme yapıldı mı acaba?' })
        .where('id', '=', q.id)
        .execute();
      await trx
        .updateTable('questions')
        .set({ explanation: 'Açıklama eklendi.' })
        .where('id', '=', q.id)
        .execute();
      await trx
        .updateTable('question_options')
        .set({ text: 'Yeni seçenek' })
        .where('id', '=', q.optionIds[1]!)
        .execute();
    });
    expect(await revision(q.id)).toBe(2);
    await t.pool.query(`UPDATE question_options SET text = 'Bir daha' WHERE id = $1`, [
      q.optionIds[1],
    ]);
    expect(await revision(q.id)).toBe(3);
  });

  it('are not bumped by metadata or counters', async () => {
    const q = await question();
    await t.pool.query(
      `UPDATE questions SET topic = 'konu', subcategory = 'alt', usage_count = 4 WHERE id = $1`,
      [q.id],
    );
    expect(await revision(q.id)).toBe(1);
  });
});

describe('append-only history', () => {
  it('refuses to edit an audit', async () => {
    const q = await question();
    await audit(q.id);
    await expect(
      t.pool.query(`UPDATE question_audits SET status = 'REJECT' WHERE question_id = $1`, [q.id]),
    ).rejects.toThrow(/append-only/u);
  });

  it('validates the shape of an audit row', async () => {
    const q = await question();
    for (const [column, value] of [
      ['pass', 'GUESS'],
      ['status', 'MAYBE'],
    ] as const) {
      await expect(
        t.pool.query(
          `INSERT INTO question_audits (question_id, question_revision, pass, provider, status)
           VALUES ($1, 1, ${column === 'pass' ? '$2' : `'HEURISTIC'`}, 'x', ${column === 'status' ? '$2' : `'PASS'`})`,
          [q.id, value],
        ),
      ).rejects.toThrow();
    }
  });

  it('logs every status change by itself, with the actor and reason the application stated', async () => {
    const actor = randomUUID();
    const q = await question();
    await audit(q.id);
    await t.db.transaction().execute(async (trx) => {
      await sql`select set_config('qp.actor', ${actor}, true), set_config('qp.reason', 'EDITOR_APPROVED', true),
                set_config('qp.detail', '{"note":"ok"}', true)`.execute(trx);
      await trx.updateTable('questions').set({ status: 'ACTIVE' }).where('id', '=', q.id).execute();
    });
    await setStatus(q.id, 'REVIEW'); // hand-written SQL is logged too, as UNSPECIFIED
    const log = await t.db
      .selectFrom('question_status_log')
      .select(['from_status', 'to_status', 'actor_account_id', 'reason', 'detail'])
      .where('question_id', '=', q.id)
      .orderBy('id')
      .execute();
    expect(log.map((row) => [row.from_status, row.to_status, row.reason])).toEqual([
      [null, 'DRAFT', 'UNSPECIFIED'],
      ['DRAFT', 'ACTIVE', 'EDITOR_APPROVED'],
      ['ACTIVE', 'REVIEW', 'UNSPECIFIED'],
    ]);
    expect(log[1]).toMatchObject({ actor_account_id: actor, detail: { note: 'ok' } });
    await expect(t.pool.query('UPDATE question_status_log SET reason = $1', ['x'])).rejects.toThrow(
      /append-only/u,
    );
  });
});

describe('player reports', () => {
  it('keeps one report per reporter per question and counts the question once per reporter', async () => {
    const q = await question();
    const insert = (reporter: string, reason = 'WRONG_ANSWER') =>
      t.pool.query(
        `INSERT INTO question_reports (question_id, question_revision, reporter_hash, reason) VALUES ($1, 1, $2, $3)`,
        [q.id, reporter, reason],
      );
    await insert('a');
    await insert('b', 'TYPO');
    await expect(insert('a')).rejects.toThrow(/duplicate key/u);
    const row = await t.db
      .selectFrom('questions')
      .select('report_count')
      .where('id', '=', q.id)
      .executeTakeFirstOrThrow();
    expect(row.report_count).toBe(2);
  });

  it('validates reasons, note length and resolution consistency', async () => {
    const q = await question();
    await expect(
      t.pool.query(
        `INSERT INTO question_reports (question_id, question_revision, reporter_hash, reason) VALUES ($1, 1, 'x', 'ANGRY')`,
        [q.id],
      ),
    ).rejects.toThrow();
    await expect(
      t.pool.query(
        `INSERT INTO question_reports (question_id, question_revision, reporter_hash, reason, note) VALUES ($1, 1, 'y', 'OTHER', $2)`,
        [q.id, 'n'.repeat(301)],
      ),
    ).rejects.toThrow();
    await t.pool.query(
      `INSERT INTO question_reports (question_id, question_revision, reporter_hash, reason) VALUES ($1, 1, 'z', 'OTHER')`,
      [q.id],
    );
    await expect(
      t.pool.query(`UPDATE question_reports SET status = 'DISMISSED' WHERE question_id = $1`, [
        q.id,
      ]),
    ).rejects.toThrow(); // a resolved report needs resolved_at
    await t.pool.query(
      `UPDATE question_reports SET status = 'DISMISSED', resolved_at = now() WHERE question_id = $1`,
      [q.id],
    );
  });
});

describe('feature flags', () => {
  it('start with the documented defaults', async () => {
    const flags = await t.db
      .selectFrom('feature_flags')
      .select(['key', 'enabled', 'public'])
      .execute();
    const byKey = new Map(flags.map((flag) => [flag.key, flag]));
    expect(byKey.get('mode.blind_quiz')).toMatchObject({ enabled: false, public: true });
    expect(byKey.get('auth.email_login')).toMatchObject({ enabled: true, public: true });
    expect(byKey.get('sabotage.noise')).toMatchObject({ enabled: false, public: false });
  });

  it('only accept well-formed keys', async () => {
    for (const key of ['Bad Key', 'x', '1abc', 'a'.repeat(70)]) {
      await expect(
        t.db.insertInto('feature_flags').values({ key }).execute(),
        key,
      ).rejects.toThrow();
    }
  });
});

describe('accounts, roles and sessions', () => {
  it('treats email addresses case-insensitively and rejects unknown roles and statuses', async () => {
    const id = randomUUID();
    await t.db.insertInto('accounts').values({ id, email: 'Eren@Example.com' }).execute();
    await expect(
      t.db.insertInto('accounts').values({ email: 'eren@example.COM' }).execute(),
    ).rejects.toThrow(/duplicate key/u);
    await expect(
      t.pool.query(`INSERT INTO account_roles (account_id, role) VALUES ($1, 'OWNER')`, [id]),
    ).rejects.toThrow();
    await t.pool.query(`INSERT INTO account_roles (account_id, role) VALUES ($1, 'EDITOR')`, [id]);
    await expect(
      t.pool.query(`UPDATE accounts SET status = 'BANNED' WHERE id = $1`, [id]),
    ).rejects.toThrow();
  });

  it('keeps deletion consistent: DELETED needs a timestamp and vice versa', async () => {
    const id = randomUUID();
    await t.db.insertInto('accounts').values({ id, email: 'gone@example.com' }).execute();
    await expect(
      t.pool.query(`UPDATE accounts SET status = 'DELETED' WHERE id = $1`, [id]),
    ).rejects.toThrow();
    await expect(
      t.pool.query(`UPDATE accounts SET deleted_at = now() WHERE id = $1`, [id]),
    ).rejects.toThrow();
    await t.pool.query(
      `UPDATE accounts SET status = 'DELETED', deleted_at = now(), email = NULL WHERE id = $1`,
      [id],
    );
  });

  it('stores hashed session tokens, unique, and removes sessions with the account', async () => {
    const id = randomUUID();
    await t.db.insertInto('accounts').values({ id, email: 'sessions@example.com' }).execute();
    const insert = (hash: string) =>
      t.pool.query(
        `INSERT INTO account_sessions (account_id, token_hash, kind, expires_at) VALUES ($1, $2, 'ADMIN', now() + interval '1 hour')`,
        [id, hash],
      );
    await insert('h1');
    await expect(insert('h1')).rejects.toThrow(/duplicate key/u);
    await expect(
      t.pool.query(
        `INSERT INTO account_sessions (account_id, token_hash, kind, expires_at) VALUES ($1, 'h2', 'TV', now())`,
        [id],
      ),
    ).rejects.toThrow();
    await t.pool.query('DELETE FROM accounts WHERE id = $1', [id]);
    expect(
      (await t.pool.query('SELECT 1 FROM account_sessions WHERE token_hash = $1', ['h1'])).rowCount,
    ).toBe(0);
  });
});

describe('admin audit log', () => {
  it('is append-only: no edits and no deletions', async () => {
    const { rows } = await t.pool.query<{ id: number }>(
      `INSERT INTO admin_audit (action, target_type, target_id) VALUES ('question.approve', 'question', 'q1') RETURNING id`,
    );
    const id = rows[0]!.id;
    await expect(
      t.pool.query(`UPDATE admin_audit SET action = 'x' WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/u);
    await expect(t.pool.query('DELETE FROM admin_audit WHERE id = $1', [id])).rejects.toThrow(
      /append-only/u,
    );
  });
});

describe('bans', () => {
  it('allows one open ban per subject and a new one after the first is lifted', async () => {
    const insert = () =>
      t.pool.query(
        `INSERT INTO bans (kind, subject_hash, reason) VALUES ('DEVICE', 'dev-hash-1', 'harassment')`,
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/u);
    await t.pool.query(`UPDATE bans SET lifted_at = now() WHERE subject_hash = 'dev-hash-1'`);
    await insert();
  });

  it('validates kind and reason', async () => {
    await expect(
      t.pool.query(`INSERT INTO bans (kind, subject_hash, reason) VALUES ('EMAIL', 'x', 'reason')`),
    ).rejects.toThrow();
    await expect(
      t.pool.query(`INSERT INTO bans (kind, subject_hash, reason) VALUES ('IP', 'x', 'a')`),
    ).rejects.toThrow();
  });
});

describe('incidents', () => {
  it('track a lifecycle and touch updated_at', async () => {
    const { rows } = await t.pool.query<{ id: string; updated_at: Date }>(
      `INSERT INTO incidents (title, severity) VALUES ('Veritabanı yavaşladı', 'HIGH') RETURNING id, updated_at`,
    );
    const { id, updated_at: before } = rows[0]!;
    await expect(
      t.pool.query(`UPDATE incidents SET status = 'RESOLVED' WHERE id = $1`, [id]),
    ).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await t.pool.query(
      `UPDATE incidents SET status = 'RESOLVED', resolved_at = now() WHERE id = $1`,
      [id],
    );
    const after = await t.pool.query<{ updated_at: Date }>(
      'SELECT updated_at FROM incidents WHERE id = $1',
      [id],
    );
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(before.getTime());
    await t.pool.query(
      `INSERT INTO incident_notes (incident_id, body) VALUES ($1, 'Kök neden bulundu')`,
      [id],
    );
    await expect(
      t.pool.query(`INSERT INTO incident_notes (incident_id, body) VALUES ($1, '')`, [id]),
    ).rejects.toThrow();
  });
});

describe('one-time codes', () => {
  it('hold hashes only and are looked up newest first', async () => {
    await t.pool.query(
      `INSERT INTO email_otps (email_hash, code_hash, purpose, expires_at) VALUES ('e1', 'c1', 'LOGIN', now() + interval '10 minutes')`,
    );
    await t.pool.query(
      `INSERT INTO email_otps (email_hash, code_hash, purpose, expires_at) VALUES ('e1', 'c2', 'LOGIN', now() + interval '10 minutes')`,
    );
    await expect(
      t.pool.query(
        `INSERT INTO email_otps (email_hash, code_hash, purpose, expires_at) VALUES ('e1', 'c3', 'RESET', now())`,
      ),
    ).rejects.toThrow();
    const { rows } = await t.pool.query<{ code_hash: string }>(
      `SELECT code_hash FROM email_otps WHERE email_hash = 'e1' ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    expect(rows[0]!.code_hash).toBe('c2');
    const columns = await t.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'email_otps'`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(['email', 'code']),
    );
  });
});
