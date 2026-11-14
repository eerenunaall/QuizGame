import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { Badge, ErrorNote, Loading, Ok, Pager, label, t, useAction, when } from '../ui';

interface User {
  id: string;
  email: string;
  status: string;
  roles: string[];
  lastLoginAt: string | null;
}
const LIMIT = 25;
const ROLES = ['ADMIN', 'EDITOR', 'MODERATOR', 'SUPPORT'];

export function Users(): ReactNode {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const action = useAction();
  const list = useLoad(
    () =>
      api<{ total: number; items: User[] }>('/v1/admin/users', {
        query: { search, limit: LIMIT, offset },
      }),
    `${search}:${offset}`,
  );
  const act = (work: () => Promise<string>, confirm?: string): void => {
    void action.run(work, confirm).then((done) => {
      if (done) list.reload();
    });
  };
  const toggleRole = (user: User, role: string): void => {
    const roles = user.roles.includes(role)
      ? user.roles.filter((r) => r !== role)
      : [...user.roles, role];
    act(async () => {
      await api(`/v1/admin/users/${user.id}/roles`, { method: 'PUT', body: { roles } });
      return t('admin.users.rolesSaved');
    });
  };
  return (
    <>
      <h1>{t('admin.users.title')}</h1>
      <label>
        {t('admin.search')}
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      <ErrorNote message={list.error ?? action.error} />
      <Ok message={action.ok} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="user-table">
            <tbody>
              {list.data.items.map((user) => (
                <tr key={user.id}>
                  <td>
                    {user.email}
                    <div className="muted">
                      {t('admin.users.lastLogin')}: {when(user.lastLoginAt)}
                    </div>
                  </td>
                  <td>
                    {ROLES.map((role) => (
                      <label key={role}>
                        <span>
                          <input
                            type="checkbox"
                            data-testid={`role-${user.email}-${role}`}
                            checked={user.roles.includes(role)}
                            disabled={action.busy}
                            onChange={() => toggleRole(user, role)}
                          />{' '}
                          {label('admin.role', role)}
                        </span>
                      </label>
                    ))}
                  </td>
                  <td>
                    <Badge tone={user.status === 'ACTIVE' ? 'good' : 'bad'}>
                      {label('admin.users.status', user.status)}
                    </Badge>
                    <button
                      onClick={() =>
                        act(async () => {
                          await api(`/v1/admin/users/${user.id}/status`, {
                            method: 'POST',
                            body: { status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' },
                          });
                          return t('admin.users.statusSaved');
                        })
                      }
                    >
                      {user.status === 'ACTIVE'
                        ? t('admin.users.suspend')
                        : t('admin.users.reactivate')}
                    </button>
                    <button
                      onClick={() =>
                        act(async () => {
                          await api(`/v1/admin/users/${user.id}/sign-out`, {
                            method: 'POST',
                            body: {},
                          });
                          return t('admin.users.signedOut');
                        })
                      }
                    >
                      {t('admin.users.signOut')}
                    </button>
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
