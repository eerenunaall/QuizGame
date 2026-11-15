import { useEffect, useRef } from 'react';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { useI18n } from '../../lib/i18n';
import styles from './TvExit.module.css';

/** "Çıkış": always reachable from the TV (remote focus or Escape/Back) while a room is open. */
export function TvExitButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={styles.exit}
      onClick={onClick}
      data-focusable
      data-testid="tv-exit"
    >
      {t('tv.exit')}
    </button>
  );
}

/** Confirmation before the room is closed for everybody. "No" has the initial focus: a stray OK is safe. */
export function TvExitDialog({
  busy,
  error,
  onYes,
  onNo,
}: {
  busy: boolean;
  error: string | null;
  onYes: () => void;
  onNo: () => void;
}) {
  const { t } = useI18n();
  const noRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    noRef.current?.focus();
  }, []);
  return (
    <div className={styles.scrim}>
      <Panel className={styles.panel} role="dialog" aria-modal="true" data-testid="tv-exit-dialog">
        <h2 className={styles.question}>{t('tv.exit.confirm')}</h2>
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.actions}>
          <Button size="xl" variant="danger" onClick={onYes} busy={busy} data-testid="tv-exit-yes">
            {t('tv.exit.yes')}
          </Button>
          <Button ref={noRef} size="xl" onClick={onNo} data-testid="tv-exit-no">
            {t('tv.exit.no')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
