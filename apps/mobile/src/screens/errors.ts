import type { I18n } from '../ui/i18n';

/** Maps an API / store failure to local copy; server text is never shown (PROTOCOL.md). */
export function describeFailure(i18n: Pick<I18n, 'td' | 't'>, cause: unknown): string {
  const code = (cause as { code?: string } | undefined)?.code;
  switch (code) {
    case 'PURCHASE_CANCELLED':
      return i18n.t('m.purchase.cancelled');
    case 'PURCHASE_PENDING':
      return i18n.t('m.purchase.pending');
    case 'STORE_UNAVAILABLE':
      return i18n.t('m.purchase.unavailable');
    case 'NETWORK':
      return i18n.t('m.purchase.failed');
    case undefined:
      return i18n.td('error.INTERNAL');
    default:
      return i18n.td(`error.${code}`);
  }
}

/** Sign-in specific copy (the existing `unlock.*` strings are the same flow as the web page). */
export function describeSignInFailure(i18n: Pick<I18n, 't' | 'td'>, cause: unknown): string {
  const code = (cause as { code?: string } | undefined)?.code;
  if (code === 'UNAUTHORIZED') return i18n.t('unlock.refused');
  if (code === 'RATE_LIMITED') return i18n.t('unlock.throttled');
  if (code === 'FEATURE_DISABLED') return i18n.t('unlock.disabled');
  return describeFailure(i18n, cause);
}

/** Join failures: a nickname problem names its reason, everything else is the plain error copy. */
export function describeJoinFailure(i18n: Pick<I18n, 'td' | 't'>, cause: unknown): string {
  const failure = cause as { code?: string; params?: { reason?: string | number } } | undefined;
  if (failure?.code === 'NICKNAME_INVALID' && failure.params?.reason !== undefined)
    return i18n.td(`nickname.reason.${String(failure.params.reason)}`);
  return describeFailure(i18n, cause);
}
