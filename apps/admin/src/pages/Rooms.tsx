import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorNote, Loading, Ok, t, useAction, when } from '../ui';

interface Room {
  id: string;
  code: string;
  phase: string;
  tier: string;
  players: number;
  createdAt: string;
}
interface RoomDetail {
  id: string;
  players: { playerId: string; nickname?: string; status: string; connected?: boolean }[];
}

export function Rooms(): ReactNode {
  const list = useLoad(() => api<{ items: Room[] }>('/v1/admin/rooms'), 'rooms');
  const [open, setOpen] = useState<string | null>(null);
  const action = useAction();
  const detail = useLoad(
    () => (open ? api<RoomDetail>(`/v1/admin/rooms/${open}`) : Promise.resolve(null)),
    open ?? '',
  );
  const close = (id: string): void => {
    void action
      .run(async () => {
        await api(`/v1/admin/rooms/${id}/close`, { method: 'POST', body: {} });
        return t('admin.rooms.closed');
      }, t('admin.rooms.closeConfirm'))
      .then((done) => {
        if (done) list.reload();
      });
  };
  const ban = (roomId: string, playerId: string, kind: 'DEVICE' | 'IP'): void => {
    const reason = window.prompt(t('admin.reasonPlaceholder'));
    if (!reason || reason.trim().length < 3) return;
    void action.run(async () => {
      const result = await api<{ alreadyBanned?: boolean }>(
        `/v1/admin/rooms/${roomId}/players/${playerId}/ban`,
        { method: 'POST', body: { kind, reason: reason.trim() } },
      );
      return result.alreadyBanned ? t('admin.bans.already') : t('admin.bans.created');
    });
  };
  return (
    <>
      <h1>{t('admin.rooms.title')}</h1>
      <p className="muted">{t('admin.rooms.scope')}</p>
      <ErrorNote message={list.error ?? action.error} />
      <Ok message={action.ok} />
      {list.data ? (
        <div className="card table-wrap">
          <table data-testid="room-table">
            <thead>
              <tr>
                <th>{t('admin.rooms.code')}</th>
                <th>{t('admin.rooms.phase')}</th>
                <th>{t('admin.rooms.players')}</th>
                <th>{t('admin.rooms.tier')}</th>
                <th>{t('admin.created')}</th>
                <th>{t('admin.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((room) => (
                <tr key={room.id}>
                  <td>
                    <button onClick={() => setOpen(open === room.id ? null : room.id)}>
                      {room.code}
                    </button>
                  </td>
                  <td>{room.phase}</td>
                  <td>{room.players}</td>
                  <td>{room.tier}</td>
                  <td>{when(room.createdAt)}</td>
                  <td>
                    <button className="danger" onClick={() => close(room.id)}>
                      {t('admin.rooms.close')}
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
      {open && detail.data ? (
        <div className="card table-wrap">
          <table>
            <tbody>
              {detail.data.players.map((player) => (
                <tr key={player.playerId}>
                  <td>{player.nickname ?? player.playerId}</td>
                  <td>{player.status}</td>
                  <td>
                    <button onClick={() => ban(open, player.playerId, 'DEVICE')}>
                      {t('admin.bans.banDevice')}
                    </button>
                    <button onClick={() => ban(open, player.playerId, 'IP')}>
                      {t('admin.bans.banAddress')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
