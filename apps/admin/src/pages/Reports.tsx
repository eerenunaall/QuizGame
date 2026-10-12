import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { Badge, ErrorNote, Loading, Ok, Pager, label, t, useAction, when } from '../ui';

interface Report {
  id: string;
  questionId: string;
  reportRevision: number;
  reason: string;
  status: string;
  createdAt: string;
  question: { text: string; status: string; revision: number; category: string };
}
const LIMIT = 25;
const ACTIONS = ['DISMISS', 'SEND_TO_REVIEW', 'RETIRE', 'MARK_FIXED'] as const;

export function Reports(): ReactNode {
  const [status, setStatus] = useState('OPEN');
  const [offset, setOffset] = useState(0);
  const action = useAction();
  const list = useLoad(
    () =>
      api<{ total: number; items: Report[] }>('/v1/admin/reports', {
        query: { status, limit: LIMIT, offset },
      }),
    `${status}:${offset}`,
  );
  const resolve = (id: string, verb: (typeof ACTIONS)[number]): void => {
    void action
      .run(async () => {
        await api(`/v1/admin/reports/${id}/resolve`, { method: 'POST', body: { action: verb } });
        return t('admin.reports.resolved', { n: label('admin.reports.action', verb) });
      })
      .then((done) => {
        if (done) list.reload();
      });
  };
  return (
    <>
      <h1>{t('admin.reports.title')}</h1>
      <div className="row">
        <label>
          {t('admin.questions.status')}
          <select
            data-testid="report-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            {['OPEN', 'ACTIONED', 'DISMISSED'].map((s) => (
              <option key={s} value={s}>
                {label('admin.reports.status', s)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">{t('admin.reports.reporterHidden')}</p>
      <ErrorNote message={list.error ?? action.error} />
      <Ok message={action.ok} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="report-table">
            <tbody>
              {list.data.items.length === 0 ? (
                <tr>
                  <td className="muted">{t('admin.empty')}</td>
                </tr>
              ) : null}
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`#/questions/${r.questionId}`}>{r.question.text}</a>
                    <div className="muted">
                      <Badge tone="warn">{r.reason}</Badge>
                      {when(r.createdAt)} ·{' '}
                      {t('admin.reports.revisionNote', { n: r.reportRevision })}
                    </div>
                  </td>
                  <td>
                    {r.status === 'OPEN'
                      ? ACTIONS.map((verb) => (
                          <button
                            key={verb}
                            data-testid={`report-${verb}`}
                            disabled={action.busy}
                            onClick={() => resolve(r.id, verb)}
                          >
                            {label('admin.reports.action', verb)}
                          </button>
                        ))
                      : label('admin.reports.status', r.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={list.data.total} offset={offset} limit={LIMIT} onChange={setOffset} />
        </div>
      ) : list.loading ? (
        <Loading />
      ) : null}
    </>
  );
}
