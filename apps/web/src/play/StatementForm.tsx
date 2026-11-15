import { useEffect, useState } from 'react';
import { MAX_STATEMENT_LENGTH } from '@quizparty/protocol/constants';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { useI18n } from '../lib/i18n';
import styles from './StatementForm.module.css';

interface Props {
  /** The words the server holds for this player, if any (so a reload shows them again). */
  saved: string | null;
  /** Resolves when accepted; rejects with the client's request error (`TEXT_REJECTED` carries a `reason`). */
  onSubmit: (text: string) => Promise<void>;
}

/** Who Said It, lobby: one short statement per player, editable until the game starts. */
export function StatementForm({ saved, onSubmit }: Props) {
  const { t, td } = useI18n();
  const [text, setText] = useState(saved ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(saved !== null);

  // A reload or a reconnect brings the stored words back into an untouched form.
  useEffect(() => {
    if (saved !== null) {
      setText((current) => (current === '' ? saved : current));
      setSent(true);
    }
  }, [saved]);

  const send = (): void => {
    setBusy(true);
    setProblem(null);
    onSubmit(text.trim())
      .then(() => setSent(true))
      .catch((cause: { code?: string; params?: Record<string, string | number> }) => {
        setSent(false);
        if (cause.code === 'TEXT_REJECTED' && cause.params?.reason)
          setProblem(td(`ctl.statement.reason.${String(cause.params.reason)}`));
        else if (cause.code === 'RATE_LIMITED') setProblem(t('ctl.statement.rateLimited'));
        else setProblem(td(`error.${cause.code ?? 'INTERNAL'}`));
      })
      .finally(() => setBusy(false));
  };

  return (
    <Panel className={styles.form} tone="glass" data-testid="ctl-statement">
      <div className={styles.title}>{t('ctl.statement.title')}</div>
      <div className={styles.hint}>{t('ctl.statement.hint')}</div>
      <textarea
        className={styles.input}
        value={text}
        rows={3}
        maxLength={MAX_STATEMENT_LENGTH}
        placeholder={t('ctl.statement.placeholder')}
        onChange={(event) => {
          setText(event.target.value);
          setSent(false);
        }}
        data-testid="ctl-statement-input"
      />
      <div className={styles.row}>
        <span className={styles.count}>
          {text.length}/{MAX_STATEMENT_LENGTH}
        </span>
        <Button
          size="md"
          variant="violet"
          busy={busy}
          disabled={text.trim().length === 0 || sent}
          onClick={send}
          data-testid="ctl-statement-send"
        >
          {saved !== null ? t('ctl.statement.update') : t('ctl.statement.send')}
        </Button>
      </div>
      {problem ? (
        <div className={styles.problem} role="alert" data-testid="ctl-statement-problem">
          {problem}
        </div>
      ) : sent ? (
        <div className={styles.ok} role="status" data-testid="ctl-statement-sent">
          {t('ctl.statement.sent')}
        </div>
      ) : null}
    </Panel>
  );
}
