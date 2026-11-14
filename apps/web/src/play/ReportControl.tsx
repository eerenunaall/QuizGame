import { useState } from 'react';
import { QUESTION_REPORT_REASONS } from '@quizparty/protocol/constants';
import type { QuestionReportReason } from '@quizparty/protocol';
import { useI18n } from '../lib/i18n';
import styles from './Controller.module.css';

/** "Report question": one tap to open the reasons, one tap to send. No free text, ever. */
export function ReportControl({
  questionId,
  report,
}: {
  questionId: string;
  report: (questionId: string, reason: QuestionReportReason) => Promise<void>;
}) {
  const { t, td } = useI18n();
  const [step, setStep] = useState<'closed' | 'choosing' | 'sending' | 'sent' | 'failed'>('closed');
  const [failure, setFailure] = useState('');
  const send = (reason: QuestionReportReason): void => {
    setStep('sending');
    report(questionId, reason).then(
      () => setStep('sent'),
      (cause: unknown) => {
        setFailure(td(`error.${(cause as { code?: string } | null)?.code ?? 'INTERNAL'}`));
        setStep('failed');
      },
    );
  };
  if (step === 'sent')
    return (
      <div className={styles.reportThanks} data-testid="ctl-report-sent" role="status">
        {t('report.thanks')}
      </div>
    );
  if (step === 'closed')
    return (
      <button
        type="button"
        className={styles.reportLink}
        data-testid="ctl-report-open"
        data-focusable
        onClick={() => setStep('choosing')}
      >
        {t('report.open')}
      </button>
    );
  return (
    <div
      className={styles.reportSheet}
      data-testid="ctl-report-sheet"
      role="group"
      aria-label={t('report.title')}
    >
      <div className={styles.kicker}>{t('report.title')}</div>
      <div className={styles.reportChips}>
        {QUESTION_REPORT_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            className={styles.reportChip}
            data-testid={`ctl-report-${reason}`}
            data-focusable
            disabled={step === 'sending'}
            onClick={() => send(reason)}
          >
            {t(`report.reason.${reason}`)}
          </button>
        ))}
      </div>
      {step === 'failed' ? (
        <div className={styles.error} role="alert">
          {failure}
        </div>
      ) : null}
    </div>
  );
}
