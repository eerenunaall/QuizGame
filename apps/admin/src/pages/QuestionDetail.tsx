import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useCategories } from '../categories';
import { useLoad } from '../hooks';
import { Badge, ErrorNote, Loading, Ok, label, statusTone, t, useAction, when } from '../ui';

interface Detail {
  question: {
    id: string;
    externalId: string | null;
    revision: number;
    status: string;
    isDevSeed: boolean;
    language: string;
    category: string;
    subcategory: string | null;
    topic: string | null;
    difficulty: string;
    pool: string;
    text: string;
    explanation: string | null;
    authorType: string;
    options: { id: string; position: number; text: string; correct: boolean; pickCount: number }[];
    sources: { url: string; title: string | null }[];
    expiresAt: string | null;
    lastVerifiedAt: string | null;
    updatedAt: string;
  };
  stats: { usageCount: number; answerCount: number; correctAnswerCount: number; skipCount: number };
  findings: { code: string; severity: string; dimension: string; detail?: unknown }[];
  audits: {
    id: number;
    createdAt: string;
    revision: number;
    actor: string | null;
    pass: string;
    provider: string;
    status: string;
    reasonCodes: string[];
    suggestedRewrite: string | null;
  }[];
  statusLog: {
    at: string;
    from: string | null;
    to: string;
    actor: string | null;
    reason: string;
  }[];
  reports: { reason: string; status: string; count: number }[];
}

interface Draft {
  text: string;
  explanation: string;
  difficulty: string;
  category: string;
  options: { text: string; correct: boolean }[];
  sources: { url: string; title: string }[];
  expiresAt: string;
}

const toDraft = (q: Detail['question']): Draft => ({
  text: q.text,
  explanation: q.explanation ?? '',
  difficulty: q.difficulty,
  category: q.category,
  options: q.options.map((o) => ({ text: o.text, correct: o.correct })),
  sources: q.sources.map((s) => ({ url: s.url, title: s.title ?? '' })),
  expiresAt: q.expiresAt ? q.expiresAt.slice(0, 10) : '',
});

export function QuestionDetail({ id }: { id: string }): ReactNode {
  const detail = useLoad(() => api<Detail>(`/v1/admin/questions/${id}`), id);
  const categories = useCategories();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState('');
  const [waiveAll, setWaiveAll] = useState(false);
  const [note, setNote] = useState('');
  const save = useAction();
  const workflow = useAction();
  const data = detail.data;

  useEffect(() => {
    if (data) setDraft(toDraft(data.question));
  }, [data]);

  if (!data || !draft) {
    return (
      <>
        <ErrorNote message={detail.error} />
        {detail.loading ? <Loading /> : null}
      </>
    );
  }
  const { question } = data;
  const patch = (changes: Partial<Draft>): void => setDraft({ ...draft, ...changes });
  const correctCount = draft.options.filter((o) => o.correct).length;

  const reload = (): void => detail.reload();
  const post = (path: string, body: unknown, message: string) =>
    workflow.run(async () => {
      await api(`/v1/admin/questions/${id}/${path}`, { method: 'POST', body });
      reload();
      return message;
    });

  const submit = (): Promise<boolean> =>
    save.run(async () => {
      await api(`/v1/admin/questions/${id}`, {
        method: 'PATCH',
        body: {
          expectedRevision: question.revision,
          text: draft.text,
          explanation: draft.explanation || null,
          difficulty: draft.difficulty,
          category: draft.category,
          options: draft.options,
          sources: draft.sources
            .filter((s) => s.url.trim() !== '')
            .map((s) => ({ url: s.url.trim(), ...(s.title ? { title: s.title } : {}) })),
          expiresAt: draft.expiresAt
            ? new Date(`${draft.expiresAt}T00:00:00Z`).toISOString()
            : null,
        },
      });
      reload();
      return t('admin.saved');
    });

  const moveTo = (to: string, message: string) =>
    post('transition', { to, reason: reason.trim() }, message);

  return (
    <>
      <h1>
        <a href="#/questions">←</a> {t('admin.questions.title')}
      </h1>
      <p>
        <Badge tone={statusTone(question.status)}>{label('admin.status', question.status)}</Badge>
        <Badge>{t('admin.questions.revision', { n: question.revision })}</Badge>
        {question.isDevSeed ? <Badge>{t('admin.questions.devSeed')}</Badge> : null}
        <span className="muted">{question.externalId ?? question.id}</span>
      </p>

      <div className="card stack">
        <label>
          {t('admin.editor.text')}
          <textarea
            data-testid="edit-text"
            value={draft.text}
            onChange={(e) => patch({ text: e.target.value })}
          />
        </label>
        <div className="row">
          <label>
            {t('admin.questions.category')}
            <select value={draft.category} onChange={(e) => patch({ category: e.target.value })}>
              {(categories.data?.items ?? [{ id: draft.category, labelTr: draft.category }]).map(
                (c) => (
                  <option key={c.id} value={c.id}>
                    {c.labelTr}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            {t('admin.questions.difficulty')}
            <select
              value={draft.difficulty}
              onChange={(e) => patch({ difficulty: e.target.value })}
            >
              {['EASY', 'MEDIUM', 'HARD', 'EXPERT'].map((d) => (
                <option key={d} value={d}>
                  {label('admin.difficulty', d)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('admin.editor.expiresAt')}
            <input
              type="date"
              value={draft.expiresAt}
              onChange={(e) => patch({ expiresAt: e.target.value })}
            />
          </label>
        </div>
        <fieldset>
          <legend>{t('admin.editor.options')}</legend>
          {draft.options.map((option, index) => (
            <div className="option-row" key={index}>
              <input
                type="radio"
                name="correct"
                aria-label={t('admin.editor.correct')}
                checked={option.correct}
                onChange={() =>
                  patch({ options: draft.options.map((o, i) => ({ ...o, correct: i === index })) })
                }
              />
              <input
                data-testid={`edit-option-${index}`}
                aria-label={t('admin.editor.optionN', { n: index + 1 })}
                value={option.text}
                onChange={(e) =>
                  patch({
                    options: draft.options.map((o, i) =>
                      i === index ? { ...o, text: e.target.value } : o,
                    ),
                  })
                }
              />
              <span className="muted">{data.question.options[index]?.pickCount ?? 0}</span>
            </div>
          ))}
        </fieldset>
        <label>
          {t('admin.editor.explanation')}
          <input
            value={draft.explanation}
            onChange={(e) => patch({ explanation: e.target.value })}
          />
        </label>
        <fieldset>
          <legend>{t('admin.editor.sources')}</legend>
          {draft.sources.map((source, index) => (
            <div className="row" key={index}>
              <input
                aria-label={t('admin.editor.sourceUrl')}
                placeholder={t('admin.editor.sourceUrl')}
                value={source.url}
                onChange={(e) =>
                  patch({
                    sources: draft.sources.map((s, i) =>
                      i === index ? { ...s, url: e.target.value } : s,
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() => patch({ sources: draft.sources.filter((_, i) => i !== index) })}
              >
                {t('admin.remove')}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => patch({ sources: [...draft.sources, { url: '', title: '' }] })}
          >
            {t('admin.editor.addSource')}
          </button>
        </fieldset>
        <p className="muted">{t('admin.editor.contentChangeWarning')}</p>
        <ErrorNote message={save.error} />
        <Ok message={save.ok} />
        <div>
          <button
            className="primary"
            data-testid="edit-save"
            disabled={save.busy || correctCount !== 1}
            onClick={() => void submit()}
          >
            {t('admin.save')}
          </button>
        </div>
      </div>

      <div className="card stack">
        <label>
          {t('admin.reason')}
          <input
            data-testid="workflow-reason"
            value={reason}
            placeholder={t('admin.reasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="row">
          <button
            data-testid="run-audit"
            disabled={workflow.busy}
            onClick={() =>
              void workflow.run(async () => {
                const report = await api<{ modelsConfigured: boolean; total: number }>(
                  '/v1/admin/audit/run',
                  {
                    method: 'POST',
                    body: { ids: [id], limit: 1 },
                  },
                );
                reload();
                return report.modelsConfigured
                  ? t('admin.editor.auditStarted', { summary: String(report.total) })
                  : t('admin.editor.noModels');
              })
            }
          >
            {t('admin.editor.runAudit')}
          </button>
          {question.status === 'REVIEW' ? (
            <>
              <label>
                <span>
                  <input
                    type="checkbox"
                    data-testid="waive-all"
                    checked={waiveAll}
                    onChange={(e) => setWaiveAll(e.target.checked)}
                  />{' '}
                  {t('admin.editor.waiveAll')}
                </span>
              </label>
              <input
                aria-label={t('admin.editor.approvalNote')}
                placeholder={t('admin.editor.approvalNote')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="primary"
                data-testid="approve"
                disabled={workflow.busy}
                onClick={() =>
                  void post(
                    'approve',
                    { waive: waiveAll ? 'ALL' : [], ...(note ? { note } : {}) },
                    t('admin.editor.transitioned', { to: label('admin.status', 'APPROVED') }),
                  )
                }
              >
                {t('admin.editor.approve')}
              </button>
              <button
                className="danger"
                data-testid="reject"
                disabled={workflow.busy || reason.trim().length < 3}
                onClick={() =>
                  void post(
                    'reject',
                    { reason: reason.trim() },
                    t('admin.editor.transitioned', { to: label('admin.status', 'REJECTED') }),
                  )
                }
              >
                {t('admin.editor.reject')}
              </button>
            </>
          ) : null}
          {question.status === 'APPROVED' ? (
            <button
              className="primary"
              data-testid="publish"
              disabled={workflow.busy || reason.trim().length < 3}
              onClick={() =>
                void moveTo(
                  'ACTIVE',
                  t('admin.editor.transitioned', { to: label('admin.status', 'ACTIVE') }),
                )
              }
            >
              {t('admin.editor.publish')}
            </button>
          ) : null}
          {question.status === 'ACTIVE' || question.status === 'APPROVED' ? (
            <button
              data-testid="retire"
              className="danger"
              disabled={workflow.busy || reason.trim().length < 3}
              onClick={() =>
                void moveTo(
                  'RETIRED',
                  t('admin.editor.transitioned', { to: label('admin.status', 'RETIRED') }),
                )
              }
            >
              {t('admin.editor.retire')}
            </button>
          ) : null}
          {question.status === 'DRAFT' ? (
            <button
              data-testid="to-review"
              disabled={workflow.busy || reason.trim().length < 3}
              onClick={() =>
                void moveTo(
                  'REVIEW',
                  t('admin.editor.transitioned', { to: label('admin.status', 'REVIEW') }),
                )
              }
            >
              {t('admin.editor.toReview')}
            </button>
          ) : null}
          {question.status === 'RETIRED' || question.status === 'REJECTED' ? (
            <button
              data-testid="reopen"
              disabled={workflow.busy || reason.trim().length < 3}
              onClick={() =>
                void moveTo(
                  'REVIEW',
                  t('admin.editor.transitioned', { to: label('admin.status', 'REVIEW') }),
                )
              }
            >
              {t('admin.editor.reopen')}
            </button>
          ) : null}
        </div>
        <ErrorNote message={workflow.error} />
        <Ok message={workflow.ok} />
      </div>

      <div className="card">
        <h2>{t('admin.editor.findings')}</h2>
        {data.findings.length === 0 ? (
          <p className="muted">{t('admin.editor.noFindings')}</p>
        ) : null}
        <ul data-testid="findings">
          {data.findings.map((f, index) => (
            <li key={index}>
              <Badge tone={f.severity === 'REJECT' ? 'bad' : f.severity === 'REVIEW' ? 'warn' : ''}>
                {label('admin.severity', f.severity)}
              </Badge>
              <code>{f.code}</code> · {label('admin.dimension', f.dimension)}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>{t('admin.editor.stats')}</h2>
        <div className="kv">
          <span>{t('admin.editor.usage')}</span>
          <span>{data.stats.usageCount}</span>
          <span>{t('admin.editor.answers')}</span>
          <span>
            {data.stats.answerCount} ({data.stats.correctAnswerCount})
          </span>
          <span>{t('admin.editor.skips')}</span>
          <span>{data.stats.skipCount}</span>
        </div>
      </div>

      {data.reports.length > 0 ? (
        <div className="card">
          <h2>{t('admin.editor.reportsOnQuestion')}</h2>
          {data.reports.map((r, index) => (
            <div key={index}>
              <code>{r.reason}</code> · {label('admin.reports.status', r.status)} · {r.count}
            </div>
          ))}
        </div>
      ) : null}

      <div className="card table-wrap">
        <h2>{t('admin.editor.audits')}</h2>
        <table>
          <tbody>
            {data.audits.map((a) => (
              <tr key={a.id}>
                <td>{when(a.createdAt)}</td>
                <td>
                  {a.pass} · {a.provider}
                </td>
                <td>
                  <Badge
                    tone={a.status === 'PASS' ? 'good' : a.status === 'REJECT' ? 'bad' : 'warn'}
                  >
                    {label('admin.verdict', a.status)}
                  </Badge>
                  {t('admin.questions.revision', { n: a.revision })}
                </td>
                <td>
                  {a.reasonCodes.join(', ')}
                  {a.suggestedRewrite ? (
                    <div className="muted">
                      {t('admin.editor.suggestedRewrite')}: {a.suggestedRewrite}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h2>{t('admin.editor.log')}</h2>
        <table>
          <tbody>
            {data.statusLog.map((l, index) => (
              <tr key={index}>
                <td>{when(l.at)}</td>
                <td>
                  {l.from ? label('admin.status', l.from) : '—'} → {label('admin.status', l.to)}
                </td>
                <td>{l.actor ? t('admin.editor.humanApproved') : t('admin.editor.system')}</td>
                <td>{l.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
