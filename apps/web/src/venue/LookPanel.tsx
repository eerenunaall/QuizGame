import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  MAX_TEAM_LOGOS,
  MAX_TEAM_NAME_LENGTH,
  TEAM_IDS,
  VENUE_ACCENT_IDS,
  VENUE_THEME_IDS,
  type VenueAccentId,
  type VenueThemeId,
} from '@quizparty/protocol';
import { ACCENTS, THEMES } from '@quizparty/ui-tokens';
import { Button } from '../ui/Button';
import { useI18n } from '../lib/i18n';
import { assetUrl } from './assetsApi';
import { LogoField } from './LogoField';
import { applyVenueLook } from './look';
import { Section } from './OwnerPanels';
import { usePanel } from './PanelStore';
import { PhonePreview, TvLobbyPreview, type LookDraft } from './LookPreview';
import type { VenueSettingsView } from './api';
import styles from './StaffPage.module.css';

const DEFAULT_LOOK: NonNullable<VenueSettingsView['look']> = {
  theme: 'gusto',
  accent: null,
  logo: null,
  teamLogos: [],
};

const pad = <T,>(items: readonly T[], length: number, fill: T): T[] =>
  Array.from({ length }, (_, index) => items[index] ?? fill);

/**
 * Görünüm: theme, accent from the closed palette, the venue logo, team names and marks, with live
 * previews of the TV lobby and a phone. The page itself takes the draft look while editing, so the owner
 * sees the colours everywhere before saving (and gets the saved look back when leaving).
 */
export function LookPanel({ venueName }: { venueName: string }) {
  const { settings } = usePanel();
  const { t } = useI18n();
  if (!settings) return <p className={styles.intro}>{t('panel.loading')}</p>;
  return <LookForm settings={settings} venueName={venueName} />;
}

function LookForm({ settings, venueName }: { settings: VenueSettingsView; venueName: string }) {
  const { t } = useI18n();
  const { save, venueId } = usePanel();
  const saved = settings.look ?? DEFAULT_LOOK;
  const savedNames = pad(settings.play?.teamNames ?? [], TEAM_IDS.length, '');
  const [theme, setTheme] = useState<VenueThemeId>(saved.theme);
  const [accent, setAccent] = useState<VenueAccentId | null>(saved.accent);
  const [logo, setLogo] = useState<string | null>(saved.logo);
  const [teamLogos, setTeamLogos] = useState<(string | null)[]>(
    pad(saved.teamLogos, TEAM_IDS.length, null),
  );
  const [names, setNames] = useState<string[]>(savedNames);
  const [busy, setBusy] = useState(false);

  // The page wears the draft while this form is open and the saved look when it closes.
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => {
    applyVenueLook(document, { theme, accent });
  }, [theme, accent]);
  useEffect(
    () => () => {
      applyVenueLook(document, savedRef.current);
    },
    [],
  );

  const trimmedLogos = (): (string | null)[] => {
    const out = [...teamLogos];
    while (out.length > 0 && out[out.length - 1] === null) out.pop();
    return out;
  };
  const dirty =
    theme !== saved.theme ||
    accent !== saved.accent ||
    logo !== saved.logo ||
    JSON.stringify(trimmedLogos()) !== JSON.stringify(saved.teamLogos) ||
    JSON.stringify(names) !== JSON.stringify(savedNames);
  const duplicateName = names.some(
    (name, index) =>
      name.trim() !== '' &&
      names.findIndex(
        (other) =>
          other.trim().toLocaleLowerCase('tr-TR') === name.trim().toLocaleLowerCase('tr-TR'),
      ) !== index,
  );

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy || duplicateName) return;
    setBusy(true);
    const trimmedNames = names.map((name) => name.trim());
    while (trimmedNames.length > 0 && trimmedNames[trimmedNames.length - 1] === '')
      trimmedNames.pop();
    void save({
      look: { theme, accent, logo, teamLogos: trimmedLogos() },
      play: { teamNames: trimmedNames },
    }).finally(() => setBusy(false));
  };

  const teamRow = (teamId: (typeof TEAM_IDS)[number], slot: number): ReactNode => (
    <div key={teamId} className={styles.teamRow} data-testid={`look-team-${slot}`}>
      <LogoField
        kind="TEAM"
        compact
        label={t('staff.play.name', { n: slot + 1 })}
        hint=""
        hash={teamLogos[slot] ?? null}
        teamId={teamId}
        onChange={(hash) => setTeamLogos(teamLogos.map((old, i) => (i === slot ? hash : old)))}
        testId={`look-team-logo-${slot}`}
      />
      <input
        className={styles.teamInput}
        maxLength={MAX_TEAM_NAME_LENGTH}
        placeholder={t(`team.${teamId}`)}
        aria-label={t('staff.play.name', { n: slot + 1 })}
        value={names[slot] ?? ''}
        onChange={(event) =>
          setNames(names.map((old, i) => (i === slot ? event.target.value : old)))
        }
        data-testid={`staff-play-name-${slot}`}
      />
    </div>
  );

  const draft: LookDraft = {
    venueName,
    logoUrl: logo ? assetUrl(venueId, logo) : null,
    teamLogos: teamLogos.map((hash) => (hash ? assetUrl(venueId, hash) : null)),
    teamNames: names,
    entrance:
      settings.entrance?.enabled === true
        ? { text: settings.entrance.text, note: settings.entrance.note }
        : null,
  };

  return (
    <Section id="look" title={t('panel.look.title')} intro={t('panel.look.intro')}>
      <form onSubmit={submit} className={styles.formCard}>
        <div className={styles.label} id="look-theme">
          {t('panel.look.theme')}
        </div>
        <div className={styles.themeGrid} role="radiogroup" aria-labelledby="look-theme">
          {VENUE_THEME_IDS.map((id) => {
            const palette = THEMES[id].palette;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={theme === id}
                className={theme === id ? styles.themeOn : styles.themeCard}
                onClick={() => setTheme(id)}
                data-testid={`look-theme-${id}`}
              >
                <span
                  className={styles.themeSwatch}
                  style={{ background: palette.background, borderColor: palette.surfaceLine }}
                  aria-hidden="true"
                >
                  <i style={{ background: palette.accentA }} />
                  <i style={{ background: palette.text }} />
                  <i style={{ background: palette.answerB }} />
                </span>
                {t(`panel.theme.${id}`)}
              </button>
            );
          })}
        </div>

        <div className={styles.label} id="look-accent">
          {t('panel.look.accent')}
        </div>
        <div className={styles.accentRow} role="radiogroup" aria-labelledby="look-accent">
          <button
            type="button"
            role="radio"
            aria-checked={accent === null}
            className={accent === null ? styles.accentDefaultOn : styles.accentDefault}
            onClick={() => setAccent(null)}
            data-testid="look-accent-default"
          >
            {t('panel.look.accentDefault')}
          </button>
          {VENUE_ACCENT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={accent === id}
              aria-label={t(`panel.accent.${id}`)}
              title={t(`panel.accent.${id}`)}
              className={accent === id ? styles.accentOn : styles.accent}
              style={{ background: ACCENTS[id] }}
              onClick={() => setAccent(id)}
              data-testid={`look-accent-${id}`}
            />
          ))}
        </div>

        <LogoField
          kind="LOGO"
          label={t('panel.look.logo')}
          hint={t('panel.look.logoHint')}
          hash={logo}
          onChange={setLogo}
          testId="look-logo"
        />

        <div className={styles.label}>{t('panel.look.teams')}</div>
        <p className={styles.hint}>{t('panel.look.teamsHint')}</p>
        <div className={styles.teamList}>{TEAM_IDS.slice(0, 4).map(teamRow)}</div>
        <details className={styles.moreTeams}>
          <summary>{t('panel.look.moreTeams')}</summary>
          <div className={styles.teamList}>
            {TEAM_IDS.slice(4, MAX_TEAM_LOGOS).map((teamId, index) => teamRow(teamId, index + 4))}
          </div>
        </details>

        <h3 className={styles.previewTitle}>{t('panel.look.previewTv')}</h3>
        <TvLobbyPreview draft={draft} />
        <h3 className={styles.previewTitle}>{t('panel.look.previewPhone')}</h3>
        <div className={styles.phoneStage}>
          <PhonePreview draft={draft} />
        </div>

        <Button
          type="submit"
          size="lg"
          block
          busy={busy}
          disabled={!dirty || duplicateName}
          data-testid="panel-save-look"
        >
          {t('panel.save')}
        </Button>
      </form>
    </Section>
  );
}
