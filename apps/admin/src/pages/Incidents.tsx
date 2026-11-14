import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { Badge, ErrorNote, Loading, Ok, label, t, useAction, when } from '../ui';

interface Incident {
  id: string;
  title: string;
  severity: string;
  status: string;
  summary: string;
  createdAt: string;
}
interface Detail {
  incident: Incident;
  notes: { id: number; at: string; body: string }[];
}
const STATUSES = ['OPEN', 'MITIGATED', 'RESOLVED'];

export function Incidents(): ReactNode {
  const list = useLoad(() => api<{ items: Incident[] }>('/v1/admin/incidents'), 'incidents');
  const [open, setOpen] = useState<string | null>(null);
  const detail = useLoad(
    () => (open ? api<Detail>(`/v1/admin/incidents/${open}`) : Promise.resolve(null)),
    open ?? '',
  );
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('MEDIUM');
  const [summary, setSummary] = useState('');
  const [note, setNote] = useState('');
  const action = useAction();

  const create = (event: FormEvent): void => {
    event.preventDefault();
    void action
      .run(async () => {
        await api('/v1/admin/incidents', { method: 'POST', body: { title, severity, summary } });
        setTitle('');
        setSummary('');
      })
      .then((done) => {
        if (done) list.reload();
      });
  };
  const patchStatus = (id: string, status: string): void => {
    void action
      .run(async () => {
        await api(`/v1/admin/incidents/${id}`, { method: 'PATCH', body: { status } });
      })
      .then((done) => {
        if (done) {
          list.reload();
          detail.reload();
        }
      });
  };
  const addNote = (event: FormEvent): void => {
    event.preventDefault();
    if (!open) return;
    void action
      .run(async () => {
        await api(`/v1/admin/incidents/${open}/notes`, { method: 'POST', body: { body: note } });
        setNote('');
      })
      .then((done) => {
        if (done) detail.reload();
      });
  };

  return (
    <>
      <h1>{t('admin.incidents.title')}</h1>
      <form className="card stack" onSubmit={create}>
        <h2>{t('admin.incidents.new')}</h2>
        <div className="row">
          <label>
            {t('admin.incidents.titleField')}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={3}
            />
          </label>
          <label>
            {t('admin.incidents.severity')}
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
                <option key={s} value={s}>
                  {label('admin.incidents.severity', s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {t('admin.incidents.summary')}
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <div>
          <button className="primary" disabled={action.busy}>
            {t('admin.save')}
          </button>
        </div>
      </form>
      <ErrorNote message={list.error ?? action.error} />
      <Ok message={action.ok} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="incident-table">
            <tbody>
              {list.data.items.map((incident) => (
                <tr key={incident.id}>
                  <td>
                    <button onClick={() => setOpen(open === incident.id ? null : incident.id)}>
                      {incident.title}
                    </button>
                    <div className="muted">{when(incident.createdAt)}</div>
                  </td>
                  <td>
                    <Badge
                      tone={
                        incident.severity === 'CRITICAL' || incident.severity === 'HIGH'
                          ? 'bad'
                          : 'warn'
                      }
                    >
                      {label('admin.incidents.severity', incident.severity)}
                    </Badge>
                  </td>
                  <td>
                    <select
                      aria-label={incident.title}
                      value={incident.status}
                      disabled={action.busy}
                      onChange={(e) => patchStatus(incident.id, e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {label('admin.incidents.status', s)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : list.loading ? (
        <Loading />
      ) : null}
      {open && detail.data ? (
        <div className="card stack">
          <pre>{detail.data.incident.summary}</pre>
          <h2>{t('admin.incidents.notes')}</h2>
          {detail.data.notes.map((n) => (
            <div key={n.id}>
              <span className="muted">{when(n.at)}</span> {n.body}
            </div>
          ))}
          <form className="row" onSubmit={addNote}>
            <input value={note} onChange={(e) => setNote(e.target.value)} required />
            <button disabled={action.busy}>{t('admin.incidents.addNote')}</button>
          </form>
        </div>
      ) : null}
    </>
  );
}
