import { translate } from '@quizparty/i18n';
import type { Locale } from '@quizparty/protocol';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/** Delivery port (ADR-0012). The application never knows how mail leaves the building. */
export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

export const OTP_MINUTES = 10;

/** The sign-in code mail. Wording lives in `@quizparty/i18n`, like every other user-visible string. */
export function otpEmail(to: string, code: string, locale: Locale): OutgoingEmail {
  return {
    to,
    subject: translate(locale, 'email.otp.subject', { code }),
    text: translate(locale, 'email.otp.body', { code, minutes: OTP_MINUTES }),
  };
}

/** Development only: writes the mail to the log so a developer can read the code. */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly write: (line: string) => void) {}
  send(email: OutgoingEmail): Promise<void> {
    this.write(`[dev mail] to=${email.to} subject=${email.subject}\n${email.text}`);
    return Promise.resolve();
  }
}

/** Tests: keeps what would have been sent, so a test can read the code like a user would. */
export class MemoryEmailSender implements EmailSender {
  readonly outbox: OutgoingEmail[] = [];
  send(email: OutgoingEmail): Promise<void> {
    this.outbox.push(email);
    return Promise.resolve();
  }
  last(to?: string): OutgoingEmail | undefined {
    return [...this.outbox].reverse().find((mail) => to === undefined || mail.to === to);
  }
  /** The six digits of the most recent mail. */
  lastCode(to?: string): string | null {
    return /\b(\d{6})\b/u.exec(this.last(to)?.subject ?? '')?.[1] ?? null;
  }
}

/**
 * Hands the mail to any transactional-mail service that accepts a JSON POST (most do, directly or
 * through a one-page adapter): `{ to, subject, text }` with a bearer token. SMTP can be added behind
 * the same interface when credentials exist.
 */
export class WebhookEmailSender implements EmailSender {
  constructor(
    private readonly options: {
      url: string;
      token?: string;
      timeoutMs?: number;
      fetch?: typeof fetch;
    },
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const response = await (this.options.fetch ?? fetch)(this.options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
        },
        body: JSON.stringify(email),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`mail service answered ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
