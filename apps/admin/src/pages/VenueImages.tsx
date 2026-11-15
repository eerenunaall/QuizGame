import type { ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorNote, Loading, Ok, t, useAction, when } from '../ui';

interface ImageRow {
  hash: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
}

/**
 * A venue's logo and team marks (ADR-0030 §4): metadata and a small preview from the public image
 * address, and the switch that removes one. The console never sees an upload form; removal is audited.
 */
export function VenueImages({ venueId }: { venueId: string }): ReactNode {
  const images = useLoad(
    () => api<{ assets: ImageRow[] }>(`/v1/admin/venues/${venueId}/assets`),
    `venue-images:${venueId}`,
  );
  const remove = useAction();
  return (
    <div data-testid="venue-images">
      <h3>{t('admin.venues.images.title')}</h3>
      <p className="muted">{t('admin.venues.images.intro')}</p>
      <ErrorNote message={images.error ?? remove.error} />
      <Ok message={remove.ok} />
      {images.data ? (
        images.data.assets.length === 0 ? (
          <p className="muted">{t('admin.venues.images.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('admin.venues.images.preview')}</th>
                  <th>{t('admin.venues.images.size')}</th>
                  <th>{t('admin.venues.images.when')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {images.data.assets.map((image) => (
                  <tr key={image.hash}>
                    <td>
                      <img
                        src={`/v1/venue-assets/${venueId}/${image.hash}`}
                        alt=""
                        style={{ maxWidth: 96, maxHeight: 48, objectFit: 'contain' }}
                      />
                    </td>
                    <td>
                      {image.width}×{image.height} · {Math.ceil(image.bytes / 1024)} KB
                    </td>
                    <td>{when(image.createdAt)}</td>
                    <td>
                      <button
                        disabled={remove.busy}
                        data-testid={`venue-image-remove-${image.hash.slice(0, 8)}`}
                        onClick={() =>
                          void remove
                            .run(async () => {
                              await api(`/v1/admin/venues/${venueId}/assets/${image.hash}/remove`, {
                                method: 'POST',
                                body: {},
                              });
                              return t('admin.venues.images.removed');
                            }, t('admin.venues.images.removeConfirm'))
                            .then((done) => {
                              if (done) images.reload();
                            })
                        }
                      >
                        {t('admin.venues.images.remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : images.loading ? (
        <Loading />
      ) : null}
    </div>
  );
}
