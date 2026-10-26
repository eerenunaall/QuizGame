import { useState, type FormEvent, type ReactNode } from 'react';
import { api, apiText } from '../api';
import { go, useLoad } from '../hooks';
import { ErrorNote, Loading, Ok, t, useAction, when } from '../ui';
import { VenueSets } from './VenueSets';

interface VenueRow {
  id: string;
  name: string;
  createdAt: string;
  owners: string[];
  staff: number;
  openTables: number;
}

interface ReportDay {
  date: string;
  sessions: number;
  minutesSold: number;
  extensions: number;
  rewardsIssued: number;
  rewardsRedeemed: number;
}

/** Venue mode (ADR-0024): venues and their owners, and the per-day table report (counts only). */
export function Venues({ id }: { id: string | undefined }): ReactNode {
  const list = useLoad(() => api<{ items: VenueRow[] }>('/v1/admin/venues'), 'venues');
  const creating = useAction();
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const selected = list.data?.items.find((venue) => venue.id === id) ?? null;

  const create = (event: FormEvent): void => {
    event.preventDefault();
    void creating
      .run(async () => {
        await api('/v1/admin/venues', { method: 'POST', body: { name, ownerEmail } });
        setName('');
        setOwnerEmail('');
        return t('admin.venues.created');
      })
      .then((done) => {
        if (done) list.reload();
      });
  };

  return (
    <>
      <h1>{t('admin.venues.title')}</h1>
      <p className="muted">{t('admin.venues.intro')}</p>
      <ErrorNote message={list.error} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="venue-table">
            <thead>
              <tr>
                <th>{t('admin.venues.name')}</th>
                <th>{t('admin.venues.owners')}</th>
                <th>{t('admin.venues.staff')}</th>
                <th>{t('admin.venues.openTables')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((venue) => (
                <tr key={venue.id}>
                  <td>
                    {venue.name}
                    <div className="muted">{when(venue.createdAt)}</div>
                  </td>
                  <td>{venue.owners.join(', ')}</td>
                  <td>{venue.staff}</td>
                  <td>{venue.openTables}</td>
                  <td>
                    <button
                      onClick={() => go(`venues/${venue.id}`)}
                      data-testid={`venue-${venue.id}`}
                    >
                      {t('admin.venues.report')}
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

      {selected ? <VenueDetail venue={selected} onChanged={list.reload} /> : null}

      <form className="card" onSubmit={create} data-testid="venue-create">
        <h2>{t('admin.venues.create')}</h2>
        <label>
          {t('admin.venues.name')}
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('admin.venues.ownerEmail')}
          <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
        </label>
        <ErrorNote message={creating.error} />
        <Ok message={creating.ok} />
        <button className="primary" disabled={creating.busy || !name || !ownerEmail}>
          {t('admin.venues.create')}
        </button>
      </form>
    </>
  );
}

function VenueDetail({ venue, onChanged }: { venue: VenueRow; onChanged: () => void }): ReactNode {
  // No dates at first: the server answers the last 30 days of the venue's own calendar (its time zone;
  // this browser's UTC "today" would drop everything after the café's midnight) and says which.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState({ from, to });
  const report = useLoad(
    () =>
      api<{ from: string; to: string; days: ReportDay[] }>(`/v1/admin/venues/${venue.id}/report`, {
        query: { from: range.from, to: range.to },
      }),
    `venue-report:${venue.id}:${range.from}:${range.to}`,
  );
  const shownFrom = from || report.data?.from || '';
  const shownTo = to || report.data?.to || '';
  const download = useAction();
  const owner = useAction();
  const [newOwner, setNewOwner] = useState('');

  const days = report.data?.days ?? [];
  const total = days.reduce(
    (sum, d) => ({
      sessions: sum.sessions + d.sessions,
      minutesSold: sum.minutesSold + d.minutesSold,
      extensions: sum.extensions + d.extensions,
      rewardsIssued: sum.rewardsIssued + d.rewardsIssued,
      rewardsRedeemed: sum.rewardsRedeemed + d.rewardsRedeemed,
    }),
    { sessions: 0, minutesSold: 0, extensions: 0, rewardsIssued: 0, rewardsRedeemed: 0 },
  );

  return (
    <div className="card" data-testid="venue-detail">
      <h2>
        {venue.name} · {t('admin.venues.report')}
      </h2>
      <p className="muted">{t('admin.venues.privacy')}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setRange({ from: shownFrom, to: shownTo });
        }}
      >
        <label>
          {t('admin.venues.from')}
          <input type="date" value={shownFrom} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t('admin.venues.to')}
          <input type="date" value={shownTo} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button>{t('admin.venues.show')}</button>
        <button
          type="button"
          disabled={download.busy}
          data-testid="venue-csv"
          onClick={() =>
            void download.run(async () => {
              const days = { from: range.from || shownFrom, to: range.to || shownTo };
              const body = await apiText(`/v1/admin/venues/${venue.id}/report`, {
                ...days,
                format: 'csv',
              });
              const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = `venue-report-${days.from}-${days.to}.csv`;
              link.click();
              URL.revokeObjectURL(url);
            })
          }
        >
          {t('admin.venues.csv')}
        </button>
      </form>
      <ErrorNote message={report.error ?? download.error} />
      {report.data ? (
        <div className="table-wrap">
          <table data-testid="venue-report">
            <thead>
              <tr>
                <th>{t('admin.venues.col.date')}</th>
                <th>{t('admin.venues.col.sessions')}</th>
                <th>{t('admin.venues.col.minutes')}</th>
                <th>{t('admin.venues.col.extensions')}</th>
                <th>{t('admin.venues.col.issued')}</th>
                <th>{t('admin.venues.col.redeemed')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{d.sessions}</td>
                  <td>{d.minutesSold}</td>
                  <td>{d.extensions}</td>
                  <td>{d.rewardsIssued}</td>
                  <td>{d.rewardsRedeemed}</td>
                </tr>
              ))}
              <tr>
                <th>{t('admin.venues.total')}</th>
                <th>{total.sessions}</th>
                <th>{total.minutesSold}</th>
                <th>{total.extensions}</th>
                <th>{total.rewardsIssued}</th>
                <th>{total.rewardsRedeemed}</th>
              </tr>
            </tbody>
          </table>
        </div>
      ) : report.loading ? (
        <Loading />
      ) : null}

      <VenueSets venueId={venue.id} />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void owner
            .run(
              async () => {
                await api(`/v1/admin/venues/${venue.id}/owner`, {
                  method: 'POST',
                  body: { email: newOwner },
                });
                setNewOwner('');
                return t('admin.venues.ownerChanged');
              },
              `${venue.name}: ${t('admin.venues.changeOwner')}?`,
            )
            .then((done) => {
              if (done) onChanged();
            });
        }}
      >
        <h3>{t('admin.venues.changeOwner')}</h3>
        <label>
          {t('admin.venues.newOwner')}
          <input type="email" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} />
        </label>
        <ErrorNote message={owner.error} />
        <Ok message={owner.ok} />
        <button disabled={owner.busy || !newOwner}>{t('admin.venues.changeOwner')}</button>
      </form>
    </div>
  );
}
