import { TEAM_IDS, type TeamId } from '@quizparty/protocol';
import { useI18n } from '../lib/i18n';
import { TeamMark } from '../ui/TeamMark';
import { EntranceCard } from './EntranceLine';
import { ScaledStage } from './ScaledStage';
import styles from './LookPreview.module.css';

export interface LookDraft {
  venueName: string;
  logoUrl: string | null;
  /** Team slot -> image url (null = default animal), in `TEAM_IDS` order. */
  teamLogos: (string | null)[];
  teamNames: string[];
  entrance: { text: string; note: string } | null;
}

const SHOWN: TeamId[] = TEAM_IDS.slice(0, 2);

/** The names a table's slots carry: the venue's own, else the standard ones. */
function useNames(draft: LookDraft): string[] {
  const { t } = useI18n();
  return TEAM_IDS.map((id, index) => draft.teamNames[index]?.trim() || t(`team.${id}`));
}

/** The TV lobby as it will look, at stage size and scaled down (1920x1080, ADR-0030). */
export function TvLobbyPreview({ draft }: { draft: LookDraft }) {
  const { t } = useI18n();
  const names = useNames(draft);
  return (
    <ScaledStage
      width={1920}
      height={1080}
      label={t('panel.look.previewTv')}
      testId="look-preview-tv"
    >
      <div className={styles.stage}>
        <div className={styles.brand}>
          {draft.logoUrl ? (
            <img className={styles.logo} src={draft.logoUrl} alt="" data-testid="look-tv-logo" />
          ) : null}
          <span className={styles.venue}>{draft.venueName || t('panel.look.previewName')}</span>
        </div>
        <div className={styles.join}>
          <div className={styles.joinTitle}>{t('panel.look.previewJoin')}</div>
          <div className={styles.qr} />
          <div className={styles.code}>{t('panel.look.previewCode')}</div>
          {draft.entrance ? (
            <EntranceCard
              text={draft.entrance.text || t('panel.entrance.previewEmpty')}
              {...(draft.entrance.note ? { note: draft.entrance.note } : {})}
            />
          ) : null}
        </div>
        <div className={styles.teams}>
          {SHOWN.map((id) => (
            <div key={id} className={styles.team}>
              <TeamMark
                teamId={id}
                size={170}
                logo={draft.teamLogos[TEAM_IDS.indexOf(id)] ?? null}
              />
              <span className={styles.teamName}>{names[TEAM_IDS.indexOf(id)]}</span>
            </div>
          ))}
        </div>
        <div className={styles.start}>{t('panel.look.previewStart')}</div>
      </div>
    </ScaledStage>
  );
}

/** One phone card: venue, code, entrance line, team chips and the main button in the venue's accent. */
export function PhonePreview({ draft }: { draft: LookDraft }) {
  const { t } = useI18n();
  const names = useNames(draft);
  return (
    <ScaledStage
      width={390}
      height={560}
      label={t('panel.look.previewPhone')}
      testId="look-preview-phone"
    >
      <div className={styles.phone}>
        <div className={styles.phoneBrand}>
          {draft.logoUrl ? (
            <img
              className={styles.phoneLogo}
              src={draft.logoUrl}
              alt=""
              data-testid="look-phone-logo"
            />
          ) : null}
          <span className={styles.phoneVenue}>
            {draft.venueName || t('panel.look.previewName')}
          </span>
        </div>
        <div className={styles.phoneCode}>{t('panel.look.previewCode')}</div>
        {draft.entrance ? (
          <div className={styles.phoneEntrance}>
            {t('venue.entrance.phone', { text: draft.entrance.text || '…' })}
          </div>
        ) : null}
        <div className={styles.phoneTeams}>
          {SHOWN.map((id) => (
            <div key={id} className={styles.phoneTeam}>
              <TeamMark
                teamId={id}
                size={52}
                logo={draft.teamLogos[TEAM_IDS.indexOf(id)] ?? null}
              />
              <span>{names[TEAM_IDS.indexOf(id)]}</span>
            </div>
          ))}
        </div>
        <div className={styles.phoneButton}>{t('panel.look.previewReady')}</div>
      </div>
    </ScaledStage>
  );
}
