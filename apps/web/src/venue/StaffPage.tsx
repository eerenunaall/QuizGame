import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Wordmark } from '../ui/Wordmark';
import { AccountApiError, type AccountView } from '../lib/account';
import { useI18n } from '../lib/i18n';
import { useLocation } from '../lib/router';
import { SignInForm, useAccount } from '../pages/useAccount';
import { venueApi, type StaffRole, type StaffTable, type VenueSettingsView } from './api';
import { formatLeft, useTicker } from './meter';
import styles from './StaffPage.module.css';

type Tab = 'tables' | 'new' | 'redeem' | 'settings';
type Venue = { id: string; name: string; role: StaffRole };

/** What a refusal means for the person at the counter (never a code or a status number). */
function useRefusal(): (error: unknown) => string {
  const { t } = useI18n();
  return useCallback(
    (error: unknown): string => {
      if (!(error instanceof AccountApiError)) return t('staff.error.generic');
      switch (error.code) {
        case 'RATE_LIMITED':
          return t('staff.error.throttled');
        case 'ROOM_NOT_FOUND':
          return t('staff.error.roomNotFound');
        case 'GAME_IN_PROGRESS':
          return t('staff.error.inGame');
        case 'INVALID_STATE':
          return t('staff.error.busy');
        case 'LIMIT_REACHED':
          return t('staff.error.limit');
        case 'REWARD_ALREADY_REDEEMED':
          return t('error.REWARD_ALREADY_REDEEMED');
        case 'REWARD_EXPIRED':
          return t('error.REWARD_EXPIRED');
        case 'NOT_FOUND':
          return t('staff.redeem.notFound');
        case 'FEATURE_DISABLED':
          return t('staff.disabled');
        default:
          return t('staff.error.generic');
      }
    },
    [t],
  );
}

/**
 * The venue desk (ADR-0024 §7), phone first, Turkish first: the open tables with their time, opening a
 * table on a TV, checking a winner's code and, for the owner, the venue's settings and people. It meters
 * time only: nothing here takes or shows money.
 */
export function StaffPage(): ReactNode {
  const { t } = useI18n();
  const { search } = useLocation();
  const link = useMemo(() => new URLSearchParams(search).get('link'), [search]);
  const { state, signedIn, signOut } = useAccount();
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [tab, setTab] = useState<Tab>(link ? 'new' : 'tables');

  useEffect(() => {
    if (state.kind !== 'in') return;
    venueApi.mine().then(
      (result) => {
        setVenues(result.venues);
        setVenueId((current) => current ?? result.venues[0]?.id ?? null);
      },
      (error: unknown) => {
        if (error instanceof AccountApiError && error.code === 'FEATURE_DISABLED')
          setDisabled(true);
        setVenues([]);
      },
    );
  }, [state]);

  const venue = venues?.find((entry) => entry.id === venueId) ?? null;

  return (
    <div className={styles.page} data-testid="staff-page">
      <Wordmark scale={0.45} />
      <div className={styles.card}>
        <h1 className={styles.title}>{t('staff.title')}</h1>
        {state.kind === 'loading' ? <p>…</p> : null}
        {state.kind === 'out' ? (
          <SignInForm
            intro={t('staff.signin.intro')}
            onSignedIn={(account: AccountView) => signedIn(account)}
          />
        ) : null}
        {state.kind === 'in' && disabled ? <p role="alert">{t('staff.disabled')}</p> : null}
        {state.kind === 'in' && !disabled && venues?.length === 0 ? (
          <p role="alert" data-testid="staff-none">
            {t('staff.none')}
          </p>
        ) : null}
        {state.kind === 'in' && venue ? (
          <>
            {venues && venues.length > 1 ? (
              <label className={styles.field}>
                {t('staff.venue')}
                <select value={venue.id} onChange={(event) => setVenueId(event.target.value)}>
                  {venues.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className={styles.venueName} data-testid="staff-venue">
                {venue.name}
              </p>
            )}
            <nav className={styles.tabs}>
              {(
                [
                  'tables',
                  'new',
                  'redeem',
                  ...(venue.role === 'OWNER' ? ['settings'] : []),
                ] as Tab[]
              ).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={id === tab ? styles.tabOn : styles.tab}
                  onClick={() => setTab(id)}
                  data-testid={`staff-tab-${id}`}
                >
                  {t(`staff.tab.${id}`)}
                </button>
              ))}
            </nav>
            {tab === 'tables' ? <Tables venueId={venue.id} /> : null}
            {tab === 'new' ? (
              <NewTable venueId={venue.id} link={link} onOpened={() => setTab('tables')} />
            ) : null}
            {tab === 'redeem' ? <Redeem venueId={venue.id} /> : null}
            {tab === 'settings' && venue.role === 'OWNER' ? <Settings venueId={venue.id} /> : null}
            <Button variant="ghost" size="md" block onClick={signOut} className={styles.signOut}>
              {t('staff.signOut')}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ───────────── open tables ─────────────

function Tables({ venueId }: { venueId: string }) {
  const { t } = useI18n();
  const refusal = useRefusal();
  const [tables, setTables] = useState<StaffTable[] | null>(null);
  const [steps, setSteps] = useState<number[]>([15, 30, 60]);
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    venueApi.tables(venueId).then(
      (result) => {
        setTables(result.items);
        setSteps(result.steps);
        setOffset(result.serverTime - Date.now());
      },
      (error: unknown) => setMessage(refusal(error)),
    );
  }, [venueId, refusal]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const serverNow = useCallback(() => Date.now() + offset, [offset]);
  const now = useTicker(serverNow, true);

  const act = (work: () => Promise<unknown>): void => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    work()
      .then(load, (error: unknown) => setMessage(refusal(error)))
      .finally(() => setBusy(false));
  };

  const left = (table: StaffTable): number =>
    table.state === 'RUNNING' && table.endsAt !== null
      ? Math.max(0, table.endsAt - now)
      : table.remainingMs;

  if (tables === null) return <p>…</p>;
  const open = tables.filter((table) => table.state !== 'ENDED');
  return (
    <div data-testid="staff-tables">
      <div className={styles.message} role="alert" data-testid="staff-error">
        {message ?? ''}
      </div>
      {open.length === 0 ? <p>{t('staff.tables.empty')}</p> : null}
      {open.map((table) => {
        const ms = left(table);
        const up = ms <= 0;
        const status =
          table.state === 'PAUSED'
            ? t('staff.table.paused', { time: formatLeft(ms) })
            : up
              ? t('staff.table.up')
              : t('staff.table.left', { time: formatLeft(ms) });
        const tone = up ? styles.up : ms <= 5 * 60_000 ? styles.amber : '';
        return (
          <section
            key={table.id}
            className={styles.table}
            data-testid={`staff-table-${table.roomCode}`}
          >
            <header className={styles.tableHead}>
              <strong>{t('staff.table.code', { code: table.roomCode })}</strong>
              <span
                className={`${styles.status} ${tone}`}
                data-testid={`staff-status-${table.roomCode}`}
              >
                {status}
              </span>
            </header>
            {!table.roomLive ? <p className={styles.offline}>{t('staff.table.offline')}</p> : null}
            <div className={styles.row}>
              {steps.map((minutes) => (
                <Button
                  key={minutes}
                  size="md"
                  variant="success"
                  disabled={busy}
                  onClick={() => act(() => venueApi.extend(venueId, table.id, minutes))}
                  data-testid={`staff-extend-${table.roomCode}-${minutes}`}
                >
                  {t('staff.table.extend', { minutes })}
                </Button>
              ))}
            </div>
            <div className={styles.row}>
              {table.state === 'PAUSED' ? (
                <Button
                  size="md"
                  variant="violet"
                  disabled={busy}
                  onClick={() => act(() => venueApi.resume(venueId, table.id))}
                  data-testid={`staff-resume-${table.roomCode}`}
                >
                  {t('staff.table.resume')}
                </Button>
              ) : (
                <Button
                  size="md"
                  variant="violet"
                  disabled={busy || up}
                  onClick={() => act(() => venueApi.pause(venueId, table.id))}
                  data-testid={`staff-pause-${table.roomCode}`}
                >
                  {t('staff.table.pause')}
                </Button>
              )}
              <Button
                size="md"
                variant="danger"
                disabled={busy}
                onClick={() => {
                  if (confirmEnd !== table.id) return setConfirmEnd(table.id);
                  setConfirmEnd(null);
                  act(() => venueApi.end(venueId, table.id));
                }}
                data-testid={`staff-end-${table.roomCode}`}
              >
                {confirmEnd === table.id
                  ? t('staff.table.endConfirm', { code: table.roomCode })
                  : t('staff.table.end')}
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ───────────── a new table ─────────────

function NewTable({
  venueId,
  link,
  onOpened,
}: {
  venueId: string;
  link: string | null;
  onOpened: () => void;
}) {
  const { t } = useI18n();
  const refusal = useRefusal();
  const [minutes, setMinutes] = useState(60);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [useLink, setUseLink] = useState(link !== null);

  useEffect(() => {
    venueApi.tables(venueId).then(
      (result) => setMinutes(result.defaultMinutes),
      () => undefined,
    );
  }, [venueId]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const target = useLink && link ? { link } : { roomCode: code };
    venueApi
      .open(venueId, minutes, target)
      .then(
        (table) => {
          setDone(t('staff.new.opened', { code: table.roomCode, minutes: table.purchasedMinutes }));
          setUseLink(false);
          setCode('');
          setTimeout(onOpened, 1200);
        },
        (error: unknown) => setMessage(refusal(error)),
      )
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} data-testid="staff-new">
      <label className={styles.field}>
        {t('staff.new.minutes')}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={720}
          value={minutes}
          onChange={(event) => setMinutes(Number(event.target.value))}
          data-testid="staff-new-minutes"
        />
      </label>
      <div className={styles.row}>
        {[30, 60, 90, 120].map((value) => (
          <button
            key={value}
            type="button"
            className={value === minutes ? styles.tabOn : styles.tab}
            onClick={() => setMinutes(value)}
          >
            {t('staff.table.extend', { minutes: value }).replace('+', '')}
          </button>
        ))}
      </div>
      {useLink && link ? (
        <p className={styles.ok} data-testid="staff-new-linked">
          {t('staff.new.linked')}
        </p>
      ) : (
        <>
          <label className={styles.field}>
            {t('staff.new.code')}
            <input
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              data-testid="staff-new-code"
            />
          </label>
          <p className={styles.hint}>{t('staff.new.qrHint')}</p>
        </>
      )}
      <div className={styles.message} role="alert" data-testid="staff-error">
        {message ?? ''}
      </div>
      {done ? (
        <p className={styles.ok} role="status" data-testid="staff-new-result">
          {done}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        block
        busy={busy}
        disabled={minutes < 1 || minutes > 720 || (!(useLink && link) && code.length < 6)}
        data-testid="staff-new-open"
      >
        {t('staff.new.open')}
      </Button>
    </form>
  );
}

// ───────────── checking a winner's code ─────────────

function Redeem({ venueId }: { venueId: string }) {
  const { t } = useI18n();
  const refusal = useRefusal();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    venueApi
      .redeem(venueId, code)
      .then(
        (reward) => {
          setResult({
            ok: true,
            text: t('staff.redeem.ok', { winner: reward.winner, text: reward.text }),
          });
          setCode('');
        },
        (error: unknown) => setResult({ ok: false, text: refusal(error) }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} data-testid="staff-redeem">
      <label className={styles.field}>
        {t('staff.redeem.code')}
        <input
          className={styles.codeInput}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={9}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          data-testid="staff-redeem-code"
        />
      </label>
      {result ? (
        <p
          className={result.ok ? styles.ok : styles.message}
          role="status"
          data-testid="staff-redeem-result"
          data-ok={result.ok ? '1' : '0'}
        >
          {result.text}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        block
        busy={busy}
        disabled={code.replace(/[\s-]/gu, '').length !== 8}
        data-testid="staff-redeem-submit"
      >
        {t('staff.redeem.check')}
      </Button>
    </form>
  );
}

// ───────────── the owner's settings and people ─────────────

function Settings({ venueId }: { venueId: string }) {
  const { t } = useI18n();
  const refusal = useRefusal();
  const [settings, setSettings] = useState<VenueSettingsView | null>(null);
  const [steps, setSteps] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [people, setPeople] = useState<
    { accountId: string; email: string | null; role: StaffRole }[]
  >([]);
  const [email, setEmail] = useState('');

  const loadPeople = useCallback(() => {
    venueApi.staff(venueId).then(
      (result) => setPeople(result.staff),
      () => undefined,
    );
  }, [venueId]);
  useEffect(() => {
    venueApi.settings(venueId).then(
      (result) => {
        setSettings(result.settings);
        setSteps(result.settings.extendSteps.join(', '));
      },
      (error: unknown) => setMessage(refusal(error)),
    );
    loadPeople();
  }, [venueId, refusal, loadPeople]);

  if (!settings) return <p>…</p>;
  const reward = settings.reward;
  const setReward = (change: Partial<VenueSettingsView['reward']>): void =>
    setSettings({ ...settings, reward: { ...reward, ...change } });
  const number = (value: string): number => Number.parseInt(value, 10) || 0;

  const save = (event: FormEvent): void => {
    event.preventDefault();
    setMessage(null);
    const parsedSteps = steps
      .split(/[,\s]+/u)
      .map(number)
      .filter((n) => n > 0);
    venueApi
      .saveSettings(venueId, {
        reward,
        defaultMinutes: settings.defaultMinutes,
        extendSteps: parsedSteps,
      })
      .then(
        (result) => {
          setSettings(result.settings);
          setMessage(t('staff.settings.saved'));
        },
        () => setMessage(t('staff.settings.invalid')),
      );
  };

  const invite = (event: FormEvent): void => {
    event.preventDefault();
    venueApi.invite(venueId, email).then(
      () => {
        setEmail('');
        loadPeople();
      },
      (error: unknown) => setMessage(refusal(error)),
    );
  };

  return (
    <div data-testid="staff-settings">
      <form onSubmit={save}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={reward.enabled}
            onChange={(event) => setReward({ enabled: event.target.checked })}
            data-testid="staff-settings-reward"
          />
          {t('staff.settings.reward')}
        </label>
        <label className={styles.field}>
          {t('staff.settings.rewardText')}
          <input
            maxLength={120}
            value={reward.text}
            onChange={(event) => setReward({ text: event.target.value })}
            data-testid="staff-settings-reward-text"
          />
        </label>
        <div className={styles.grid}>
          <label className={styles.field}>
            {t('staff.settings.minPlayers')}
            <input
              type="number"
              min={2}
              max={8}
              value={reward.minPlayers}
              onChange={(event) => setReward({ minPlayers: number(event.target.value) })}
            />
          </label>
          <label className={styles.field}>
            {t('staff.settings.maxPerDay')}
            <input
              type="number"
              min={0}
              max={500}
              value={reward.maxPerDay}
              onChange={(event) => setReward({ maxPerDay: number(event.target.value) })}
            />
          </label>
          <label className={styles.field}>
            {t('staff.settings.cooldown')}
            <input
              type="number"
              min={0}
              max={240}
              value={reward.rematchCooldownMinutes}
              onChange={(event) =>
                setReward({ rematchCooldownMinutes: number(event.target.value) })
              }
            />
          </label>
          <label className={styles.field}>
            {t('staff.settings.defaultMinutes')}
            <input
              type="number"
              min={5}
              max={720}
              value={settings.defaultMinutes}
              onChange={(event) =>
                setSettings({ ...settings, defaultMinutes: number(event.target.value) })
              }
            />
          </label>
        </div>
        <label className={styles.field}>
          {t('staff.settings.steps')}
          <input value={steps} onChange={(event) => setSteps(event.target.value)} />
        </label>
        <div className={styles.message} role="status" data-testid="staff-settings-message">
          {message ?? ''}
        </div>
        <Button type="submit" size="md" block data-testid="staff-settings-save">
          {t('staff.settings.save')}
        </Button>
      </form>

      <h2 className={styles.subtitle}>{t('staff.people.title')}</h2>
      <ul className={styles.people}>
        {people.map((member) => (
          <li key={member.accountId}>
            <span>
              {member.email} · {t(`staff.people.${member.role}`)}
            </span>
            {member.role === 'STAFF' ? (
              <button
                type="button"
                className={styles.tab}
                onClick={() => {
                  venueApi
                    .remove(venueId, member.accountId)
                    .then(loadPeople, (error: unknown) => setMessage(refusal(error)));
                }}
              >
                {t('staff.people.remove')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <form onSubmit={invite}>
        <label className={styles.field}>
          {t('staff.people.invite')}
          <input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <p className={styles.hint}>{t('staff.people.hint')}</p>
        <Button type="submit" size="md" variant="violet" block disabled={email.length < 3}>
          {t('staff.people.add')}
        </Button>
      </form>
    </div>
  );
}
