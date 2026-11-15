import { useState, type ChangeEvent, type ReactNode } from 'react';
import { api, apiText } from '../api';
import { ErrorNote, Ok, label, t, useAction } from '../ui';

interface ImportReport {
  total: number;
  counts: Record<string, number>;
  items: { line: number; outcome: string; questionId?: string; errors?: string[] }[];
  itemsOmitted: number;
}

async function readFile(event: ChangeEvent<HTMLInputElement>): Promise<string | null> {
  const file = event.target.files?.[0];
  return file ? file.text() : null;
}

export function ImportExport(): ReactNode {
  const [format, setFormat] = useState<'jsonl' | 'csv'>('jsonl');
  const [text, setText] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [update, setUpdate] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const importing = useAction();

  const [exportStatus, setExportStatus] = useState('DRAFT,REVIEW');
  const exporting = useAction();

  const [source, setSource] = useState('');
  const [results, setResults] = useState('');
  const uploading = useAction();

  const [auditStatuses, setAuditStatuses] = useState('DRAFT,REVIEW');
  const [auditDry, setAuditDry] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);
  const auditing = useAction();

  return (
    <>
      <h1>{t('admin.nav.import')}</h1>

      <div className="card stack">
        <h2>{t('admin.import.title')}</h2>
        <label>
          {t('admin.import.format')}
          <select value={format} onChange={(e) => setFormat(e.target.value as 'jsonl' | 'csv')}>
            <option value="jsonl">JSONL</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <label>
          {t('admin.import.paste')}
          <textarea
            data-testid="import-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <input
          type="file"
          aria-label={t('admin.import.file')}
          onChange={(e) => void readFile(e).then((content) => content !== null && setText(content))}
        />
        <label>
          <span>
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />{' '}
            {t('admin.import.dryRun')}
          </span>
        </label>
        <label>
          <span>
            <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />{' '}
            {t('admin.import.update')}
          </span>
        </label>
        <ErrorNote message={importing.error} />
        <div>
          <button
            className="primary"
            data-testid="import-run"
            disabled={importing.busy || text.trim() === ''}
            onClick={() =>
              void importing.run(async () => {
                const result = await api<ImportReport>('/v1/admin/questions/import', {
                  method: 'POST',
                  body: { format, text, dryRun, updateExisting: update },
                });
                setReport(result);
              })
            }
          >
            {t('admin.import.run')}
          </button>
        </div>
        {report ? (
          <div data-testid="import-report">
            <p>
              {t('admin.import.report', { total: report.total })}{' '}
              {Object.entries(report.counts).map(([outcome, n]) => (
                <span className="badge" key={outcome}>
                  {label('admin.import.outcome', outcome)}: {n}
                </span>
              ))}
            </p>
            {report.items
              .filter((i) => !['CREATED', 'UPDATED', 'UNCHANGED'].includes(i.outcome))
              .map((i) => (
                <div key={i.line}>
                  {t('admin.import.line', { line: i.line })}:{' '}
                  {label('admin.import.outcome', i.outcome)}{' '}
                  <span className="muted">{(i.errors ?? []).join(', ')}</span>
                </div>
              ))}
            {report.itemsOmitted > 0 ? (
              <p className="muted">{t('admin.import.omitted', { n: report.itemsOmitted })}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card stack">
        <h2>{t('admin.export.title')}</h2>
        <p className="muted">{t('admin.export.intro')}</p>
        <label>
          {t('admin.questions.status')}
          <input value={exportStatus} onChange={(e) => setExportStatus(e.target.value)} />
        </label>
        <ErrorNote message={exporting.error} />
        <div>
          <button
            disabled={exporting.busy}
            onClick={() =>
              void exporting.run(async () => {
                const body = await apiText('/v1/admin/export', { format, status: exportStatus });
                const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = `questions.${format}`;
                link.click();
                URL.revokeObjectURL(url);
              })
            }
          >
            {t('admin.export.download')}
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>{t('admin.results.title')}</h2>
        <label>
          {t('admin.results.source')}
          <input value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <p className="muted">{t('admin.results.sourceHint')}</p>
        <textarea value={results} onChange={(e) => setResults(e.target.value)} />
        <input
          type="file"
          aria-label={t('admin.import.file')}
          onChange={(e) =>
            void readFile(e).then((content) => content !== null && setResults(content))
          }
        />
        <ErrorNote message={uploading.error} />
        <Ok message={uploading.ok} />
        <div>
          <button
            disabled={uploading.busy || source.trim().length < 2 || results.trim() === ''}
            onClick={() =>
              void uploading.run(async () => {
                const r = await api<{ applied: number; skipped: unknown[] }>(
                  '/v1/admin/audit/results',
                  { method: 'POST', body: { source: source.trim(), text: results } },
                );
                return t('admin.results.applied', {
                  applied: r.applied,
                  skipped: r.skipped.length,
                });
              })
            }
          >
            {t('admin.import.run')}
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>{t('admin.audit.title')}</h2>
        <label>
          {t('admin.questions.status')}
          <input value={auditStatuses} onChange={(e) => setAuditStatuses(e.target.value)} />
        </label>
        <label>
          <span>
            <input
              type="checkbox"
              checked={auditDry}
              onChange={(e) => setAuditDry(e.target.checked)}
            />{' '}
            {t('admin.audit.dry')}
          </span>
        </label>
        <ErrorNote message={auditing.error} />
        {summary ? <p data-testid="audit-summary">{summary}</p> : null}
        <div>
          <button
            disabled={auditing.busy}
            onClick={() =>
              void auditing.run(async () => {
                const r = await api<{
                  total: number;
                  statusChanges: number;
                  modelsConfigured: boolean;
                }>('/v1/admin/audit/run', {
                  method: 'POST',
                  body: {
                    statuses: auditStatuses.split(',').filter(Boolean),
                    dryRun: auditDry,
                    limit: 100,
                  },
                });
                setSummary(
                  `${t('admin.audit.result', { summary: `${r.total} / ${r.statusChanges}` })}${r.modelsConfigured ? '' : ` — ${t('admin.editor.noModels')}`}`,
                );
              })
            }
          >
            {t('admin.audit.run')}
          </button>
        </div>
      </div>
    </>
  );
}
