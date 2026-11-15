import { useRef, useState } from 'react';
import { AccountApiError } from '../../lib/account';
import { useI18n } from '../../lib/i18n';
import { ACCEPTED_IMAGE_TYPES, MAX_ASSET_BYTES, assetUrl, assetsApi } from '../assetsApi';
import styles from './quiznight.module.css';

const OWN_PICTURE = /^\/v1\/venue-assets\/[0-9a-f-]{36}\/[0-9a-f]{64}$/u;

/**
 * The picture of a quiz night question (picture rounds). It is uploaded to the venue's own store and the
 * question keeps its same-origin address: the web app's CSP allows no outside images, and an outside address
 * would also tell a third party who is looking. The server parses the whole file again (ADR-0030 §4).
 */
export function PictureField({
  venueId,
  value,
  onChange,
  testId,
}: {
  venueId: string;
  value: string | undefined;
  onChange: (url: string | undefined) => void;
  testId: string;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = value !== undefined && OWN_PICTURE.test(value);

  const reason = (cause: unknown): string => {
    if (!(cause instanceof AccountApiError)) return t('panel.logo.err.generic');
    if (cause.code === 'LIMIT_REACHED') return t('qn.picture.err.full');
    if (cause.code === 'RATE_LIMITED') return t('staff.error.throttled');
    if (cause.code === 'IMAGE_REJECTED')
      return cause.params?.reason === 'SIZE'
        ? t('panel.logo.err.size')
        : cause.params?.reason === 'DIMENSIONS'
          ? t('qn.picture.err.dimensions')
          : t('panel.logo.err.format');
    return t('panel.logo.err.generic');
  };

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
      const { asset } = await assetsApi.upload(
        venueId,
        'PICTURE',
        new Uint8Array(await file.arrayBuffer()),
      );
      onChange(assetUrl(venueId, asset.hash));
    } catch (cause) {
      setError(reason(cause));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className={styles.field} data-testid={testId}>
      <span>{t('qn.picture.label')}</span>
      {value && own ? (
        <img className={styles.pictureThumb} src={value} alt="" data-testid={`${testId}-img`} />
      ) : null}
      {value && !own ? (
        <p className={styles.error} data-testid={`${testId}-external`}>
          {t('qn.picture.external')}
        </p>
      ) : null}
      <div className={styles.row}>
        <button
          type="button"
          className={styles.mini}
          disabled={busy}
          onClick={() => input.current?.click()}
          data-testid={`${testId}-choose`}
        >
          {busy
            ? t('panel.logo.uploading')
            : value
              ? t('panel.logo.replace')
              : t('panel.logo.choose')}
        </button>
        {value ? (
          <button
            type="button"
            className={styles.mini}
            disabled={busy}
            onClick={() => onChange(undefined)}
            data-testid={`${testId}-remove`}
          >
            {t('panel.logo.remove')}
          </button>
        ) : null}
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          hidden
          onChange={(event) => void pick(event.target.files?.[0])}
          data-testid={`${testId}-file`}
        />
      </div>
      <small className={styles.muted}>{t('qn.picture.hint')}</small>
      {error ? (
        <p className={styles.error} role="alert" data-testid={`${testId}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
