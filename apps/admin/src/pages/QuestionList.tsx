import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useCategories } from '../categories';
import { go, useLoad } from '../hooks';
import { Badge, ErrorNote, Loading, Pager, label, statusTone, t, when } from '../ui';

interface Row {
  id: string;
  externalId: string | null;
  status: string;
  category: string;
  difficulty: string;
  language: string;
  pool: string;
  text: string;
  revision: number;
  reportCount: number;
  answerCount: number;
  correctRate: number | null;
  usageCount: number;
  expiresAt: string | null;
  updatedAt: string;
  isDevSeed: boolean;
}

const LIMIT = 25;
const STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED'];

export function QuestionList(): ReactNode {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('updated');
  const [expiring, setExpiring] = useState(false);
  const [offset, setOffset] = useState(0);
  const categories = useCategories();
  const query = { q, status, category, sort, expiring: expiring ? '1' : '', limit: LIMIT, offset };
  const list = useLoad(
    () => api<{ total: number; items: Row[] }>('/v1/admin/questions', { query }),
    JSON.stringify(query),
  );
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setOffset(0);
    };

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>{t('admin.questions.title')}</h1>
        <button className="primary" data-testid="question-new" onClick={() => go('questions/new')}>
          {t('admin.questions.new')}
        </button>
      </div>
      <div className="card row">
        <label>
          {t('admin.search')}
          <input
            data-testid="question-search"
            value={q}
            placeholder={t('admin.questions.searchPlaceholder')}
            onChange={(e) => reset(setQ)(e.target.value)}
          />
        </label>
        <label>
          {t('admin.questions.status')}
          <select value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
            <option value="">{t('admin.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label('admin.status', s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.questions.category')}
          <select value={category} onChange={(e) => reset(setCategory)(e.target.value)}>
            <option value="">{t('admin.all')}</option>
            {(categories.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.labelTr}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.questions.sort')}
          <select value={sort} onChange={(e) => reset(setSort)(e.target.value)}>
            {(['updated', 'created', 'reports', 'usage'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`admin.questions.sort.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            <input
              type="checkbox"
              checked={expiring}
              onChange={(e) => reset(setExpiring)(e.target.checked)}
            />{' '}
            {t('admin.questions.expiring')}
          </span>
        </label>
      </div>
      <ErrorNote message={list.error} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="question-table">
            <tbody>
              {list.data.items.length === 0 ? (
                <tr>
                  <td className="muted">{t('admin.empty')}</td>
                </tr>
              ) : null}
              {list.data.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <a href={`#/questions/${row.id}`}>{row.text}</a>
                    <div className="muted">
                      {row.category} · {label('admin.difficulty', row.difficulty)} · {row.language}{' '}
                      · {t('admin.questions.revision', { n: row.revision })} · {when(row.updatedAt)}
                    </div>
                  </td>
                  <td>
                    <Badge tone={statusTone(row.status)}>{label('admin.status', row.status)}</Badge>
                    {row.isDevSeed ? <Badge>{t('admin.questions.devSeed')}</Badge> : null}
                    {row.reportCount > 0 ? (
                      <Badge tone="warn">
                        {t('admin.questions.reports')}: {row.reportCount}
                      </Badge>
                    ) : null}
                    {row.correctRate !== null ? (
                      <div className="muted">
                        {t('admin.questions.correctRate')}: {Math.round(row.correctRate * 100)}%
                      </div>
                    ) : null}
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
