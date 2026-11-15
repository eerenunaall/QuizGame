import { randomUUID } from 'node:crypto';
import type { EmailSender, OutgoingEmail } from './email';

/**
 * Production sender for sign-in codes: one HTTPS call to a transactional-mail API (ADR-0012).
 * Two providers are supported because both have a free tier and a single JSON endpoint:
 * Resend (default recommendation, docs/DEPLOYMENT.md section 5) and Brevo.
 *
 * Secrecy: the mail body is the sign-in code. Nothing here logs it, and errors carry only the
 * provider name, the HTTP status and the provider's short error label (never the body, the address
 * or the key), because the caller hands errors to the logger.
 */
export type EmailProvider = 'resend' | 'brevo';

export const PROVIDER_BASES: Record<EmailProvider, string> = {
  resend: 'https://api.resend.com',
  brevo: 'https://api.brevo.com',
};

export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

export interface HttpEmailOptions {
  provider: EmailProvider;
  apiKey: string;
  /** `address` or `Name <address>`. */
  from: string;
  /** Tests only (production config refuses it): where the provider's API lives. */
  apiBase?: string;
  timeoutMs?: number;
  /** Attempts per mail, first one included. */
  maxAttempts?: number;
  backoffMs?: number;
  /** Consecutive failed mails before the breaker opens, and how long it stays open. */
  breakerThreshold?: number;
  breakerOpenMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  newKey?: () => string;
}

/** `Name <a@b.c>` or bare address -> parts. Null when it cannot be an address. */
export function parseFrom(from: string): { name: string | null; email: string } | null {
  const match = /^\s*(?:"?([^"<>]*?)"?\s*)?<([^<>\s]+@[^<>\s]+\.[^<>\s]+)>\s*$/u.exec(from);
  if (match) return { name: match[1]?.trim() || null, email: match[2]! };
  const bare = from.trim();
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(bare) ? { name: null, email: bare } : null;
}

export class HttpEmailSender implements EmailSender {
  private failures = 0;
  private openUntil = 0;
  private readonly from: { name: string | null; email: string };

  constructor(private readonly o: HttpEmailOptions) {
    const from = parseFrom(o.from);
    if (!from) throw new Error('Invalid configuration: EMAIL_FROM is not an email address');
    this.from = from;
  }

  private get now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** True while the breaker refuses calls (a provider outage must not pile up sockets). */
  get breakerOpen(): boolean {
    return this.now < this.openUntil;
  }

  async send(email: OutgoingEmail): Promise<void> {
    if (this.breakerOpen)
      throw new EmailDeliveryError(`${this.o.provider} circuit open, mail not sent`, false);
    const attempts = this.o.maxAttempts ?? 3;
    // One key for all attempts: where the provider honours it, a retry after a lost answer cannot send twice.
    const key = (this.o.newKey ?? randomUUID)();
    let last: EmailDeliveryError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.once(email, key);
        this.failures = 0;
        return;
      } catch (error) {
        last =
          error instanceof EmailDeliveryError
            ? error
            : new EmailDeliveryError(`${this.o.provider} request failed`, true);
        if (!last.retryable || attempt === attempts) break;
        await (this.o.sleep ?? defaultSleep)((this.o.backoffMs ?? 400) * 2 ** (attempt - 1));
      }
    }
    // Only service trouble counts toward the breaker; a 4xx (bad key, bad sender) fails fast per mail.
    if (last?.retryable && ++this.failures >= (this.o.breakerThreshold ?? 5)) {
      this.openUntil = this.now + (this.o.breakerOpenMs ?? 60_000);
      this.failures = 0;
    }
    throw last ?? new EmailDeliveryError(`${this.o.provider} request failed`, true);
  }

  private request(email: OutgoingEmail, key: string): { url: string; init: RequestInit } {
    const base = (this.o.apiBase ?? PROVIDER_BASES[this.o.provider]).replace(/\/+$/u, '');
    if (this.o.provider === 'resend') {
      const from = this.from.name ? `${this.from.name} <${this.from.email}>` : this.from.email;
      return {
        url: `${base}/emails`,
        init: {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.o.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': key,
          },
          body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text }),
        },
      };
    }
    return {
      url: `${base}/v3/smtp/email`,
      init: {
        method: 'POST',
        headers: {
          'api-key': this.o.apiKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { ...(this.from.name ? { name: this.from.name } : {}), email: this.from.email },
          to: [{ email: email.to }],
          subject: email.subject,
          textContent: email.text,
        }),
      },
    };
  }

  private async once(email: OutgoingEmail, key: string): Promise<void> {
    const { url, init } = this.request(email, key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.o.timeoutMs ?? 8_000);
    try {
      const response = await (this.o.fetch ?? fetch)(url, {
        ...init,
        signal: controller.signal,
        redirect: 'error', // a redirect would carry the key to another host
      });
      if (response.ok) return;
      const label = await errorLabel(response);
      const status = response.status;
      throw new EmailDeliveryError(
        `${this.o.provider} answered ${status}${label ? ` (${label})` : ''}`,
        status === 408 || status === 425 || status === 429 || status >= 500,
      );
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      // Abort, DNS, TLS, reset: the message may name the host but never carries the key or body.
      throw new EmailDeliveryError(`${this.o.provider} unreachable`, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The provider's short machine label (`name` for Resend, `code` for Brevo), restricted to a safe alphabet. */
async function errorLabel(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { name?: unknown; code?: unknown };
    const raw =
      typeof body.name === 'string' ? body.name : typeof body.code === 'string' ? body.code : '';
    return /^[A-Za-z0-9_.-]{1,60}$/u.test(raw) ? raw : '';
  } catch {
    return '';
  }
}
