import type { ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorNote, Loading, label, t } from '../ui';

interface Stats {
  questions: Record<string, number>;
  activeByCategory: Record<string, number>;
  openReports: number;
  rooms: { held: number; players: number; byStatus: Record<string, number> };
}

export function Dashboard(): ReactNode {
  const stats = useLoad(() => api<Stats>('/v1/admin/stats'), 'stats');
  const data = stats.data;
  return (
    <>
      <h1>{t('admin.nav.dashboard')}</h1>
      <ErrorNote message={stats.error} />
      {data ? (
        <>
          <div className="card">
            <h2>{t('admin.dashboard.questions')}</h2>
            <p>
              {Object.entries(data.questions).map(([status, n]) => (
                <span className="badge" key={status}>
                  {label('admin.status', status)}: {n}
                </span>
              ))}
            </p>
          </div>
          <div className="card">
            <h2>{t('admin.dashboard.openReports')}</h2>
            <p data-testid="open-reports">
              <a href="#/reports">{data.openReports}</a>
            </p>
            <a href="#/queue">{t('admin.dashboard.review')}</a>
          </div>
          <div className="card">
            <h2>{t('admin.dashboard.rooms')}</h2>
            <p>
              {data.rooms.held} · {data.rooms.players} {t('admin.dashboard.players')}
            </p>
          </div>
          <div className="card">
            <h2>{t('admin.dashboard.activeByCategory')}</h2>
            <p>
              {Object.entries(data.activeByCategory).map(([category, n]) => (
                <span className="badge" key={category}>
                  {category}: {n}
                </span>
              ))}
            </p>
          </div>
        </>
      ) : stats.loading ? (
        <Loading />
      ) : null}
    </>
  );
}
