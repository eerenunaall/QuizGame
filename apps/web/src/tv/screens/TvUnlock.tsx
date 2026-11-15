import { useEffect, useRef } from 'react';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { QrCode } from '../../ui/QrCode';
import { useI18n } from '../../lib/i18n';
import styles from './TvUnlock.module.css';

interface Props {
  /** The one-time link to show as a QR code; null while it is being fetched. */
  link: string | null;
  /** True once the server has unlocked this room (the dialog celebrates, then the lobby takes over). */
  unlocked: boolean;
  error: string | null;
  onNewCode: () => void;
  onClose: () => void;
}

/** "Tam oyunu aç": a QR code for the phone of whoever owns the full game (ADR-0013 flow A). */
export function TvUnlock({ link, unlocked, error, onNewCode, onClose }: Props) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div className={styles.scrim}>
      <Panel className={styles.panel} role="dialog" aria-modal="true" data-testid="tv-unlock">
        <h2 className={styles.title}>{unlocked ? t('tv.unlock.done') : t('tv.unlock.title')}</h2>
        {unlocked ? null : (
          <div className={styles.body}>
            <div className={styles.qr} data-testid="unlock-qr">
              {link ? (
                <QrCode value={link} size={420} label={t('tv.unlock.title')} />
              ) : (
                <span className={styles.loading}>{t('tv.unlock.loading')}</span>
              )}
            </div>
            <ol className={styles.steps}>
              <li>{t('tv.unlock.step1')}</li>
              <li>{t('tv.unlock.step2')}</li>
              <li>{t('tv.unlock.step3')}</li>
              <li className={styles.fine}>{t('tv.unlock.expires')}</li>
            </ol>
          </div>
        )}
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.actions}>
          {unlocked ? null : (
            <Button variant="violet" size="lg" onClick={onNewCode} data-testid="unlock-new">
              {t('tv.unlock.newCode')}
            </Button>
          )}
          <Button ref={closeRef} size="lg" onClick={onClose} data-testid="unlock-close">
            {t('common.close')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
