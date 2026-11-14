import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorNote, Loading, Ok, Pager, label, t, useAction, when } from '../ui';

interface Ban {
  id: string;
  kind: string;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  liftedAt: string | null;
}
const LIMIT = 25;

export function Bans(): ReactNode {
  const [lifted, setLifted] = useState(false);
  const [offset, setOffset] = useState(0);
  const action = useAction();
  const list = useLoad(
    () =>
      api<{ total: number; items: Ban[] }>('/v1/admin/bans', {
        query: { open: lifted ? '0' : '1', limit: LIMIT, offset },
      }),
    `${lifted}:${offset}`,
  );
  const lift = (id: string): void => {
    void action
      .run(async () => {
        await api(`/v1/admin/bans/${id}/lift`, { method: 'POST', body: {} });
        return t('admin.bans.lifted');
      })
      .then((done) => {
        if (done) list.reload();
      });
  };
  return (
    <>
      <h1>{t('admin.bans.title')}</h1>
      <p className="muted">{t('admin.bans.subjectHidden')}</p>
      <label>
        <span>
          <input
            type="checkbox"
            checked={lifted}
            onChange={(e) => {
              setLifted(e.target.checked);
              setOffset(0);
            }}
          />{' '}
          {t('admin.bans.showLifted')}
        </span>
      </label>
      <ErrorNote message={list.error ?? action.error} />
      <Ok message={action.ok} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="ban-table">
            <tbody>
              {list.data.items.length === 0 ? (
                <tr>
                  <td className="muted">{t('admin.empty')}</td>
                </tr>
              ) : null}
              {list.data.items.map((ban) => (
                <tr key={ban.id}>
                  <td>{label('admin.bans.kind', ban.kind)}</td>
                  <td>{ban.reason}</td>
                  <td>
                    {t('admin.bans.until')}:{' '}
                    {ban.expiresAt ? when(ban.expiresAt) : t('admin.bans.forever')}
                  </td>
                  <td>
                    {ban.liftedAt ? (
                      when(ban.liftedAt)
                    ) : (
                      <button onClick={() => lift(ban.id)}>{t('admin.bans.lift')}</button>
                    )}
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
