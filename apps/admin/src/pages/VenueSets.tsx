import type { ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorNote, Loading, Ok, t, useAction, when } from '../ui';

interface SetSummary {
  uploads: {
    id: string;
    fileName: string;
    uploadedAt: string;
    rowsImported: number;
    active: number;
    state: 'ACTIVE' | 'RETIRED';
  }[];
  totals: { active: number; review: number; retired: number };
  categories: { id: string; label: string; active: number }[];
}

/** A venue's own question sets (ADR-0025): counts and the switch that takes a set out of play. */
export function VenueSets({ venueId }: { venueId: string }): ReactNode {
  const sets = useLoad(
    () => api<SetSummary>(`/v1/admin/venues/${venueId}/questions`),
    `venue-sets:${venueId}`,
  );
  const retire = useAction();
  return (
    <div data-testid="venue-sets">
      <h3>{t('admin.venues.sets.title')}</h3>
      <p className="muted">{t('admin.venues.sets.intro')}</p>
      <ErrorNote message={sets.error ?? retire.error} />
      <Ok message={retire.ok} />
      {sets.data ? (
        <>
          <p>{t('admin.venues.sets.totals', sets.data.totals)}</p>
          {sets.data.uploads.length === 0 ? (
            <p className="muted">{t('admin.venues.sets.empty')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('admin.venues.sets.file')}</th>
                    <th>{t('admin.venues.sets.when')}</th>
                    <th>{t('admin.venues.sets.imported')}</th>
                    <th>{t('admin.venues.sets.active')}</th>
                    <th>{t('admin.venues.sets.state')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sets.data.uploads.map((upload) => (
                    <tr key={upload.id}>
                      <td>{upload.fileName}</td>
                      <td>{when(upload.uploadedAt)}</td>
                      <td>{upload.rowsImported}</td>
                      <td>{upload.active}</td>
                      <td>{upload.state}</td>
                      <td>
                        {upload.state === 'ACTIVE' ? (
                          <button
                            disabled={retire.busy}
                            data-testid={`venue-set-retire-${upload.id}`}
                            onClick={() =>
                              void retire
                                .run(
                                  async () => {
                                    const result = await api<{ retired: number }>(
                                      `/v1/admin/venues/${venueId}/questions/uploads/${upload.id}/retire`,
                                      { method: 'POST', body: {} },
                                    );
                                    return t('admin.venues.sets.retired', {
                                      count: result.retired,
                                    });
                                  },
                                  t('admin.venues.sets.retireConfirm', { file: upload.fileName }),
                                )
                                .then((done) => {
                                  if (done) sets.reload();
                                })
                            }
                          >
                            {t('admin.venues.sets.retire')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : sets.loading ? (
        <Loading />
      ) : null}
    </div>
  );
}
