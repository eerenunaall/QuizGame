import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { AccountApiError } from '../lib/account';
import { useI18n } from '../lib/i18n';
import { displaysApi, type DisplayItem } from './displaysApi';
import type { StaffRole } from './api';
import staff from './StaffPage.module.css';

/**
 * The panel's "TV'ler" tab (ADR-0028 §2-4): the venue's paired screens with their state, "TV ekle" with
 * the code shown on a TV (the QR opens this tab with the code filled in), "Bu TV'de oyun aç" and
 * "Kaldır". Only the owner adds and removes; staff may open a game.
 */
export function DisplayPanel({
  venueId,
  role,
  initialCode,
}: {
  venueId: string;
  role: StaffRole;
  initialCode: string | null;
}): ReactNode {
  const { t } = useI18n();
  const [items, setItems] = useState<DisplayItem[] | null>(null);
  const [seats, setSeats] = useState(0);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [code, setCode] = useState(initialCode ?? '');
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const owner = role === 'OWNER';

  const refusal = useCallback(
    (error: unknown): string => {
      if (!(error instanceof AccountApiError)) return t('displays.error.generic');
      if (error.code === 'NOT_FOUND') return t('displays.error.notFound');
      if (error.code === 'LIMIT_REACHED')
        return t('displays.error.limit', { seats: error.params?.seats ?? seats });
      if (error.code === 'FORBIDDEN') return t('displays.error.owner');
      if (error.code === 'GAME_IN_PROGRESS') return t('displays.error.inGame');
      if (error.code === 'INVALID_STATE')
        return error.params?.reason === 'offline'
          ? t('displays.error.offline')
          : t('displays.error.busy');
      return t('displays.error.generic');
    },
    [t, seats],
  );

  const load = useCallback(() => {
    displaysApi.list(venueId).then(
      (result) => {
        setItems(result.items);
        setSeats(result.seats);
      },
      (error: unknown) => setMessage({ tone: 'error', text: refusal(error) }),
    );
  }, [venueId, refusal]);
  useEffect(() => {
    load();
    // "Online" is a few seconds old at most.
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const pair = (event: FormEvent): void => {
    event.preventDefault();
    displaysApi.pair(venueId, code, name).then(
      () => {
        setCode('');
        setName('');
        setMessage({ tone: 'ok', text: t('displays.paired') });
        load();
      },
      (error: unknown) => setMessage({ tone: 'error', text: refusal(error) }),
    );
  };

  if (items === null) return <p>{message?.text ?? '…'}</p>;
  return (
    <div data-testid="displays">
      <p className={staff.hint}>{t('displays.intro')}</p>
      <p data-testid="displays-seats">{t('displays.seats', { used: items.length, seats })}</p>
      <div
        className={message?.tone === 'ok' ? staff.ok : staff.message}
        role="alert"
        data-testid="displays-message"
      >
        {message?.text ?? ''}
      </div>
      {items.length === 0 ? <p>{t('displays.empty')}</p> : null}
      {items.map((item) => (
        <div key={item.id} className={staff.table} data-testid={`display-${item.name}`}>
          <header className={staff.tableHead}>
            <strong>{item.name}</strong>
            <span className={item.online ? staff.status : staff.offline}>
              {item.online ? t('displays.online') : t('displays.offline')}
            </span>
          </header>
          <div className={staff.row}>
            <Button
              size="md"
              disabled={!item.online}
              onClick={() =>
                displaysApi.open(venueId, item.id).then(
                  (result) => {
                    setMessage({
                      tone: 'ok',
                      text: t('displays.opened', { code: result.roomCode }),
                    });
                    load();
                  },
                  (error: unknown) => setMessage({ tone: 'error', text: refusal(error) }),
                )
              }
              data-testid={`display-open-${item.name}`}
            >
              {t('displays.open')}
            </Button>
            {owner ? (
              <Button
                size="md"
                variant="danger"
                onClick={() => {
                  if (confirm !== item.id) return setConfirm(item.id);
                  setConfirm(null);
                  displaysApi.remove(venueId, item.id).then(
                    () => {
                      setMessage({ tone: 'ok', text: t('displays.removed') });
                      load();
                    },
                    (error: unknown) => setMessage({ tone: 'error', text: refusal(error) }),
                  );
                }}
                data-testid={`display-remove-${item.name}`}
              >
                {confirm === item.id ? t('displays.removeConfirm') : t('displays.remove')}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      {owner ? (
        <form onSubmit={pair} data-testid="display-add">
          <h2 className={staff.subtitle}>{t('displays.add')}</h2>
          <label className={staff.field}>
            {t('displays.code')}
            <input
              className={staff.codeInput}
              value={code}
              maxLength={20}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(event) => setCode(event.target.value)}
              data-testid="display-code"
            />
          </label>
          <label className={staff.field}>
            {t('displays.name')}
            <input
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              data-testid="display-name"
            />
          </label>
          <Button type="submit" size="lg" block disabled={!code.trim() || !name.trim()}>
            {t('displays.pairNow')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
