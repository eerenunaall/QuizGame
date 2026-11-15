import type { ReactNode } from 'react';
import { api } from '../api';
import { useCategories, type CategoryRow } from '../categories';
import { ErrorNote, Loading, t, useAction } from '../ui';

export function Categories(): ReactNode {
  const list = useCategories();
  const action = useAction();
  const toggle = (row: CategoryRow, field: 'enabled' | 'freeRotation' | 'sourceRequired'): void => {
    void action
      .run(async () => {
        await api(`/v1/admin/categories/${row.id}`, {
          method: 'PATCH',
          body: { [field]: !row[field] },
        });
      })
      .then((done) => {
        if (done) list.reload();
      });
  };
  return (
    <>
      <h1>{t('admin.categories.title')}</h1>
      <ErrorNote message={list.error ?? action.error} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="category-table">
            <thead>
              <tr>
                <th>{t('admin.questions.category')}</th>
                <th>{t('admin.categories.enabled')}</th>
                <th>{t('admin.categories.free')}</th>
                <th>{t('admin.categories.sourceRequired')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.labelTr}
                    <div className="muted">
                      {t('admin.categories.counts', {
                        active: row.questions.active,
                        review: row.questions.review,
                        total: row.questions.total,
                      })}
                    </div>
                  </td>
                  {(['enabled', 'freeRotation', 'sourceRequired'] as const).map((field) => (
                    <td key={field}>
                      <input
                        type="checkbox"
                        data-testid={`category-${row.id}-${field}`}
                        aria-label={`${row.labelTr}`}
                        checked={row[field]}
                        disabled={action.busy}
                        onChange={() => toggle(row, field)}
                      />
                    </td>
                  ))}
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
