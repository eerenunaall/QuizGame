import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { useI18n } from '../lib/i18n';
import { AccountApiError } from '../lib/account';
import { MAX_ENTRANCE_NOTE, MAX_ENTRANCE_TEXT } from '@quizparty/protocol';
import { venueApi, type StaffRole, type VenueSettingsView } from './api';
import { EntranceCard } from './EntranceLine';
import { PhoneReward } from './PhoneVenue';
import { usePanel } from './PanelStore';
import { ScaledStage } from './ScaledStage';
import styles from './StaffPage.module.css';

/** A titled card: what this section does in one plain sentence, then the form. */
export function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} data-testid={`panel-${id}`} aria-labelledby={`h-${id}`}>
      <h2 id={`h-${id}`} className={styles.sectionTitle}>
        {title}
      </h2>
      {intro ? <p className={styles.intro}>{intro}</p> : null}
      {children}
    </section>
  );
}

function Loading() {
  const { t } = useI18n();
  return <p className={styles.intro}>{t('panel.loading')}</p>;
}

/** A big on/off switch: easier to hit than a checkbox, announced as a checkbox. */
export function Switch({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <label className={styles.switch}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        {...(testId ? { 'data-testid': testId } : {})}
      />
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchKnob} />
      </span>
      <span className={styles.switchLabel}>{label}</span>
    </label>
  );
}

const number = (value: string): number => Number.parseInt(value, 10) || 0;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ───────────── prize ─────────────

export function RewardPanel() {
  const { settings } = usePanel();
  return settings ? <RewardForm initial={settings.reward} /> : <Loading />;
}

function RewardForm({ initial }: { initial: VenueSettingsView['reward'] }) {
  const { t } = useI18n();
  const { save } = usePanel();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const missingText = draft.enabled && draft.text.trim() === '';
  const dirty = !same(draft, initial);
  const set = (change: Partial<typeof draft>): void => setDraft({ ...draft, ...change });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy || missingText) return;
    setBusy(true);
    void save({ reward: { ...draft, text: draft.text.trim() } }).finally(() => setBusy(false));
  };

  return (
    <Section id="reward" title={t('panel.reward.title')} intro={t('panel.reward.intro')}>
      <form onSubmit={submit} className={styles.formCard}>
        <Switch
          checked={draft.enabled}
          onChange={(enabled) => set({ enabled })}
          label={t('panel.reward.on')}
          testId="staff-settings-reward"
        />
        <label className={styles.field}>
          {t('panel.reward.text')}
          <input
            maxLength={120}
            placeholder={t('panel.reward.textHint')}
            value={draft.text}
            onChange={(event) => set({ text: event.target.value })}
            aria-invalid={missingText}
            data-testid="staff-settings-reward-text"
          />
        </label>
        {missingText ? (
          <p className={styles.fieldError} role="alert" data-testid="panel-reward-error">
            {t('panel.reward.err.text')}
          </p>
        ) : null}
        <label className={styles.field}>
          {t('panel.reward.minPlayers')}
          <select
            value={draft.minPlayers}
            onChange={(event) => set({ minPlayers: number(event.target.value) })}
            data-testid="panel-reward-min"
          >
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {t('panel.reward.minPlayersOption', { n })}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.grid}>
          <label className={styles.field}>
            {t('panel.reward.maxPerDay')}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={500}
              value={draft.maxPerDay}
              onChange={(event) => set({ maxPerDay: number(event.target.value) })}
              data-testid="panel-reward-cap"
            />
          </label>
          <label className={styles.field}>
            {t('panel.reward.cooldown')}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={240}
              value={draft.rematchCooldownMinutes}
              onChange={(event) => set({ rematchCooldownMinutes: number(event.target.value) })}
            />
          </label>
        </div>
        <p className={styles.hint}>{t('panel.reward.maxPerDayHint')}</p>

        <h3 className={styles.previewTitle}>{t('panel.reward.preview')}</h3>
        <div className={styles.phonePreview} data-testid="panel-reward-preview">
          {draft.enabled ? (
            <PhoneReward
              reward={{
                code: 'ABCD2345',
                text: draft.text.trim() || t('panel.reward.previewEmpty'),
                expiresAt: 0,
              }}
            />
          ) : (
            <p className={styles.hint}>{t('panel.reward.previewOff')}</p>
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          block
          busy={busy}
          disabled={missingText || !dirty}
          data-testid="panel-save-reward"
        >
          {t('panel.save')}
        </Button>
      </form>
    </Section>
  );
}

// ───────────── entrance fee ─────────────

export function EntrancePanel() {
  const { settings } = usePanel();
  return settings ? (
    <EntranceForm initial={settings.entrance ?? { enabled: false, text: '', note: '' }} />
  ) : (
    <Loading />
  );
}

function EntranceForm({ initial }: { initial: NonNullable<VenueSettingsView['entrance']> }) {
  const { t } = useI18n();
  const { save } = usePanel();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const empty = draft.enabled && draft.text.trim() === '';
  const dirty = !same(draft, initial);
  const set = (change: Partial<typeof draft>): void => setDraft({ ...draft, ...change });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy || empty) return;
    setBusy(true);
    void save({ entrance: { ...draft, text: draft.text.trim(), note: draft.note.trim() } }).finally(
      () => setBusy(false),
    );
  };

  return (
    <Section id="entrance" title={t('panel.entrance.title')} intro={t('panel.entrance.intro')}>
      <form onSubmit={submit} className={styles.formCard}>
        <Switch
          checked={draft.enabled}
          onChange={(enabled) => set({ enabled })}
          label={t('panel.entrance.on')}
          testId="panel-entrance-on"
        />
        <label className={styles.field}>
          {t('panel.entrance.text')}
          <input
            maxLength={MAX_ENTRANCE_TEXT}
            placeholder={t('panel.entrance.textHint')}
            value={draft.text}
            onChange={(event) => set({ text: event.target.value })}
            aria-invalid={empty}
            data-testid="panel-entrance-text"
          />
          <span className={styles.counter}>
            {t('panel.charsLeft', { n: [...draft.text].length, max: MAX_ENTRANCE_TEXT })}
          </span>
        </label>
        {empty ? (
          <p className={styles.fieldError} role="alert" data-testid="panel-entrance-error">
            {t('panel.entrance.err.empty')}
          </p>
        ) : null}
        <label className={styles.field}>
          {t('panel.entrance.note')}
          <input
            maxLength={MAX_ENTRANCE_NOTE}
            placeholder={t('panel.entrance.noteHint')}
            value={draft.note}
            onChange={(event) => set({ note: event.target.value })}
            data-testid="panel-entrance-note"
          />
          <span className={styles.counter}>
            {t('panel.charsLeft', { n: [...draft.note].length, max: MAX_ENTRANCE_NOTE })}
          </span>
        </label>

        <h3 className={styles.previewTitle}>{t('panel.entrance.preview')}</h3>
        <div className={styles.entrancePreview} data-testid="panel-entrance-preview">
          {draft.enabled ? (
            <ScaledStage width={560} height={190} label={t('panel.entrance.preview')}>
              <div style={{ padding: 40 }}>
                <EntranceCard
                  text={draft.text.trim() || t('panel.entrance.previewEmpty')}
                  {...(draft.note.trim() ? { note: draft.note.trim() } : {})}
                />
              </div>
            </ScaledStage>
          ) : (
            <p className={styles.hint}>{t('panel.entrance.previewOff')}</p>
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          block
          busy={busy}
          disabled={empty || !dirty}
          data-testid="panel-save-entrance"
        >
          {t('panel.save')}
        </Button>
      </form>
    </Section>
  );
}

// ───────────── game defaults ─────────────

export function PlayPanel() {
  const { settings } = usePanel();
  return settings ? <PlayForm settings={settings} /> : <Loading />;
}

function PlayForm({ settings }: { settings: VenueSettingsView }) {
  const { t, td } = useI18n();
  const { save } = usePanel();
  const initialPlay = settings.play ?? {
    defaultMode: 'INDIVIDUAL' as const,
    simpleRuleset: false,
    teamNames: [],
    simpleAnswerSeconds: null,
  };
  const [play, setPlay] = useState(initialPlay);
  const [minutes, setMinutes] = useState(settings.defaultMinutes);
  const [steps, setSteps] = useState(settings.extendSteps.join(', '));
  const [busy, setBusy] = useState(false);

  const parsedSteps = steps
    .split(/[,\s]+/u)
    .filter((part) => part !== '')
    .map((part) => (/^\d+$/u.test(part) ? Number(part) : Number.NaN));
  const stepsBad =
    parsedSteps.length === 0 ||
    parsedSteps.length > 4 ||
    parsedSteps.some((n) => !(n >= 1 && n <= 240));
  const minutesBad = !(minutes >= 5 && minutes <= 720);
  const dirty =
    !same(play, initialPlay) ||
    minutes !== settings.defaultMinutes ||
    !same(parsedSteps, settings.extendSteps);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy || stepsBad || minutesBad) return;
    setBusy(true);
    void save({
      play: {
        defaultMode: play.defaultMode,
        simpleRuleset: play.simpleRuleset,
        simpleAnswerSeconds: play.simpleAnswerSeconds,
      },
      defaultMinutes: minutes,
      extendSteps: parsedSteps,
    }).finally(() => setBusy(false));
  };

  return (
    <Section id="play" title={t('panel.play.title')} intro={t('panel.play.intro')}>
      <form onSubmit={submit} className={styles.formCard}>
        <label className={styles.field}>
          {t('staff.play.mode')}
          <select
            value={play.defaultMode}
            onChange={(event) =>
              setPlay({
                ...play,
                defaultMode: event.target.value === 'TEAMS' ? 'TEAMS' : 'INDIVIDUAL',
              })
            }
            data-testid="staff-play-mode"
          >
            <option value="INDIVIDUAL">{td('teams.mode.INDIVIDUAL')}</option>
            <option value="TEAMS">{td('teams.mode.TEAMS')}</option>
          </select>
        </label>
        <Switch
          checked={play.simpleRuleset}
          onChange={(simpleRuleset) => setPlay({ ...play, simpleRuleset })}
          label={t('staff.play.simple')}
          testId="staff-play-simple"
        />
        <label className={styles.field}>
          {t('staff.play.window')}
          <input
            type="number"
            inputMode="numeric"
            min={10}
            max={60}
            value={play.simpleAnswerSeconds ?? ''}
            onChange={(event) =>
              setPlay({
                ...play,
                simpleAnswerSeconds: event.target.value === '' ? null : number(event.target.value),
              })
            }
            data-testid="staff-play-window"
          />
        </label>
        <label className={styles.field}>
          {t('panel.play.defaultMinutes')}
          <input
            type="number"
            inputMode="numeric"
            min={5}
            max={720}
            value={minutes}
            onChange={(event) => setMinutes(number(event.target.value))}
            aria-invalid={minutesBad}
            data-testid="panel-play-minutes"
          />
        </label>
        {minutesBad ? (
          <p className={styles.fieldError} role="alert">
            {t('panel.play.err.minutes')}
          </p>
        ) : null}
        <label className={styles.field}>
          {t('panel.play.steps')}
          <input
            value={steps}
            placeholder={t('panel.play.stepsHint')}
            onChange={(event) => setSteps(event.target.value)}
            aria-invalid={stepsBad}
            data-testid="panel-play-steps"
          />
        </label>
        {stepsBad ? (
          <p className={styles.fieldError} role="alert" data-testid="panel-play-steps-error">
            {t('panel.play.err.steps')}
          </p>
        ) : null}
        <Button
          type="submit"
          size="lg"
          block
          busy={busy}
          disabled={stepsBad || minutesBad || !dirty}
          data-testid="panel-save-play"
        >
          {t('panel.save')}
        </Button>
      </form>
    </Section>
  );
}

// ───────────── people ─────────────

export function PeoplePanel({ venueId }: { venueId: string }) {
  const { t } = useI18n();
  const [people, setPeople] = useState<
    { accountId: string; email: string | null; role: StaffRole }[]
  >([]);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    venueApi.staff(venueId).then(
      (result) => setPeople(result.staff),
      () => undefined,
    );
  }, [venueId]);
  useEffect(load, [load]);

  const fail = (error: unknown): void =>
    setMessage(
      error instanceof AccountApiError && error.code === 'RATE_LIMITED'
        ? t('staff.error.throttled')
        : t('staff.error.generic'),
    );

  const invite = (event: FormEvent): void => {
    event.preventDefault();
    venueApi.invite(venueId, email).then(() => {
      setEmail('');
      setMessage(null);
      load();
    }, fail);
  };

  return (
    <Section id="people" title={t('panel.people.title')} intro={t('panel.people.intro')}>
      <div className={styles.formCard} data-testid="staff-settings">
        <ul className={styles.people}>
          {people.map((member) => (
            <li key={member.accountId}>
              <span>
                {member.email} · {t(`staff.people.${member.role}`)}
              </span>
              {member.role === 'STAFF' ? (
                <button
                  type="button"
                  className={styles.smallButton}
                  onClick={() => {
                    venueApi.remove(venueId, member.accountId).then(load, fail);
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
              placeholder={t('panel.people.emailHint')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <p className={styles.hint}>{t('staff.people.hint')}</p>
          {message ? (
            <p className={styles.fieldError} role="alert">
              {message}
            </p>
          ) : null}
          <Button type="submit" size="md" variant="violet" block disabled={email.length < 3}>
            {t('staff.people.add')}
          </Button>
        </form>
      </div>
    </Section>
  );
}
