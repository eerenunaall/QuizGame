import { randomInt } from 'node:crypto';
import type { Database } from '@quizparty/db';
import type { Locale } from '@quizparty/protocol';
import { hmacHex, safeEqualHex } from '../security/crypto';
import type { Clock } from '../util/clock';
import { OTP_MINUTES, otpEmail, type EmailSender } from './email';

/** ADR-0012: 6 digits, 10 minutes, 5 attempts per code, 30 s between codes. */
export const OTP_TTL_MS = OTP_MINUTES * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 30_000;
/** Codes one address may ask for per hour, however many networks the asker uses. */
export const OTP_MAX_PER_HOUR = 5;

const EMAIL_RE =
  /^[^\s@<>()[\],;:\\"]{1,64}@[^\s@<>()[\],;:\\"]{1,190}\.[^\s@<>()[\],;:\\"]{2,63}$/u;

/** Trimmed, lower-cased, length- and shape-checked; null when it cannot be an address. */
export function normalizeEmail(input: string): string | null {
  const email = input.normalize('NFKC').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  // eslint-disable-next-line no-control-regex -- control characters never belong in an address
  if (/[\u0000-\u001f\u007f]/u.test(email)) return null;
  return email;
}

export type OtpRequestResult = 'SENT' | 'THROTTLED';
export type OtpVerifyResult = { ok: true; email: string } | { ok: false };

/**
 * Email one-time codes (ADR-0012). Only keyed hashes are stored: a leaked table reveals neither the
 * addresses nor the codes. Every outcome a stranger can observe is the same whether or not the
 * address has an account, and a wrong, expired, used or never-issued code looks identical.
 */
export class OtpService {
  constructor(
    private readonly db: Database,
    private readonly secret: string,
    private readonly clock: Clock,
    private readonly sender: EmailSender,
    private readonly onError: (error: unknown) => void,
  ) {}

  private emailHash(email: string): string {
    return hmacHex(this.secret, 'otp-email', email);
  }

  private codeHash(emailHash: string, code: string): string {
    return hmacHex(this.secret, `otp-code:${emailHash}`, code);
  }

  /** Account deletion: no code issued for this address stays behind. */
  async forget(email: string): Promise<void> {
    await this.db
      .deleteFrom('email_otps')
      .where('email_hash', '=', this.emailHash(email))
      .execute();
  }

  async request(email: string, ipHash: string, locale: Locale): Promise<OtpRequestResult> {
    const emailHash = this.emailHash(email);
    const now = this.clock.now();
    const recent = await this.db
      .selectFrom('email_otps')
      .select(['created_at'])
      .where('email_hash', '=', emailHash)
      .where('created_at', '>', new Date(now - 3_600_000))
      .orderBy('created_at', 'desc')
      .execute();
    const newest = recent[0]?.created_at.getTime();
    if (recent.length >= OTP_MAX_PER_HOUR) return 'THROTTLED';
    if (newest !== undefined && now - newest < OTP_RESEND_COOLDOWN_MS) return 'THROTTLED';

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db
      .insertInto('email_otps')
      .values({
        email_hash: emailHash,
        code_hash: this.codeHash(emailHash, code),
        purpose: 'LOGIN',
        // Stamped by the injected clock, not the database's, so every comparison above uses one time source.
        created_at: new Date(now),
        expires_at: new Date(now + OTP_TTL_MS),
        ip_hash: ipHash,
      })
      .execute();
    // Delivery never delays or changes the answer: nobody can time their way to "this address exists".
    void this.sender.send(otpEmail(email, code, locale)).catch(this.onError);
    return 'SENT';
  }

  async verify(email: string, code: string): Promise<OtpVerifyResult> {
    const emailHash = this.emailHash(email);
    const now = this.clock.now();
    return this.db.transaction().execute(async (trx): Promise<OtpVerifyResult> => {
      const row = await trx
        .selectFrom('email_otps')
        .select(['id', 'code_hash', 'attempts'])
        .where('email_hash', '=', emailHash)
        .where('consumed_at', 'is', null)
        .where('expires_at', '>', new Date(now))
        .orderBy('created_at', 'desc')
        .limit(1)
        .forUpdate()
        .executeTakeFirst();
      const presented = this.codeHash(emailHash, code);
      if (!row || row.attempts >= OTP_MAX_ATTEMPTS) {
        // Same work, same answer: a missing code is indistinguishable from a wrong one.
        safeEqualHex(presented, this.codeHash(emailHash, '000000'));
        return { ok: false };
      }
      if (!safeEqualHex(presented, row.code_hash)) {
        await trx
          .updateTable('email_otps')
          .set({ attempts: row.attempts + 1 })
          .where('id', '=', row.id)
          .execute();
        return { ok: false };
      }
      await trx
        .updateTable('email_otps')
        .set({ consumed_at: new Date(now) })
        .where('id', '=', row.id)
        .execute();
      return { ok: true, email };
    });
  }

  /** Housekeeping: codes are useless after a day. */
  async purge(): Promise<number> {
    const result = await this.db
      .deleteFrom('email_otps')
      .where('created_at', '<', new Date(this.clock.now() - 86_400_000))
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}
