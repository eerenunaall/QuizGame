import { useRef, useState } from 'react';
import type { TeamId } from '@quizparty/protocol';
import { AccountApiError } from '../lib/account';
import { useI18n } from '../lib/i18n';
import { TeamMark } from '../ui/TeamMark';
import { ACCEPTED_IMAGE_TYPES, assetUrl, assetsApi, MAX_ASSET_BYTES } from './assetsApi';
import { usePanel } from './PanelStore';
import styles from './StaffPage.module.css';

/**
 * Picks and uploads one image (the venue logo or a team mark) and tells the form its hash. The checks
 * here are only for a quick, friendly answer; the server parses the whole file again (ADR-0030 §4).
 */
export function LogoField({
  kind,
  label,
  hint,
  hash,
  onChange,
  testId,
  compact = false,
  teamId,
}: {
  kind: 'LOGO' | 'TEAM';
  label: string;
  hint: string;
  hash: string | null;
  onChange: (hash: string | null) => void;
  testId: string;
  compact?: boolean;
  teamId?: TeamId;
}) {
  const { t } = useI18n();
  const { venueId } = usePanel();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setError(null);
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setError(t('panel.logo.err.format'));
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setError(t('panel.logo.err.size'));
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { asset } = await assetsApi.upload(venueId, kind, bytes);
      onChange(asset.hash);
    } catch (cause) {
      setError(reason(cause));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const reason = (cause: unknown): string => {
    if (!(cause instanceof AccountApiError)) return t('panel.logo.err.generic');
    switch (cause.code) {
      case 'LIMIT_REACHED':
        return t('panel.logo.err.limit');
      case 'RATE_LIMITED':
        return t('staff.error.throttled');
      case 'PAYLOAD_TOO_LARGE':
        return t('panel.logo.err.size');
      case 'UNSUPPORTED_IMAGE':
        return t('panel.logo.err.format');
      case 'BAD_IMAGE_SIZE':
        return t('panel.logo.err.dimensions');
      default:
        return t('panel.logo.err.generic');
    }
  };

  const url = hash ? assetUrl(venueId, hash) : null;
  return (
    <div className={compact ? styles.logoCompact : styles.logoField} data-testid={testId}>
      {compact ? null : <div className={styles.label}>{label}</div>}
      <div className={styles.logoRow}>
        <div className={styles.logoThumb}>
          {url ? (
            kind === 'TEAM' && teamId ? (
              <TeamMark teamId={teamId} size={56} logo={url} />
            ) : (
              <img src={url} alt={label} data-testid={`${testId}-img`} />
            )
          ) : kind === 'TEAM' && teamId ? (
            <TeamMark teamId={teamId} size={56} logo={null} />
          ) : (
            <span className={styles.logoNone}>{t('panel.logo.none')}</span>
          )}
        </div>
        <div className={styles.logoActions}>
          <button
            type="button"
            className={styles.smallButton}
            disabled={busy}
            onClick={() => input.current?.click()}
            data-testid={`${testId}-choose`}
          >
            {busy
              ? t('panel.logo.uploading')
              : hash
                ? t('panel.logo.replace')
                : t('panel.logo.choose')}
          </button>
          {hash ? (
            <button
              type="button"
              className={styles.smallButton}
              disabled={busy}
              onClick={() => onChange(null)}
              data-testid={`${testId}-remove`}
            >
              {t('panel.logo.remove')}
            </button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          hidden
          onChange={(event) => void pick(event.target.files?.[0])}
          data-testid={`${testId}-file`}
        />
      </div>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {error ? (
        <p className={styles.fieldError} role="alert" data-testid={`${testId}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
