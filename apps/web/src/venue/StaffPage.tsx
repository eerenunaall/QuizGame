import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button } from '../ui/Button';
import { AccountApiError, type AccountView } from '../lib/account';
import { useI18n } from '../lib/i18n';
import { useLocation } from '../lib/router';
import { SignInForm, useAccount } from '../pages/useAccount';
import { assetUrl } from './assetsApi';
import { venueApi, type StaffRole, type StaffTable } from './api';
import { formatLeft, useTicker } from './meter';
import { VenueQuestions } from './VenueQuestions';
import { DisplayPanel } from './DisplayPanel';
import { QuestionStudio } from './QuestionStudio';
import { LookPanel } from './LookPanel';
import { EntrancePanel, PeoplePanel, PlayPanel, RewardPanel } from './OwnerPanels';
import { PanelProvider, usePanel } from './PanelStore';
import { PanelIcon } from './PanelIcon';
import { tabsFor, type TabId } from './tabs';
import styles from './StaffPage.module.css';

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

/** Lets "Ana ekrana ekle" install the panel on its own address, without touching the game pages. */
function useManifest(): void {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/mekan.webmanifest';
    document.head.append(link);
    return () => link.remove();
  }, []);
}

/**
 * The venue panel (ADR-0024 §7, ADR-0030): `/staff` and `/mekan`, phone first, Turkish first. The page is
 * dressed from the venue's own settings (theme, accent, name, logo), never from a built-in brand. It
 * meters time and shows texts only: nothing here takes or shows money. Which sections exist is the `TABS`
 * list in `tabs.ts`; this shell only signs in, picks the venue and shows the chosen section.
 */
export function StaffPage(): ReactNode {
  const { t } = useI18n();
  const { search } = useLocation();
  useManifest();
  const link = useMemo(() => new URLSearchParams(search).get('link'), [search]);
  const { state, signedIn, signOut } = useAccount();
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  // A TV's pairing QR opens the panel with its code (ADR-0028 §2).
  const pairCode = useMemo(() => new URLSearchParams(search).get('pair'), [search]);
  const [tab, setTab] = useState<TabId>(pairCode ? 'displays' : link ? 'new' : 'tables');

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
      <div className={styles.card}>
        {state.kind === 'loading' ? <p>…</p> : null}
        {state.kind === 'out' ? (
          <>
            <h1 className={styles.title}>{t('staff.title')}</h1>
            <SignInForm
              intro={t('staff.signin.intro')}
              onSignedIn={(account: AccountView) => signedIn(account)}
            />
          </>
        ) : null}
        {state.kind === 'in' && disabled ? <p role="alert">{t('staff.disabled')}</p> : null}
        {state.kind === 'in' && !disabled && venues?.length === 0 ? (
          <p role="alert" data-testid="staff-none">
            {t('staff.none')}
          </p>
        ) : null}
        {state.kind === 'in' && venue ? (
          <PanelProvider venueId={venue.id} key={venue.id}>
            <Shell
              venue={venue}
              venues={venues ?? []}
              onVenue={setVenueId}
              tab={tab}
              onTab={setTab}
              link={link}
              pairCode={pairCode}
              onSignOut={signOut}
            />
          </PanelProvider>
        ) : null}
      </div>
    </div>
  );
}

/** Venue header (its own logo and name), the tab bar and the chosen section. */
function Shell({
  venue,
  venues,
  onVenue,
  tab,
  onTab,
  link,
  pairCode,
  onSignOut,
}: {
  venue: Venue;
  venues: Venue[];
  onVenue: (id: string) => void;
  tab: TabId;
  onTab: (tab: TabId) => void;
  link: string | null;
  pairCode: string | null;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const { settings } = usePanel();
  const tabs = tabsFor(venue.role);
  const logo = settings?.look?.logo;
  const owner = venue.role === 'OWNER';
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The bar scrolls sideways on a phone: keep the chosen button in view.
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [tab]);

  const panels: Record<TabId, ReactNode> = {
    tables: <Tables venueId={venue.id} />,
    new: <NewTable venueId={venue.id} link={link} onOpened={() => onTab('tables')} />,
    redeem: <Redeem venueId={venue.id} />,
    displays: <DisplayPanel venueId={venue.id} role={venue.role} initialCode={pairCode} />,
    reward: <RewardPanel />,
    entrance: <EntrancePanel />,
    look: <LookPanel venueName={venue.name} />,
    play: <PlayPanel />,
    questions: <VenueQuestions venueId={venue.id} role={venue.role} />,
    studio: <QuestionStudio venueId={venue.id} />,
    people: <PeoplePanel venueId={venue.id} />,
  };
  const allowed = tabs.some((entry) => entry.id === tab) ? tab : 'tables';

  return (
    <>
      <header className={styles.header} data-testid="panel-header">
        {logo ? (
          <img
            className={styles.headerLogo}
            src={assetUrl(venue.id, logo)}
            alt=""
            data-testid="panel-logo"
          />
        ) : null}
        <div className={styles.headerText}>
          {venues.length > 1 ? (
            <select
              className={styles.venueSelect}
              value={venue.id}
              aria-label={t('staff.venue')}
              onChange={(event) => onVenue(event.target.value)}
            >
              {venues.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          ) : (
            <h1 className={styles.venueTitle} data-testid="staff-venue">
              {venue.name}
            </h1>
          )}
          <p className={styles.venueSub}>
            {t('panel.signedInAs')} · {t(`staff.people.${venue.role}`)}
          </p>
        </div>
      </header>
      <nav className={styles.tabs} aria-label={t('panel.nav')} data-testid="panel-tabs">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            ref={entry.id === allowed ? activeRef : undefined}
            type="button"
            className={entry.id === allowed ? styles.tabOn : styles.tab}
            aria-current={entry.id === allowed ? 'page' : undefined}
            onClick={() => onTab(entry.id as TabId)}
            data-testid={`staff-tab-${entry.id}`}
          >
            <PanelIcon name={entry.icon} />
            <span>{t(entry.label)}</span>
          </button>
        ))}
      </nav>
      <div className={styles.body} key={allowed}>
        {panels[allowed]}
      </div>
      {owner ? <p className={styles.install}>{t('panel.install')}</p> : null}
      <Button variant="ghost" size="md" block onClick={onSignOut} className={styles.signOut}>
        {t('staff.signOut')}
      </Button>
    </>
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
  // The venue's default arrives asynchronously; it must never overwrite what the waiter already chose
  // (a slow answer used to reset a typed "2" or a tapped preset to the default, opening the wrong table).
  const chosen = useRef(false);
  const pickMinutes = (value: number): void => {
    chosen.current = true;
    setMinutes(value);
  };
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [useLink, setUseLink] = useState(link !== null);
  // The "opened" hand-over to the tables tab must never fire after the person went to another tab
  // (it once pulled them back to Masalar), so the timer is cleared when this form goes away.
  const handOver = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (handOver.current) clearTimeout(handOver.current);
    },
    [],
  );

  useEffect(() => {
    venueApi.tables(venueId).then(
      (result) => {
        if (!chosen.current) setMinutes(result.defaultMinutes);
      },
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
          if (handOver.current) clearTimeout(handOver.current);
          handOver.current = setTimeout(onOpened, 1200);
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
          onChange={(event) => pickMinutes(Number(event.target.value))}
          data-testid="staff-new-minutes"
        />
      </label>
      <div className={styles.row}>
        {[30, 60, 90, 120].map((value) => (
          <button
            key={value}
            type="button"
            className={value === minutes ? styles.tabOn : styles.tab}
            onClick={() => pickMinutes(value)}
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
