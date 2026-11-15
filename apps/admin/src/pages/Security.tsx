import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorNote, Loading, Pager, t, when } from '../ui';

interface Event {
  id: number;
  at: string;
  kind: string;
  source: string | null;
  detail: string;
}
const LIMIT = 50;

export function Security(): ReactNode {
  const [kind, setKind] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useLoad(
    () =>
      api<{ total: number; items: Event[] }>('/v1/admin/security-events', {
        query: { kind: kind.trim().toUpperCase(), limit: LIMIT, offset },
      }),
    `${kind}:${offset}`,
  );
  return (
    <>
      <h1>{t('admin.security.title')}</h1>
      <label>
        {t('admin.security.kind')}
        <input
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      <ErrorNote message={list.error} />
      {list.data ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('admin.audit.when')}</th>
                <th>{t('admin.security.kind')}</th>
                <th>{t('admin.security.source')}</th>
                <th>{t('admin.security.detail')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.at)}</td>
                  <td>
                    <code>{e.kind}</code>
                  </td>
                  <td>{e.source ?? '—'}</td>
                  <td>
                    <pre>{e.detail}</pre>
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
