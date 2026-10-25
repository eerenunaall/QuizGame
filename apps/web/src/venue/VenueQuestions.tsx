import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { AccountApiError } from '../lib/account';
import { useI18n } from '../lib/i18n';
import { type StaffRole } from './api';
import {
  questionsApi,
  type Analysis,
  type Report,
  type ReportItem,
  type RowReport,
  type SetSummary,
  type VenueIssue,
} from './questionsApi';
import staff from './StaffPage.module.css';
import styles from './VenueQuestions.module.css';

type Source = 'MIXED' | 'VENUE_ONLY' | 'GLOBAL_ONLY';

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * The "Sorular" tab (ADR-0025): the owner uploads a question file, reads the dry-run in plain Turkish,
 * imports, removes an upload, exports the set and answers player reports. Staff see the counts only.
 * Question text is always rendered as a text node: React escapes it, nothing here sets HTML.
 */
export function VenueQuestions({ venueId, role }: { venueId: string; role: StaffRole }) {
  const { t, td } = useI18n();
  const [summary, setSummary] = useState<SetSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refusal = useCallback(
    (error: unknown): string => {
      if (error instanceof AccountApiError) {
        if (error.code === 'RATE_LIMITED') return t('vq.error.throttled');
        if (error.code === 'FORBIDDEN') return t('vq.error.forbidden');
        if (error.code === 'LIMIT_REACHED') return t('vq.error.limit');
      }
      return t('vq.error.generic');
    },
    [t],
  );
  const load = useCallback(() => {
    questionsApi.summary(venueId).then(setSummary, (error: unknown) => setMessage(refusal(error)));
  }, [venueId, refusal]);
  useEffect(load, [load]);

  const issueText = (issue: VenueIssue): string =>
    td(`venue.issue.${issue.code}`, {
      field: issue.field,
      ...issue.params,
    });
  const when = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  if (!summary) return <p>{message ?? '…'}</p>;
  const owner = role === 'OWNER' && summary.canManage;
  return (
    <div data-testid="vq">
      <p className={staff.hint}>{t('vq.intro')}</p>
      <div className={staff.message} role="alert" data-testid="vq-error">
        {message ?? ''}
      </div>
      <p data-testid="vq-totals">{t('vq.totals', summary.totals)}</p>
      {!owner ? <p className={staff.hint}>{t('vq.staffOnly')}</p> : null}

      {summary.categories.length > 0 ? (
        <>
          <h2 className={staff.subtitle}>{t('vq.categories')}</h2>
          <ul className={styles.counts} data-testid="vq-categories">
            {summary.categories.map((category) => (
              <li key={category.id} className={styles.count}>
                {t('vq.report.byCategory', { label: category.label, count: category.active })}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>{t('vq.empty')}</p>
      )}

      {owner ? (
        <Upload
          venueId={venueId}
          issueText={issueText}
          when={when}
          onImported={load}
          onError={(error) => setMessage(refusal(error))}
        />
      ) : null}

      <h2 className={staff.subtitle}>{t('vq.uploads')}</h2>
      <div data-testid="vq-uploads">
        {summary.uploads.map((upload) => (
          <div key={upload.id} className={styles.upload}>
            <span>
              {t('vq.upload.line', {
                name: upload.fileName,
                imported: upload.rowsImported,
                when: when(upload.uploadedAt),
              })}
              {' · '}
              {upload.state === 'RETIRED'
                ? t('vq.upload.retired')
                : t('vq.upload.active', { count: upload.active })}
            </span>
            {owner && upload.state === 'ACTIVE' ? (
              <Button
                size="md"
                variant="danger"
                onClick={() => {
                  if (confirmRemove !== upload.id) return setConfirmRemove(upload.id);
                  setConfirmRemove(null);
                  questionsApi.retire(venueId, upload.id).then(
                    (result) => {
                      setMessage(t('vq.upload.removed', { count: result.retired }));
                      load();
                    },
                    (error: unknown) => setMessage(refusal(error)),
                  );
                }}
                data-testid={`vq-remove-${upload.fileName}`}
              >
                {confirmRemove === upload.id
                  ? t('vq.upload.removeConfirm', { count: upload.active })
                  : t('vq.upload.remove')}
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      {owner ? (
        <>
          <Button
            size="md"
            variant="violet"
            block
            onClick={() => {
              void questionsApi.text(venueId, 'export').then(
                (text) => download('sorularimiz.csv', text, 'text/csv'),
                (error: unknown) => setMessage(refusal(error)),
              );
            }}
            data-testid="vq-export"
          >
            {t('vq.export')}
          </Button>
          <SourceSetting venueId={venueId} onError={(error) => setMessage(refusal(error))} />
          <Reports
            venueId={venueId}
            onChanged={load}
            onError={(error) => setMessage(refusal(error))}
          />
        </>
      ) : null}
    </div>
  );
}

function SourceSetting({
  venueId,
  onError,
}: {
  venueId: string;
  onError: (error: unknown) => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<Source>('MIXED');
  const [share, setShare] = useState(30);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    questionsApi.settings(venueId).then(
      (result) => {
        setSource(result.settings.questions.source as Source);
        setShare(result.settings.questions.venueSharePercent);
      },
      () => undefined,
    );
  }, [venueId]);
  const save = (next: { source: Source; venueSharePercent: number }): void => {
    setSaved(false);
    questionsApi.saveSource(venueId, next).then(() => setSaved(true), onError);
  };
  return (
    <div className={styles.box} data-testid="vq-source">
      <label className={staff.field}>
        {t('vq.source.title')}
        <select
          value={source}
          onChange={(event) => {
            const next = event.target.value as Source;
            setSource(next);
            save({ source: next, venueSharePercent: share });
          }}
          data-testid="vq-source-select"
        >
          {(['MIXED', 'VENUE_ONLY', 'GLOBAL_ONLY'] as const).map((value) => (
            <option key={value} value={value}>
              {t(`vq.source.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {source === 'MIXED' ? (
        <label className={staff.field}>
          {t('vq.source.share')}
          <input
            type="number"
            min={5}
            max={95}
            value={share}
            onChange={(event) => setShare(Number(event.target.value))}
            onBlur={() => save({ source, venueSharePercent: share })}
          />
        </label>
      ) : null}
      <div role="status">{saved ? t('staff.settings.saved') : ''}</div>
    </div>
  );
}

function Reports({
  venueId,
  onChanged,
  onError,
}: {
  venueId: string;
  onChanged: () => void;
  onError: (error: unknown) => void;
}) {
  const { t, td } = useI18n();
  const [items, setItems] = useState<ReportItem[]>([]);
  const load = useCallback(() => {
    questionsApi.reports(venueId).then((result) => setItems(result.items), onError);
  }, [venueId, onError]);
  useEffect(load, [load]);
  const act = (id: string, action: 'DISMISS' | 'RETIRE'): void => {
    questionsApi.resolve(venueId, id, action).then(() => {
      load();
      onChanged();
    }, onError);
  };
  return (
    <div data-testid="vq-reports">
      <h2 className={staff.subtitle}>{t('vq.reports.title')}</h2>
      {items.length === 0 ? <p>{t('vq.reports.none')}</p> : null}
      <ul className={styles.rows}>
        {items.map((item) => (
          <li key={item.id}>
            <strong>{td(`vq.reports.reason.${item.reason}`)}</strong>
            <span className={styles.preview}>{item.questionText}</span>
            <div className={staff.row}>
              <Button size="md" variant="ghost" onClick={() => act(item.id, 'DISMISS')}>
                {t('vq.reports.dismiss')}
              </Button>
              <Button size="md" variant="danger" onClick={() => act(item.id, 'RETIRE')}>
                {t('vq.reports.retire')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Upload({
  venueId,
  issueText,
  when,
  onImported,
  onError,
}: {
  venueId: string;
  issueText: (issue: VenueIssue) => string;
  when: (iso: string) => string;
  onImported: () => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [done, setDone] = useState<Analysis | null>(null);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const source = (): { name: string; bytes: Uint8Array } | null => {
    if (pasted.trim()) {
      const text = pasted.trim();
      return {
        name: text.startsWith('{') ? 'yapistirilan.jsonl' : 'yapistirilan.csv',
        bytes: new TextEncoder().encode(text),
      };
    }
    return file;
  };
  const check = (): void => {
    const chosen = source();
    if (!chosen || busy) return;
    setBusy(true);
    setDone(null);
    questionsApi
      .dryRun(venueId, chosen.name, chosen.bytes)
      .then(setReport, onError)
      .finally(() => setBusy(false));
  };
  const doImport = (): void => {
    const chosen = source();
    if (!chosen || busy) return;
    setBusy(true);
    questionsApi
      .import(venueId, chosen.name, chosen.bytes)
      .then((result) => {
        if ('analysis' in result) {
          setDone(result.analysis);
          setReport(null);
          setFile(null);
          setPasted('');
          onImported();
        } else setReport(result);
      }, onError)
      .finally(() => setBusy(false));
  };
  const get = (
    path: 'template?format=csv' | 'template?format=jsonl',
    name: string,
    type: string,
  ): void => {
    questionsApi.text(venueId, path).then((text) => download(name, text, type), onError);
  };
  const copyPrompt = (): void => {
    questionsApi.prompt(venueId, 'csv').then(async (text) => {
      setPromptText(text);
      try {
        await navigator.clipboard.writeText(text);
        setNotice(t('vq.help.copied'));
      } catch {
        setNotice(t('vq.help.copyFailed'));
      }
    }, onError);
  };

  return (
    <div data-testid="vq-upload">
      <h2 className={staff.subtitle}>{t('vq.load.title')}</h2>
      <details className={styles.box} data-testid="vq-help">
        <summary>{t('vq.help.title')}</summary>
        <p>{t('vq.help.body')}</p>
        <div className={staff.row}>
          <Button
            size="md"
            variant="ghost"
            onClick={() => get('template?format=csv', 'soru-sablonu.csv', 'text/csv')}
          >
            {t('vq.help.csv')}
          </Button>
          <Button
            size="md"
            variant="ghost"
            onClick={() =>
              get('template?format=jsonl', 'soru-sablonu.jsonl', 'application/x-ndjson')
            }
          >
            {t('vq.help.jsonl')}
          </Button>
        </div>
        <Button size="md" variant="violet" block onClick={copyPrompt} data-testid="vq-prompt">
          {t('vq.help.prompt')}
        </Button>
        <div role="status">{notice ?? ''}</div>
        {promptText ? (
          <textarea
            className={`${styles.paste} ${styles.promptText}`}
            readOnly
            value={promptText}
          />
        ) : null}
      </details>

      <label className={staff.field}>
        {t('vq.load.file')}
        <input
          type="file"
          accept=".csv,.jsonl,.json,.txt,text/csv,text/plain"
          data-testid="vq-file"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            setReport(null);
            if (!picked) return setFile(null);
            picked.arrayBuffer().then(
              (buffer) => setFile({ name: picked.name, bytes: new Uint8Array(buffer) }),
              () => onError(new Error('read')),
            );
          }}
        />
      </label>
      <label className={staff.field}>
        {t('vq.load.paste')}
        <textarea
          className={styles.paste}
          value={pasted}
          onChange={(event) => {
            setPasted(event.target.value);
            setReport(null);
          }}
          placeholder={t('vq.load.pasteHint')}
          data-testid="vq-paste"
        />
      </label>
      <Button
        size="md"
        block
        disabled={busy || (!file && !pasted.trim())}
        onClick={check}
        data-testid="vq-check"
      >
        {busy && !report ? t('vq.load.checking') : t('vq.load.check')}
      </Button>

      {report ? (
        <ReportView
          report={report}
          issueText={issueText}
          when={when}
          busy={busy}
          onImport={doImport}
        />
      ) : null}
      {done ? (
        <div className={styles.box} role="status" data-testid="vq-done">
          <strong>{t('vq.report.okDone', { count: done.counts.ok })}</strong>
          <Counts analysis={done} />
        </div>
      ) : null}
    </div>
  );
}

function Counts({ analysis }: { analysis: Analysis }) {
  const { t } = useI18n();
  const { counts } = analysis;
  return (
    <ul className={styles.counts} data-testid="vq-counts">
      <li className={`${styles.count} ${styles.good}`}>
        {t('vq.report.ok', { count: counts.ok })}
      </li>
      {counts.review > 0 ? (
        <li className={`${styles.count} ${styles.warn}`}>
          {t('vq.report.review', { count: counts.review })}
        </li>
      ) : null}
      {counts.reject > 0 ? (
        <li className={`${styles.count} ${styles.bad}`}>
          {t('vq.report.reject', { count: counts.reject })}
        </li>
      ) : null}
      {counts.invalid > 0 ? (
        <li className={`${styles.count} ${styles.bad}`}>
          {t('vq.report.invalid', { count: counts.invalid })}
        </li>
      ) : null}
      {counts.duplicate > 0 ? (
        <li className={styles.count}>{t('vq.report.duplicate', { count: counts.duplicate })}</li>
      ) : null}
      {counts.full > 0 ? (
        <li className={`${styles.count} ${styles.warn}`}>
          {t('vq.report.full', { count: counts.full })}
        </li>
      ) : null}
    </ul>
  );
}

function ReportView({
  report,
  issueText,
  when,
  busy,
  onImport,
}: {
  report: Report;
  issueText: (issue: VenueIssue) => string;
  when: (iso: string) => string;
  busy: boolean;
  onImport: () => void;
}): ReactNode {
  const { t, td } = useI18n();
  if (!report.ok)
    return (
      <div className={styles.box} role="alert" data-testid="vq-file-error">
        {issueText(report.issue)}
      </div>
    );
  if (report.alreadyImported)
    return (
      <div className={styles.box} role="status" data-testid="vq-already">
        {t('vq.report.already', {
          when: when(report.alreadyImported.uploadedAt),
          count: report.alreadyImported.imported,
        })}
      </div>
    );
  const newNames = report.categories
    .filter((category) => category.isNew)
    .map((category) => category.label);
  const row = (item: RowReport): ReactNode => (
    <li key={item.line} data-testid={`vq-row-${item.line}`}>
      <strong>{t('vq.report.row', { line: item.line })}</strong> ·{' '}
      {td(`vq.report.status.${item.status}`)}
      {item.preview ? <span className={styles.preview}>{item.preview}</span> : null}
      {item.issues.map((issue) => (
        <span key={`${issue.field}${issue.code}`} className={styles.fix}>
          {issueText(issue)}
        </span>
      ))}
    </li>
  );
  return (
    <div className={styles.box} data-testid="vq-report">
      <strong>{t('vq.report.title')}</strong>
      {report.warnings.map((warning) => (
        <p key={warning.code} className={staff.hint}>
          {issueText(warning)}
        </p>
      ))}
      <Counts analysis={report} />
      {report.categories.length > 0 ? (
        <ul className={styles.counts}>
          {report.categories.map((category) => (
            <li key={category.id} className={styles.count}>
              {t('vq.report.byCategory', { label: category.label, count: category.count })}
            </li>
          ))}
        </ul>
      ) : null}
      {newNames.length > 0 ? (
        <p className={staff.hint}>{t('vq.report.newCategories', { names: newNames.join(', ') })}</p>
      ) : null}
      {report.batch.map((finding) => (
        <p key={finding.code} className={staff.hint}>
          {finding.code === 'CORRECT_POSITION_SKEW'
            ? t('vq.report.batchSkew')
            : t('vq.report.batchLongest')}
        </p>
      ))}
      {report.rows.length > 0 ? (
        <>
          <h3 className={staff.subtitle}>{t('vq.report.problems')}</h3>
          <ul className={styles.rows} data-testid="vq-problems">
            {report.rows.map(row)}
          </ul>
          {report.rowsOmitted > 0 ? (
            <p className={staff.hint}>{t('vq.report.more', { count: report.rowsOmitted })}</p>
          ) : null}
        </>
      ) : null}
      {report.sample.length > 0 ? (
        <>
          <h3 className={staff.subtitle}>{t('vq.report.sample')}</h3>
          <ul className={styles.rows} data-testid="vq-sample">
            {report.sample.map((item) => (
              <li key={item.line}>
                <span className={styles.preview}>{item.preview}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {report.counts.ok === 0 ? <p>{t('vq.report.nothing')}</p> : null}
      <Button
        size="md"
        block
        disabled={busy || report.counts.ok === 0}
        onClick={onImport}
        data-testid="vq-import"
      >
        {busy ? t('vq.report.importing') : t('vq.report.import')}
      </Button>
    </div>
  );
}
