import type { ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { Badge, ErrorNote, Loading, t, useAction, when } from '../ui';

interface Flag {
  key: string;
  enabled: boolean;
  description: string;
  public: boolean;
  updatedAt: string;
}

export function Flags(): ReactNode {
  const list = useLoad(() => api<{ items: Flag[] }>('/v1/admin/flags'), 'flags');
  const action = useAction();
  const toggle = (flag: Flag): void => {
    void action
      .run(
        async () => {
          await api(`/v1/admin/flags/${flag.key}`, {
            method: 'PUT',
            body: { enabled: !flag.enabled },
          });
        },
        `${flag.key}: ${flag.enabled ? t('admin.flags.off') : t('admin.flags.on')}?`,
      )
      .then((done) => {
        if (done) list.reload();
      });
  };
  return (
    <>
      <h1>{t('admin.flags.title')}</h1>
      <ErrorNote message={list.error ?? action.error} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="flag-table">
            <tbody>
              {list.data.items.map((flag) => (
                <tr key={flag.key}>
                  <td>
                    <code>{flag.key}</code>
                    <div className="muted">{flag.description}</div>
                  </td>
                  <td>
                    {flag.public ? <Badge>{t('admin.flags.public')}</Badge> : null}
                    <span className="muted">{when(flag.updatedAt)}</span>
                  </td>
                  <td>
                    <button
                      data-testid={`flag-${flag.key}`}
                      className={flag.enabled ? 'primary' : ''}
                      disabled={action.busy}
                      onClick={() => toggle(flag)}
                    >
                      {flag.enabled ? t('admin.flags.on') : t('admin.flags.off')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : list.loading ? (
        <Loading />
      ) : null}
    </>
  );
}
