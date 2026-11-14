import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorNote, Loading, Pager, t, when } from '../ui';

interface Entry {
  id: number;
  at: string;
  actor: string | null;
  roles: string[];
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
}
const LIMIT = 50;

export function AuditLog(): ReactNode {
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useLoad(
    () =>
      api<{ total: number; items: Entry[] }>('/v1/admin/audit-log', {
        query: { action: action.trim(), limit: LIMIT, offset },
      }),
    `${action}:${offset}`,
  );
  return (
    <>
      <h1>{t('admin.audit.logTitle')}</h1>
      <p className="muted">{t('admin.audit.logIntro')}</p>
      <label>
        {t('admin.audit.filterAction')}
        <input
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      <ErrorNote message={list.error} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="audit-table">
            <thead>
              <tr>
                <th>{t('admin.audit.when')}</th>
                <th>{t('admin.audit.who')}</th>
                <th>{t('admin.audit.what')}</th>
                <th>{t('admin.audit.target')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.at)}</td>
                  <td className="muted">{e.actor?.slice(0, 8) ?? '—'}</td>
                  <td>
                    <code>{e.action}</code>
                  </td>
                  <td>
                    {e.targetType}
                    {e.targetId ? ` ${e.targetId.slice(0, 8)}` : ''}
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
