import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { Badge, ErrorNote, Loading, Pager, t, when } from '../ui';

interface Entry {
  id: string;
  category: string;
  text: string;
  revision: number;
  updatedAt: string;
  openReports: number;
  disputes: number;
  reasons: string[];
}
const LIMIT = 25;

export function Queue(): ReactNode {
  const [offset, setOffset] = useState(0);
  const list = useLoad(
    () =>
      api<{ total: number; items: Entry[] }>('/v1/admin/queue', {
        query: { limit: LIMIT, offset },
      }),
    String(offset),
  );
  return (
    <>
      <h1>{t('admin.queue.title')}</h1>
      <ErrorNote message={list.error} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="queue-table">
            <tbody>
              {list.data.items.length === 0 ? (
                <tr>
                  <td className="muted">{t('admin.empty')}</td>
                </tr>
              ) : null}
              {list.data.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <a href={`#/questions/${e.id}`}>{e.text}</a>
                    <div className="muted">
                      {e.category} · {when(e.updatedAt)}
                    </div>
                  </td>
                  <td>
                    {e.openReports > 0 ? (
                      <Badge tone="warn">
                        {t('admin.queue.reportsCount', { n: e.openReports })}
                      </Badge>
                    ) : null}
                    {e.reasons.map((reason) => (
                      <Badge key={reason}>{reason}</Badge>
                    ))}
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
