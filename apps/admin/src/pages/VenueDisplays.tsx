import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorNote, Loading, Ok, t, useAction, when } from '../ui';

interface DisplayList {
  seats: number;
  items: {
    id: string;
    name: string;
    lastSeenAt: number | null;
    online: boolean;
    revokedAt: number | null;
    revokeReason: string | null;
  }[];
}

/** A venue's paired TVs and its licence seats (ADR-0028 §5): see them, remove one, change the seat count. */
export function VenueDisplays({ venueId }: { venueId: string }): ReactNode {
  const list = useLoad(
    () => api<DisplayList>(`/v1/admin/venues/${venueId}/displays`),
    `venue-displays:${venueId}`,
  );
  const act = useAction();
  const [seats, setSeats] = useState('');
  const shownSeats = seats || String(list.data?.seats ?? '');
  return (
    <div data-testid="venue-displays">
      <h3>{t('admin.venues.displays.title')}</h3>
      <p className="muted">{t('admin.venues.displays.intro')}</p>
      <ErrorNote message={list.error ?? act.error} />
      <Ok message={act.ok} />
      {list.data ? (
        <>
          {list.data.items.length === 0 ? (
            <p className="muted">{t('admin.venues.displays.empty')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('admin.venues.displays.name')}</th>
                    <th>{t('admin.venues.displays.lastSeen')}</th>
                    <th>{t('admin.venues.displays.state')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>
                        {item.lastSeenAt ? when(new Date(item.lastSeenAt).toISOString()) : '-'}
                      </td>
                      <td>
                        {item.revokedAt
                          ? t('admin.venues.displays.revoked', { reason: item.revokeReason ?? '' })
                          : t('admin.venues.displays.active')}
                      </td>
                      <td>
                        {item.revokedAt ? null : (
                          <button
                            data-testid={`display-revoke-${item.name}`}
                            disabled={act.busy}
                            onClick={() =>
                              void act
                                .run(
                                  async () => {
                                    await api(
                                      `/v1/admin/venues/${venueId}/displays/${item.id}/revoke`,
                                      { method: 'POST', body: {} },
                                    );
                                    return t('admin.venues.displays.revokedDone');
                                  },
                                  t('admin.venues.displays.revokeConfirm', { name: item.name }),
                                )
                                .then((done) => {
                                  if (done) list.reload();
                                })
                            }
                          >
                            {t('admin.venues.displays.revoke')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act
                .run(async () => {
                  await api(`/v1/admin/venues/${venueId}/seats`, {
                    method: 'POST',
                    body: { seats: Number(shownSeats) },
                  });
                  return t('admin.venues.displays.seatsSaved');
                })
                .then((done) => {
                  if (done) list.reload();
                });
            }}
          >
            <label>
              {t('admin.venues.displays.seats')}
              <input
                type="number"
                min={0}
                max={50}
                value={shownSeats}
                onChange={(event) => setSeats(event.target.value)}
                data-testid="venue-seats"
              />
            </label>
            <button disabled={act.busy || shownSeats === ''}>
              {t('admin.venues.displays.saveSeats')}
            </button>
          </form>
        </>
      ) : list.loading ? (
        <Loading />
      ) : null}
    </div>
  );
}
