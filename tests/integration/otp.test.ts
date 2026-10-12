import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  OtpService,
  normalizeEmail,
} from '../../apps/realtime/src/auth/otp';

/** ADR-0012: 6 digits, 10 minutes, 5 attempts per code, 30 s between codes, 5 codes an hour. */
let t: TestDatabase;
let now = Date.UTC(2026, 9, 6, 12);
const clock = { now: () => now };
const mailbox = new MemoryEmailSender();
const errors: unknown[] = [];
let otp: OtpService;

beforeAll(async () => {
  t = await createTestDatabase();
  otp = new OtpService(t.db, 'unit-test-secret-unit-test-secret', clock, mailbox, (e) =>
    errors.push(e),
  );
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await sql`TRUNCATE email_otps`.execute(t.db);
  mailbox.outbox.length = 0;
  now += 2 * 3_600_000; // every test starts outside the previous test's hourly window
});

const ask = async (email = 'eren@example.com') => otp.request(email, 'ip-1', 'tr');
const flush = () => new Promise((resolve) => setTimeout(resolve, 20)); // mail goes out after the answer

describe('normalising addresses', () => {
  it.each([
    ['  Eren@Example.COM ', 'eren@example.com'],
    ['ｅｒｅｎ@example.com', 'eren@example.com'], // full-width letters fold to the same address
    ['a.b+tag@sub.example.co.uk', 'a.b+tag@sub.example.co.uk'],
  ])('reads %j as %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each([
    '',
    'nobody',
    'a@b',
    'a b@example.com',
    'a@exa mple.com',
    '<x>@example.com',
    'a@@example.com',
    'x@y.z',
    `${'a'.repeat(65)}@example.com`,
    `a@${'b'.repeat(200)}.com`,
    'a\u0000@example.com',
    'a@example.com\nbcc:evil@example.com',
  ])('refuses %j', (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });
});

describe('asking for a code', () => {
  it("sends six digits to the address, in the asker's language", async () => {
    expect(await otp.request('eren@example.com', 'ip-1', 'en')).toBe('SENT');
    await flush();
    const mail = mailbox.last('eren@example.com')!;
    expect(mail.subject).toMatch(/^Your Quiz Party sign-in code: \d{6}$/u);
    expect(mail.text).toContain('10 minutes');
    expect(mailbox.lastCode()).toMatch(/^\d{6}$/u);
    const tr = new MemoryEmailSender();
    await new OtpService(
      t.db,
      'unit-test-secret-unit-test-secret',
      clock,
      tr,
      () => undefined,
    ).request('ece@example.com', 'ip', 'tr');
    await flush();
    expect(tr.last()!.subject).toMatch(/^Quiz Party giriş kodun: \d{6}$/u);
  });

  it('stores only keyed hashes: no address, no code', async () => {
    await ask();
    await flush();
    const code = mailbox.lastCode()!;
    const rows = await t.db.selectFrom('email_otps').selectAll().execute();
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('eren@example.com');
    expect(dump).not.toContain(code);
    expect(rows[0]!.email_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(rows[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('makes the asker wait 30 seconds between codes and allows five an hour', async () => {
    expect(await ask()).toBe('SENT');
    expect(await ask()).toBe('THROTTLED');
    now += OTP_RESEND_COOLDOWN_MS - 1;
    expect(await ask()).toBe('THROTTLED');
    now += 1;
    expect(await ask()).toBe('SENT');
    for (let i = 0; i < OTP_MAX_PER_HOUR - 2; i++) {
      now += OTP_RESEND_COOLDOWN_MS;
      expect(await ask()).toBe('SENT');
    }
    now += OTP_RESEND_COOLDOWN_MS;
    expect(await ask()).toBe('THROTTLED'); // the sixth within the hour
    await flush();
    expect(mailbox.outbox).toHaveLength(OTP_MAX_PER_HOUR);
    now += 3_600_000;
    expect(await ask()).toBe('SENT');
  });

  it('counts each address on its own', async () => {
    expect(await ask('a@example.com')).toBe('SENT');
    expect(await ask('b@example.com')).toBe('SENT');
  });

  it('survives a mail service that fails: the answer is the same and the failure is reported', async () => {
    const failing = new OtpService(
      t.db,
      'unit-test-secret-unit-test-secret',
      clock,
      { send: () => Promise.reject(new Error('mail down')) },
      (e) => errors.push(e),
    );
    expect(await failing.request('x@example.com', 'ip', 'tr')).toBe('SENT');
    await flush();
    expect(errors.at(-1)).toMatchObject({ message: 'mail down' });
  });
});

describe('trying a code', () => {
  it('accepts the right code once', async () => {
    await ask();
    await flush();
    const code = mailbox.lastCode()!;
    expect(await otp.verify('eren@example.com', code)).toEqual({
      ok: true,
      email: 'eren@example.com',
    });
    expect(await otp.verify('eren@example.com', code)).toEqual({ ok: false });
  });

  it('refuses a wrong, never-issued or malformed code in exactly the same way', async () => {
    await ask();
    const outcomes = [
      await otp.verify('eren@example.com', '000000'),
      await otp.verify('nobody@example.com', '123456'),
      await otp.verify('eren@example.com', 'abcdef'),
    ];
    expect(outcomes).toEqual([{ ok: false }, { ok: false }, { ok: false }]);
  });

  it('gives a code five attempts and then kills it, even for the right answer', async () => {
    await ask();
    await flush();
    const code = mailbox.lastCode()!;
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++)
      expect(await otp.verify('eren@example.com', wrong)).toEqual({ ok: false });
    expect(await otp.verify('eren@example.com', code)).toEqual({ ok: false });
  });

  it('cannot be brute-forced in parallel: attempts are counted under a lock', async () => {
    await ask();
    await flush();
    const code = mailbox.lastCode()!;
    const guesses = Array.from({ length: 60 }, (_, i) => String(i).padStart(6, '0')).filter(
      (g) => g !== code,
    );
    await Promise.all(guesses.map((guess) => otp.verify('eren@example.com', guess)));
    const row = await t.db.selectFrom('email_otps').select('attempts').executeTakeFirstOrThrow();
    expect(row.attempts).toBe(OTP_MAX_ATTEMPTS);
    expect(await otp.verify('eren@example.com', code)).toEqual({ ok: false });
  });

  it('expires after ten minutes', async () => {
    await ask();
    await flush();
    const code = mailbox.lastCode()!;
    now += OTP_TTL_MS;
    expect(await otp.verify('eren@example.com', code)).toEqual({ ok: false });
  });

  it('only the newest code counts', async () => {
    await ask();
    await flush();
    const first = mailbox.lastCode()!;
    now += OTP_RESEND_COOLDOWN_MS;
    await ask();
    await flush();
    const second = mailbox.lastCode()!;
    if (first !== second)
      expect(await otp.verify('eren@example.com', first)).toEqual({ ok: false });
    expect(await otp.verify('eren@example.com', second)).toEqual({
      ok: true,
      email: 'eren@example.com',
    });
  });

  it('a code for one address does not open another', async () => {
    await ask('a@example.com');
    await flush();
    const code = mailbox.lastCode('a@example.com')!;
    expect(await otp.verify('b@example.com', code)).toEqual({ ok: false });
  });

  it('forgets codes after a day', async () => {
    await ask();
    now += 25 * 3_600_000;
    expect(await otp.purge()).toBe(1);
  });
});
